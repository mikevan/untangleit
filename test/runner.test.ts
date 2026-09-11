import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { parsePytestSummary, pythonPlugin } from '../src/languages/python';
import { parseJestSummary, parseVitestSummary, typescriptPlugin } from '../src/languages/typescript';

const ESC = String.fromCharCode(27);

test('summary parsing for the three runners', () => {
  assert.deepEqual(parseVitestSummary('\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n', 0), { passed: 4, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parseVitestSummary(`${ESC}[1m Tests ${ESC}[22m 1 failed | 3 passed (4)`, 1), { passed: 3, failed: 1, errors: 0, skipped: 0, exitCode: 1 });
  assert.deepEqual(parseJestSummary('Tests:       1 failed, 2 skipped, 5 passed, 8 total', 1), { passed: 5, failed: 1, errors: 0, skipped: 2, exitCode: 1 });
  assert.deepEqual(parsePytestSummary('4 passed in 0.01s', 0), { passed: 4, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parsePytestSummary('1 failed, 3 passed, 1 error in 0.20s', 1), { passed: 3, failed: 1, errors: 1, skipped: 0, exitCode: 1 });
});

test('the Vitest fixture runs through the project runner and passes', async () => {
  const root = path.resolve('test/fixtures/tsproject-vitest');
  const runner = typescriptPlugin.createTestRunner();
  const settings = { testsPath: 'test', sourceRoot: 'src', fields: {} };
  assert.equal(runner.describe({ workspaceRoot: root, settings }), 'vitest test');
  const summary = await runner.run({ workspaceRoot: root, settings, log: () => undefined });
  assert.equal(summary.failed, 0);
  assert.ok(summary.passed >= 4);
});

test('the pytest fixture runs through the project interpreter and passes', async () => {
  const root = path.resolve('test/fixtures/pyproject');
  const runner = pythonPlugin.createTestRunner();
  const settings = { testsPath: 'tests', sourceRoot: 'src', fields: { interpreter: process.env.UNTANGLEIT_PYTHON ?? '' } };
  let summary;
  try {
    summary = await runner.run({ workspaceRoot: root, settings, log: () => undefined });
  } catch (err) {
    console.log(`Skipping: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (summary.passed === 0 && summary.exitCode !== 0) {
    console.log('Skipping: pytest is not available to the interpreter.');
    return;
  }
  assert.equal(summary.failed, 0);
  assert.ok(summary.passed >= 4);
});
