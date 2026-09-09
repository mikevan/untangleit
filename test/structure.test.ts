import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pythonPlugin } from '../src/languages/python';
import { repoWasmDir } from '../src/languages/shared/treeSitter';
import { typescriptPlugin } from '../src/languages/typescript';
import { rankTangled } from '../src/engine/tangle';

const wasmDir = repoWasmDir();

test('TypeScript: methods and their ways through, from the fixture', async () => {
  const source = await typescriptPlugin.createStructureSource({ wasmDir });
  try {
    const text = fs.readFileSync(path.join('test', 'fixtures', 'tsproject-vitest', 'src', 'calc.ts'), 'utf8');
    const methods = source.measure('src/calc.ts', text);
    const byName = Object.fromEntries(methods.map((m) => [m.name, m.complexity]));
    assert.equal(byName.classify, 5);
    assert.equal(byName.describeNumber, 8);
    const tangled = rankTangled(methods.map((m) => ({ ...m, path: 'src/calc.ts' })), 5);
    assert.deepEqual(tangled.map((t) => t.name), ['describeNumber']);
    assert.equal(tangled[0].over, 3);
  } finally {
    source.dispose();
  }
});

test('Python: methods and their ways through, from the fixture', async () => {
  const source = await pythonPlugin.createStructureSource({ wasmDir });
  try {
    const text = fs.readFileSync(path.join('test', 'fixtures', 'pyproject', 'src', 'calc.py'), 'utf8');
    const methods = source.measure('src/calc.py', text);
    const byName = Object.fromEntries(methods.map((m) => [m.name, m.complexity]));
    assert.equal(byName.classify, 5);
    assert.equal(byName.describe_number, 8);
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
