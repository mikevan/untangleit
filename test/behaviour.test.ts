/**
 * The behaviour gate's comparator and verdict.
 *
 * These are the rules the gate lives or dies by, so they are tested as
 * rules rather than through a run: a gate that reports equivalent when it
 * compared nothing is worse than no gate, and that failure is invisible in
 * an end-to-end run because everything looks green.
 */
import { test } from 'vitest';
import * as assert from 'node:assert/strict';
import { compareValue, decide, sentence } from '../src/engine/behaviour';
import type { Captured, Observation, OutcomeKind, BoundaryRecord } from '../src/engine/behaviour';

const num = (v: number): Captured => ({ t: 'num', v: String(v) });
const str = (v: string): Captured => ({ t: 'str', v });
const bad = (why: string): Captured => ({ t: 'uncomparable', why });

function at(index: number, args: Captured[], kind: OutcomeKind, value: Captured, test_ = 't1', depth = 0): Observation {
  return { target: 'greet', test: test_, index, depth, args: { t: 'array', v: args }, outcome: { kind, value } };
}

test('comparing values: proven same, proven different, and not knowable are three answers, never two', () => {
  assert.equal(compareValue(num(1), num(1)), 'same');
  assert.equal(compareValue(num(1), num(2)), 'different');
  assert.equal(compareValue(num(1), str('1')), 'different', 'a number is not the string of it');
  assert.equal(compareValue({ t: 'null' }, { t: 'undefined' }), 'different');

  assert.equal(compareValue(bad('instance:Socket'), bad('instance:Socket')), 'unknown', 'two things nobody could compare are not thereby the same');
  assert.equal(compareValue(bad('node-limit'), num(1)), 'unknown', 'a bound crossed on one run only still proves nothing');

  assert.equal(compareValue({ t: 'date', v: 10 }, { t: 'date', v: 10 }), 'same');
  assert.equal(compareValue({ t: 'date', v: 10 }, { t: 'date', v: 11 }), 'different');
  assert.equal(compareValue({ t: 'regex', v: { source: 'a+', flags: 'i' } }, { t: 'regex', v: { source: 'a+', flags: '' } }), 'different', 'flags are part of the pattern');
  assert.equal(compareValue({ t: 'error', v: { name: 'TypeError', message: 'no name' } }, { t: 'error', v: { name: 'TypeError', message: 'no name' } }), 'same');
  assert.equal(compareValue({ t: 'error', v: { name: 'TypeError', message: 'no name' } }, { t: 'error', v: { name: 'ValueError', message: 'no name' } }), 'different');

  assert.equal(compareValue({ t: 'array', v: [num(1)] }, { t: 'array', v: [num(1), num(2)] }), 'different', 'a different length is a difference');
  assert.equal(compareValue({ t: 'array', v: [num(1), bad('cycle')] }, { t: 'array', v: [num(1), bad('cycle')] }), 'unknown', 'one element matching says nothing about the other');
  assert.equal(compareValue({ t: 'array', v: [num(1), bad('cycle')] }, { t: 'array', v: [num(2), bad('cycle')] }), 'different', 'a proven difference decides, whatever else could not be read');
  assert.equal(compareValue({ t: 'object', v: { a: num(1) } }, { t: 'object', v: { b: num(1) } }), 'different', 'different keys are a difference');
  assert.equal(compareValue({ t: 'object', v: { a: num(1) } }, { t: 'object', v: { a: num(1) } }), 'same');
});

test('the verdict: a correct untangling is equivalent, and nothing else quietly becomes one', () => {
  const before: BoundaryRecord[] = [at(0, [str('Jeff')], 'return', str('Jeff')), at(1, [str('')], 'throw', { t: 'error', v: { name: 'TypeError', message: 'no name' } })];

  // The method was rewritten and still does what it did.
  assert.deepEqual(decide(before, [...before]), { verdict: 'equivalent', compared: 2 });

  // A changed return value.
  const changedValue = [at(0, [str('Jeff')], 'return', str('JEFF')), before[1]] as BoundaryRecord[];
  const one = decide(before, changedValue);
  assert.equal(one.verdict, 'changed');
  assert.equal(one.verdict === 'changed' && one.differences.length, 1);
  assert.deepEqual(one.verdict === 'changed' && one.differences[0].after.value, str('JEFF'));

  // A changed thrown outcome: it returns now where it used to throw. This is
  // the case a gate that only compares values passes without noticing.
  const changedKind = [before[0], at(1, [str('')], 'return', { t: 'null' })] as BoundaryRecord[];
  const two = decide(before, changedKind);
  assert.equal(two.verdict, 'changed');
  assert.deepEqual(two.verdict === 'changed' && two.differences[0].before.kind, 'throw');

  // The same value, handed back a different way. An assistant that made the
  // method async changed what every caller gets, and the value alone cannot
  // see it: only the kind can.
  const nowAsync = [at(0, [str('Jeff')], 'resolve', str('Jeff')), before[1]] as BoundaryRecord[];
  const three = decide(before, nowAsync);
  assert.equal(three.verdict, 'changed', 'a synchronous return that became a resolved promise is a change');

  // And the same for the failing path: a throw the caller could catch became
  // a rejection it cannot.
  const nowRejects = [before[0], at(1, [str('')], 'reject', { t: 'error', v: { name: 'TypeError', message: 'no name' } })] as BoundaryRecord[];
  assert.equal(decide(before, nowRejects).verdict, 'changed', 'a synchronous throw that became a rejection is a change');

  // A rejection that became a resolve, on the async path.
  const asyncBefore: BoundaryRecord[] = [at(0, [num(0)], 'reject', { t: 'error', v: { name: 'RangeError', message: 'zero' } })];
  const asyncAfter: BoundaryRecord[] = [at(0, [num(0)], 'resolve', num(0))];
  assert.equal(decide(asyncBefore, asyncAfter).verdict, 'changed');
});

test('the verdict: every way of having no evidence reports as having no evidence', () => {
  const before: BoundaryRecord[] = [at(0, [str('Jeff')], 'return', str('Jeff'))];

  const reason = (v: ReturnType<typeof decide>): string => (v.verdict === 'insufficient' ? v.reason : v.verdict);

  assert.equal(reason(decide([], [])), 'never-exercised', 'a method no test reaches is not verified by a green suite');
  assert.equal(reason(decide(before, [])), 'never-exercised');
  assert.equal(reason(decide([{ problem: 'target-not-found', target: 'pkg:greet' }], before)), 'target-not-found');
  assert.equal(reason(decide(before, [{ problem: 'unsupported-target', target: 'pkg:greet' }])), 'unsupported-target');

  // A test that entered a different number of times cannot be paired.
  assert.equal(reason(decide(before, [...before, at(1, [str('Ann')], 'return', str('Ann'))])), 'unstable-pairing');
  // A test present in one run and not the other.
  assert.equal(reason(decide(before, [at(0, [str('Jeff')], 'return', str('Jeff'), 't2')])), 'unstable-pairing');
  // The same index at a different depth: the ordering moved under us.
  assert.equal(reason(decide(before, [at(0, [str('Jeff')], 'return', str('Jeff'), 't1', 1)])), 'unstable-pairing');
  // Called with different arguments, which the unchanged tests cannot have done.
  assert.equal(reason(decide(before, [at(0, [str('Ann')], 'return', str('Ann'))])), 'arguments-differ');

  // Everything paired, and not one thing could be compared.
  const opaque: BoundaryRecord[] = [at(0, [bad('instance:Request')], 'return', bad('instance:Response'))];
  assert.equal(reason(decide(opaque, [...opaque])), 'nothing-comparable', 'a gate that compared nothing has not verified anything');

  // A comparison that did happen still counts, even beside one that could not.
  const mixed: BoundaryRecord[] = [at(0, [str('Jeff')], 'return', str('Jeff')), at(1, [bad('instance:Request')], 'return', bad('instance:Response'))];
  assert.deepEqual(decide(mixed, [...mixed]), { verdict: 'equivalent', compared: 1 });
});

test('the wording never claims more than the gate can show', () => {
  const equivalent = sentence({ verdict: 'equivalent', compared: 3 }, 'Greeter.greet');
  assert.match(equivalent, /this method's boundary and nothing else/, 'the gap between the runs belongs to the person, so the claim stops at the boundary');
  assert.doesNotMatch(equivalent, /\b(safe|correct|verified|proven|no regress)/i, 'equivalent is not a certificate');

  for (const reason of ['target-not-found', 'unsupported-target', 'never-exercised', 'unstable-pairing', 'arguments-differ', 'nothing-comparable'] as const) {
    const said = sentence({ verdict: 'insufficient', reason }, 'Greeter.greet');
    assert.match(said, /nothing here is verified|does not cover this method/i, `"${reason}" stops any claim of verification`);
  }
  assert.match(sentence({ verdict: 'changed', compared: 1, differences: [{ test: 't1', index: 0, args: { t: 'array', v: [] }, before: { kind: 'return', value: str('a') }, after: { kind: 'return', value: str('b') } }] }, 'Greeter.greet'), /not behaviour-verified/);
});
