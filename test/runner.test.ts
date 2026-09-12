import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parsePytestSummary, pythonPlugin } from '../src/languages/python';
import { detectAngularRunner, detectPlaywrightCt, detectRunner, parseJestSummary, parseKarmaSummary, parseMochaSummary, parsePlaywrightSummary, parseVitestSummary, typescriptPlugin } from '../src/languages/typescript';

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

test('an Angular project is run through ng test, never the vitest binary (1.0.4); Karma headless (1.0.5)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'untangleit-ng-'));
  const write = (test: unknown) => fs.writeFileSync(path.join(dir, 'angular.json'), JSON.stringify({ projects: { app: { architect: { test } } } }));
  write({ builder: '@angular/build:unit-test' });
  assert.equal(detectAngularRunner(dir), 'vitest');
  const runner = typescriptPlugin.createTestRunner();
  const settings = { testsPath: '', sourceRoot: 'src', fields: { runner: 'auto', extraArgs: '' } };
  assert.equal(runner.describe({ workspaceRoot: dir, settings }), 'ng test with Vitest');
  write({ builder: '@angular/build:unit-test', options: { runner: 'karma' } });
  assert.equal(detectAngularRunner(dir), 'karma');
  assert.equal(runner.describe({ workspaceRoot: dir, settings }), 'ng test with Karma');
  assert.deepEqual(parseKarmaSummary('Chrome Headless (Linux): Executed 11 of 11 SUCCESS (0.03 secs / 0.02 secs)\nTOTAL: 11 SUCCESS\n', 0), { passed: 11, failed: 0, errors: 0, skipped: 0, exitCode: 0 });
  assert.deepEqual(parseKarmaSummary('Chrome Headless (Linux): Executed 11 of 11 (2 FAILED) (0.03 secs / 0.02 secs)\n', 1), { passed: 9, failed: 2, errors: 0, skipped: 0, exitCode: 1 });
  assert.equal(parseKarmaSummary('Application bundle generation failed.\n', 1).errors, 1);
  write({ builder: '@angular-devkit/build-angular:karma' });
  assert.equal(detectAngularRunner(dir), 'karma');
  assert.equal(detectAngularRunner(path.resolve('test/fixtures/tsproject-vitest')), undefined);
});

test('Mocha and Playwright component tests: detection and summaries (1.0.8)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'untangleit-runners-'));
  const write = (pkg: unknown) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  const runner = typescriptPlugin.createTestRunner();
  const settings = { testsPath: '', sourceRoot: 'src', fields: { runner: 'auto', extraArgs: '' } };
  write({ devDependencies: { mocha: '^11' } });
  assert.equal(detectRunner(dir), 'mocha');
  assert.equal(runner.describe({ workspaceRoot: dir, settings }), 'mocha');
  write({ devDependencies: { mocha: '^11', vitest: '^3' }, scripts: { test: 'mocha' } });
  assert.equal(detectRunner(dir), 'mocha', 'the test script settles a tie');
  write({ devDependencies: { mocha: '^11', vitest: '^3' } });
  assert.equal(detectRunner(dir), 'vitest', 'no script: Vitest first');
  write({ devDependencies: { '@playwright/experimental-ct-react': '^1.62', vitest: '^3' } });
  assert.equal(detectPlaywrightCt(dir), '@playwright/experimental-ct-react');
  assert.equal(detectRunner(dir), 'playwright-ct', 'component tests before everything else');
  assert.equal(runner.describe({ workspaceRoot: dir, settings }), 'Playwright component tests');
  assert.deepEqual(parseMochaSummary('\n  10 passing (5ms)\n  1 pending\n  2 failing\n', 2), { passed: 10, failed: 2, errors: 0, skipped: 1, exitCode: 2 });
  assert.equal(parseMochaSummary('Error: Cannot find module', 1).errors, 1);
  assert.deepEqual(parsePlaywrightSummary('  1 failed\n  1 flaky\n  2 skipped\n  7 passed (3.1s)\n', 1), { passed: 8, failed: 1, errors: 0, skipped: 2, exitCode: 1 });
  assert.equal(parsePlaywrightSummary("Error: browserType.launch: Executable doesn't exist", 1).errors, 1);
});
