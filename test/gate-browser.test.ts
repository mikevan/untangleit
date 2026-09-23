/**
 * The behaviour gate through the two runners that run the code in a browser:
 * Angular's Karma runner and Playwright's component tests.
 *
 * These are separate from gate.test.ts because they need a browser and a
 * fixture with its dependencies installed, so they return without asserting
 * when that is not the case. A green run on a machine where the fixtures
 * are not installed has proved nothing about these two, and the log line
 * says so rather than leaving it to be deduced.
 *
 * To make them run:
 *
 *   cd ..\DeepTest\test\fixtures\helloworld-angular-karma
 *   npm install
 *   cd ..\helloworld-react-playwright-ct
 *   npm install
 *   npx playwright install chromium
 *
 * What is proved here is the delivery, not the comparison. The comparator
 * and the five cases are proved in gate.test.ts and do not depend on a
 * runner. What these answer is narrower and is the thing seam tests cannot
 * close: does a record made inside a browser page reach the driver at all.
 *
 * The fixtures are edited in place and put back afterwards, because copying
 * an Angular workspace away from its own node_modules breaks its builder
 * config in ways that are hard to see. If a run is interrupted, check the
 * fixture with git status before trusting it.
 */
import { test } from 'vitest';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isProblem } from '@projectrevivesolutions/witness';
import type { BoundaryRecord } from '@projectrevivesolutions/witness';
import { decide } from '../src/engine/behaviour';
import { locateBoundary, recordBoundary } from '../src/gate';
import { setRuntimeEnvironment } from '../src/languages/shared/runtime';
import { typescriptPlugin } from '../src/languages/typescript';
import type { LanguagePlugin, LanguageSettings } from '../src/languages/types';

setRuntimeEnvironment({ wasmDir: path.resolve('node_modules', '@projectrevivesolutions', 'witness', 'dist') });

const FIXTURES = path.resolve('..', 'DeepTest', 'test', 'fixtures');

/** The fixture, or undefined when its dependencies are not installed. */
function fixture(name: string): string | undefined {
  const root = path.join(FIXTURES, name);
  return fs.existsSync(path.join(root, 'node_modules')) ? root : undefined;
}

/**
 * What one recorded run had to say, for the report below.
 *
 * The runner's own output used to be thrown away here, which meant a failure
 * inside the runner arrived as a verdict of "insufficient" with no way to
 * tell whether the runner had refused to start, built nothing, or simply
 * never reached the method. It is kept now and summarised on failure.
 */
function summarise(log: string[]): string {
  const interesting = log.filter((l) => /error|cannot|failed|refus|not found|unknown option|exited|ENOENT|EACCES|not installed|no tests|Executed 0/i.test(l));
  const lines = [
    ...log.slice(0, 3),
    ...(interesting.length > 0 ? ['    --- lines mentioning a problem ---', ...interesting.slice(0, 25).map((l) => `    ${l}`)] : []),
    '    --- last lines of the run ---',
    ...log.slice(-30).map((l) => `    ${l}`),
  ];
  return lines.join('\n');
}

/** One line per record, so identity, index and depth are visible at a glance. */
function describeRecords(records: BoundaryRecord[] | undefined): string {
  if (records === undefined) {
    return 'undefined (this language has no recorder, which is not the same as recording nothing)';
  }
  if (records.length === 0) {
    return '0 records';
  }
  return `${records.length} records: ${records
    .map((r) => (isProblem(r) ? `problem=${r.problem} target=${r.target}` : `target=${r.target} test=${JSON.stringify(r.test)} index=${r.index} depth=${r.depth} outcome=${r.outcome.kind}`))
    .join('; ')}`;
}

/**
 * Records the boundary, edits the file, records again, and puts the file
 * back whatever happens.
 *
 * Everything it learned is printed when the verdict is not `changed`, because
 * a bare "insufficient" says nothing about which of the stages went wrong:
 * locating the method, getting the recorder in front of the runner, the
 * runner running at all, the records reaching this process, or the pairing.
 */
async function beforeAndAfter(label: string, root: string, settings: LanguageSettings, file: string, line: number, edit: (source: string) => string): Promise<ReturnType<typeof decide>> {
  const absolute = path.join(root, file);
  const original = fs.readFileSync(absolute, 'utf8');
  const beforeLog: string[] = [];
  const afterLog: string[] = [];
  try {
    const boundary = await locateBoundary(root, file, line);
    const before = boundary ? await recordBoundary(typescriptPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: (l) => beforeLog.push(l) }) : undefined;
    let after: BoundaryRecord[] | undefined;
    if (boundary) {
      fs.writeFileSync(absolute, edit(original), 'utf8');
      after = await recordBoundary(typescriptPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: (l) => afterLog.push(l) });
    }
    const verdict = decide(before ?? [], after ?? []);
    if (verdict.verdict !== 'changed') {
      console.log(
        [
          '',
          `=== ${label}: the gate did not reach a verdict of changed ===`,
          `verdict:            ${JSON.stringify(verdict)}`,
          `boundary located:   ${boundary ? JSON.stringify(boundary) : 'NO, nothing was recorded and nothing was run'}`,
          `source file:        ${file} line ${line}`,
          `records before:     ${describeRecords(before)}`,
          `records after:      ${describeRecords(after)}`,
          `--- before run, what the runner said (${beforeLog.length} lines) ---`,
          summarise(beforeLog),
          `--- after run, what the runner said (${afterLog.length} lines) ---`,
          summarise(afterLog),
          '=== end ===',
          '',
        ].join('\n'),
      );
    }
    assert.ok(boundary, `no function starts on line ${line} of ${file}`);
    return verdict;
  } finally {
    fs.writeFileSync(absolute, original, 'utf8');
  }
}

/**
 * Angular with Karma. The builder bundles the application before Karma is
 * involved, so the one file is rewritten into a shadow tree and the builder
 * is pointed at the mirror. The record is then made in the browser, held
 * because a page has no disk, and carried back over `__karma__.info` to the
 * reporter, which writes it where every other runner writes it.
 *
 * Four links, and a break in any of them leaves a run that passes and a
 * gate that reports a method the tests never reached.
 */
test('Angular Karma: a recorded run reaches the page and comes back', { timeout: 600_000 }, async () => {
  const root = fixture('helloworld-angular-karma');
  if (!root) {
    return;
  }
  const settings: LanguageSettings = { testsPath: '', sourceRoot: 'src', fields: { runner: 'auto', extraArgs: '' } };
  const line = fs.readFileSync(path.join(root, 'src', 'app', 'names.ts'), 'utf8').split('\n').findIndex((l) => l.includes('export function initials')) + 1;
  assert.ok(line > 0, 'the fixture still has initials() to watch');

  const verdict = await beforeAndAfter('Angular Karma', root, settings, 'src/app/names.ts', line, (source) => source.replace(".join('')", ".join('-')"));
  assert.equal(verdict.verdict, 'changed', 'the record was made in the page, carried back, and compared');
  assert.ok(verdict.verdict === 'changed' && verdict.compared + verdict.differences.length > 0);
});

/**
 * Playwright component tests. The component build is instrumented by the
 * Witness Vite plugin and the page reports to the boundary runtime the same
 * plugin injects; the fixture drains the page and writes what it carried.
 *
 * The standing limit applies: Playwright's own loader short-circuits every
 * other loader in the worker, so only code running in the page is reached.
 * A boundary the page never runs records nothing and the gate reports
 * insufficient evidence, which is the correct answer rather than a
 * purchased one. This watches a function the component itself calls, which
 * is inside the reachable path.
 */
test('Playwright component tests: a boundary inside the page is recorded', { timeout: 600_000 }, async () => {
  const root = fixture('helloworld-react-playwright-ct');
  if (!root) {
    return;
  }
  // No retries. A retried test mounts the component again, which enters the
  // boundary again, and the two runs would then have different counts for
  // the same test and could not be paired.
  const settings: LanguageSettings = { testsPath: '', sourceRoot: 'src', fields: { runner: 'auto', extraArgs: '--retries=0' } };
  const greet = path.join(root, 'src', 'greet.ts');
  assert.ok(fs.existsSync(greet), 'the fixture still has greet.ts, which the component calls in the page');
  const line = fs.readFileSync(greet, 'utf8').split('\n').findIndex((l) => /export function hello/.test(l)) + 1;
  assert.ok(line > 0, 'the fixture still has hello() to watch');

  const verdict = await beforeAndAfter('Playwright component tests', root, settings, 'src/greet.ts', line, (source) => source.replace('Hello, ', 'Hi, '));
  assert.equal(verdict.verdict, 'changed', 'a boundary the page does run is recorded, carried out by the fixture, and compared');
});
