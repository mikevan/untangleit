import { test } from 'vitest';
import assert from 'node:assert/strict';
import { compare, measureWorkspace, rankTangled, snapshot } from '../src/engine/tangle';
import { buildUntangleBrief } from '../src/report/brief';
import { emptyRunFile, openRunFor, upsertRun } from '../src/runs';
import { outcomeSentence, runSentence, tangledSentence, verdict, wasBefore } from '../src/ui/words';

/**
 * A method with the given tangle (MBCC). Campbell is set two below it and
 * ways through is fixed at 99 for every method, so any test that passes
 * proves the ranking and the judging read MBCC and nothing else.
 */
const m = (name: string, tangle: number, startLine = 1, path = 'a.ts') => ({ name, complexity: 99, campbell: Math.max(0, tangle - 2), mbcc: tangle, startLine, endLine: startLine + 9, path });

test('rankTangled keeps only methods over the limit by tangle, worst first, stable by path and line', () => {
  const ranked = rankTangled([m('a', 3), m('b', 12, 20), m('c', 7, 5, 'b.ts'), m('d', 7, 40)], 5);
  assert.deepEqual(
    ranked.map((t) => [t.name, t.over]),
    [
      ['b', 7],
      ['d', 2],
      ['c', 2],
    ],
  );
  assert.equal(rankTangled([m('a', 5)], 5).length, 0);
  // A flat switch: 29 ways through, tangle 1. Never tangled, whatever the limit.
  const flat = { name: 'dispatch', complexity: 29, campbell: 1, mbcc: 1, startLine: 1, endLine: 60, path: 'a.ts' };
  assert.equal(rankTangled([flat], 5).length, 0);
  assert.equal(rankTangled([flat], 1).length, 0);
});

test('verdict speaks plainly for none, all fine, and tangled', () => {
  assert.equal(verdict(measureWorkspace([], 5, 0)).headline, 'No methods were found to measure.');
  const fine = verdict(measureWorkspace([m('a', 2), m('b', 5)], 5, 1));
  assert.equal(fine.ready, true);
  assert.equal(fine.headline, 'Every method is within your limit.');
  assert.equal(fine.detail, '2 methods in 1 file, none with a tangle of 6 or more.');
  const bad = verdict(measureWorkspace([m('a', 2), m('big', 14)], 5, 1));
  assert.equal(bad.ready, false);
  assert.equal(bad.headline, '1 method is too tangled.');
  assert.equal(bad.detail, 'Your limit is a tangle of 5. The worst is big() with a tangle of 14. 2 methods measured in 1 file.');
});

test('tangledSentence hides the engineer\'s numbers unless asked', () => {
  const t = rankTangled([m('big', 14)], 5)[0];
  assert.equal(tangledSentence(t, { showNumbers: false }), 'big() has a tangle of 14. Your limit is 5.');
  assert.equal(tangledSentence(t, { showNumbers: true }), 'big() has a tangle of 14. Your limit is 5. (MBCC 14, Campbell 12, 99 ways through; 9 over)');
});

test('compare: pieces are the original, the new, and the changed; unrelated neighbours stay out', () => {
  const before = snapshot(m('big', 14), [m('big', 14), m('helper', 2, 30), m('other', 3, 50)]);
  const after = [m('big', 4), m('helper', 2, 30), m('other', 3, 50), m('bigPartA', 5, 60), m('bigPartB', 6, 80)];
  const c = compare(before, after, 5);
  assert.deepEqual(
    c.pieces.map((p) => [p.name, p.mbcc, p.over, p.kind]),
    [
      ['bigPartB', 6, 1, 'new'],
      ['big', 4, 0, 'original'],
      ['bigPartA', 5, 0, 'new'],
    ],
  );
  assert.equal(c.withinLimit, false);
  assert.equal(c.remainingOver, 1);
  assert.equal(c.moved, true);
  assert.equal(c.before, 14);

  const done = compare(before, [m('big', 3), m('helper', 2, 30), m('other', 3, 50), m('bigPartA', 5, 60)], 5);
  assert.equal(done.withinLimit, true);
  assert.equal(done.remainingOver, 0);

  const gone = compare(before, [m('helper', 2, 30), m('other', 3, 50)], 5);
  assert.equal(gone.original, undefined);
  assert.equal(gone.pieces.length, 0);
  assert.equal(gone.withinLimit, false);

  const neighbourChanged = compare(before, [m('big', 14), m('helper', 4, 30), m('other', 3, 50)], 5);
  assert.deepEqual(
    neighbourChanged.pieces.map((p) => [p.name, p.kind]),
    [
      ['big', 'original'],
      ['helper', 'changed'],
    ],
  );
});

test('outcomeSentence: within limit, still over, tests fail, and gone', () => {
  const before = snapshot(m('big', 14), [m('big', 14)]);
  const tests = { passed: 9, failed: 0, errors: 0, skipped: 0, exitCode: 0 };
  const ok = compare(before, [m('big', 3), m('bigPartA', 5, 60)], 5);
  assert.equal(outcomeSentence(ok, tests, 5, 'big'), 'Untangled into 2 pieces: big() 3, bigPartA() 5. Every piece is within your limit of 5. All 9 tests pass.');
  const over = compare(before, [m('big', 8), m('bigPartA', 5, 60)], 5);
  assert.equal(outcomeSentence(over, tests, 5, 'big'), 'Not done. 2 pieces: big() 8, bigPartA() 5. 1 piece is still over your limit of 5; big() went from 14 to 8. All 9 tests pass. Your call.');
  assert.match(outcomeSentence(ok, { ...tests, failed: 2 }, 5, 'big'), /^The untangling broke 2 tests\. Behaviour changed/);
  const gone = compare(before, [], 5);
  assert.match(outcomeSentence(gone, tests, 5, 'big'), /^big\(\) is gone and no new methods appeared/);
  assert.equal(outcomeSentence(ok, undefined, 5, 'big'), 'Untangled into 2 pieces: big() 3, bigPartA() 5. Every piece is within your limit of 5.');
});

test('the brief states the target three ways, quotes the method, and ends with the judge sentence', () => {
  const brief = buildUntangleBrief({
    path: 'src/calc.ts',
    name: 'describeNumber',
    startLine: 30,
    endLine: 50,
    complexity: 8,
    campbell: 8,
    mbcc: 9,
    limit: 5,
    source: [{ line: 30, text: 'export function describeNumber(n: number): string {' }],
    sourceTruncated: true,
    testsPath: 'test',
    language: 'TypeScript / JavaScript',
    round: 1,
  });
  assert.match(brief, /^# UntangleIt: bring describeNumber\(\) in src\/calc\.ts down to a tangle of at most 5/);
  assert.match(brief, /It does not mean "reduce by 5"\. A method that goes from 9 to 6 has not met the target\./);
  assert.match(brief, /It has a tangle of 9 \(MBCC 9; Campbell 8; 8 ways through, which is its cyclomatic complexity and is not the target\)\./);
  assert.match(brief, /Splitting a flat `switch`, or a flat chain on one value, into one method per case does NOT lower tangle/);
  assert.match(brief, /the k-th branch costs k/);
  assert.match(brief, /  30 \| export function describeNumber/);
  assert.match(brief, /cut here; read the rest of the method from the file/);
  assert.match(brief, /The existing tests pass without being edited/);
  assert.match(brief, /It will not accept the result on your behalf/);
  assert.doesNotMatch(brief, /This is round/);

  const round2 = buildUntangleBrief({
    path: 'src/calc.ts',
    name: 'describeNumber',
    startLine: 30,
    endLine: 40,
    complexity: 6,
    campbell: 7,
    mbcc: 7,
    limit: 5,
    source: [],
    sourceTruncated: false,
    testsPath: '',
    language: 'Python',
    round: 2,
    remaining: [{ name: 'describeNumber', startLine: 30, endLine: 40, complexity: 6, campbell: 7, mbcc: 7, over: 2, kind: 'original' }],
  });
  assert.match(round2, /This is round 2\./);
  assert.match(round2, /## What the last round left over the limit/);
  assert.match(round2, /- `describeNumber\(\)` \(line 30\): a tangle of 7, 2 over the limit\./);
  assert.match(round2, /\(workspace root\)/);
});

test('runs: the open run is the newest unfinished one, and the sentences read as a record', () => {
  const base = { path: 'a.ts', name: 'big', startLine: 1, before: 14, limit: 5, by: 'mike', startedAt: '2026-09-06T10:00:00Z', snapshot: snapshot(m('big', 14), [m('big', 14)]) };
  let file = emptyRunFile();
  file = upsertRun(file, { ...base, id: 'r1', rounds: 1, status: 'sent' });
  assert.equal(openRunFor(file, 'a.ts', 'big')?.id, 'r1');
  assert.equal(runSentence(file.runs[0]), 'Sent to your assistant on 2026-09-06 (round 1). When it says done, press "Measure again".');
  file = upsertRun(file, { ...base, id: 'r1', rounds: 1, status: 'within-limit', measuredAt: '2026-09-07T10:00:00Z' });
  assert.equal(openRunFor(file, 'a.ts', 'big'), undefined);
  assert.equal(runSentence(file.runs[0]), 'Untangled on 2026-09-07: was 14 ways through, every piece within 5.');
  // A record written by 0.1.x judged by ways through and has no `measure`; one from 0.1.11 on says so.
  assert.equal(wasBefore({ before: 15 }), 'was 15 ways through');
  assert.equal(wasBefore({ before: 15, measure: 'ways' }), 'was 15 ways through');
  assert.equal(wasBefore({ before: 47, measure: 'mbcc' }), 'was a tangle of 47');
  assert.equal(runSentence({ ...file.runs[0], measure: 'mbcc', before: 47 }), 'Untangled on 2026-09-07: was a tangle of 47, every piece within 5.');
  file = upsertRun(file, { ...base, id: 'r2', rounds: 2, status: 'still-over', outcome: 'Not done.' });
  assert.equal(openRunFor(file, 'a.ts', 'big')?.id, 'r2');
  assert.equal(runSentence(file.runs[1]), 'After 2 rounds, still over your limit. Not done.');
});
