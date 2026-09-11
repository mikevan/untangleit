import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pythonPlugin } from '../src/languages/python';
import { repoWasmDir } from '../src/languages/shared/treeSitter';
import { typescriptPlugin } from '../src/languages/typescript';
import { rankTangled } from '../src/engine/tangle';

const wasmDir = repoWasmDir();

test('TypeScript: methods and their three numbers, from the fixture; the ranking reads tangle', async () => {
  const source = await typescriptPlugin.createStructureSource({ wasmDir });
  try {
    const text = fs.readFileSync(path.join('test', 'fixtures', 'tsproject-vitest', 'src', 'calc.ts'), 'utf8');
    const methods = source.measure('src/calc.ts', text);
    const byName = Object.fromEntries(methods.map((m) => [m.name, [m.complexity, m.campbell, m.mbcc]]));
    // classify: a two-branch chain on different facts (1 + 2), a nested if (2), one independent && run (1).
    assert.deepEqual(byName.classify, [5, 5, 6]);
    assert.deepEqual(byName.describeNumber, [8, 8, 8]);
    const tangled = rankTangled(methods.map((m) => ({ ...m, path: 'src/calc.ts' })), 5);
    assert.deepEqual(tangled.map((t) => [t.name, t.over]), [['describeNumber', 3], ['classify', 1]]);
    assert.equal(rankTangled(methods.map((m) => ({ ...m, path: 'src/calc.ts' })), 15).length, 0);
  } finally {
    source.dispose();
  }
});

test('Python: methods and their three numbers, from the fixture', async () => {
  const source = await pythonPlugin.createStructureSource({ wasmDir });
  try {
    const text = fs.readFileSync(path.join('test', 'fixtures', 'pyproject', 'src', 'calc.py'), 'utf8');
    const methods = source.measure('src/calc.py', text);
    const byName = Object.fromEntries(methods.map((m) => [m.name, [m.complexity, m.campbell, m.mbcc]]));
    assert.deepEqual(byName.classify, [5, 5, 6]);
    assert.deepEqual(byName.describe_number, [8, 8, 8]);
  } finally {
    source.dispose();
  }
});

test('plugins walk sources and leave tests out', () => {
  const ts = typescriptPlugin.walkSources(path.resolve('test/fixtures/tsproject-vitest'), 'src', 'test');
  assert.deepEqual(ts, ['src/calc.ts']);
  const py = pythonPlugin.walkSources(path.resolve('test/fixtures/pyproject'), 'src', 'tests');
  assert.deepEqual(py.sort(), ['src/__init__.py', 'src/calc.py']);
  assert.equal(typescriptPlugin.isTestFile('test/calc.test.ts'), true);
  assert.equal(pythonPlugin.isTestFile('tests/test_calc.py'), true);
});

test('single-file components: the script block is measured on its real lines, the template is not (1.0.3)', async () => {
  const source = await typescriptPlugin.createStructureSource({ wasmDir });
  try {
    const vue = source.measure('src/Picker.vue', fs.readFileSync(path.join('test', 'fixtures', 'sfc', 'src', 'Picker.vue'), 'utf8'));
    const classify = vue.find((m) => m.name === 'classify');
    assert.ok(classify, vue.map((m) => m.name).join(', '));
    assert.equal(classify.startLine, 4, 'the line in the editor, not the line in the block');
    assert.equal(classify.endLine, 14);
    // if (1) + nested if (2) + ordered operands (name && name.trim(): 2 under MBCC, 1 under Campbell) + else if (Campbell 1, MBCC 2).
    assert.deepEqual([classify.complexity, classify.campbell, classify.mbcc], [5, 5, 7]);
    const svelte = source.measure('src/Picker.svelte', fs.readFileSync(path.join('test', 'fixtures', 'sfc', 'src', 'Picker.svelte'), 'utf8'));
    const sv = svelte.find((m) => m.name === 'classify');
    assert.ok(sv);
    assert.equal(sv.startLine, 2);
    assert.deepEqual([sv.complexity, sv.campbell, sv.mbcc], [5, 5, 7]);
    assert.deepEqual(source.measure('src/Plain.vue', fs.readFileSync(path.join('test', 'fixtures', 'sfc', 'src', 'Plain.vue'), 'utf8')), [], 'no script block, no functions');
  } finally {
    source.dispose();
  }
  const walked = typescriptPlugin.walkSources(path.resolve('test/fixtures/sfc'), 'src', 'test');
  assert.deepEqual(walked.sort(), ['src/Picker.svelte', 'src/Picker.vue', 'src/Plain.vue']);
});
