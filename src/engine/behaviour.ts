/**
 * The behaviour gate's comparator and verdict.
 *
 * One comparator, one meaning of equivalent, for every language. It reads
 * the tagged records a recorder writes and never learns which language
 * produced them: Witness's boundary recorder for JavaScript and TypeScript
 * and the pytest plugin for Python both write this shape.
 *
 * The whole file is pure. It takes two lists of records, the run before the
 * hand-off and the run at "Measure again", and returns a verdict. It reads
 * no files, launches nothing, and knows nothing about the editor.
 *
 * The rule that shapes every decision here: a lack of evidence never
 * becomes a pass. When the gate cannot pair two observations, or cannot
 * compare two values, it says so. It never guesses a match, and it never
 * reports equivalent on the strength of a comparison it did not make.
 */

import type { Captured, Observation, OutcomeKind, Problem, BoundaryRecord } from '@projectrevivesolutions/witness';
import { isProblem } from '@projectrevivesolutions/witness';

export type { Captured, Observation, OutcomeKind, Problem, BoundaryRecord };

/** Why the gate could not decide. Each is reported to the person in its own words. */
export type Insufficient = 'target-not-found' | 'unsupported-target' | 'never-exercised' | 'unstable-pairing' | 'arguments-differ' | 'nothing-comparable';

/** One paired observation that compared and disagreed. */
export interface Difference {
  test: string | null;
  index: number;
  args: Captured;
  before: { kind: OutcomeKind; value: Captured };
  after: { kind: OutcomeKind; value: Captured };
}

export type Verdict =
  | { verdict: 'equivalent'; compared: number }
  | { verdict: 'changed'; compared: number; differences: Difference[] }
  | { verdict: 'insufficient'; reason: Insufficient };

/**
 * Whether two captured values are the same, different, or not knowable.
 *
 * `unknown` is the answer whenever an uncomparable value is involved on
 * either side. Two things nobody could compare are not thereby the same,
 * and calling them the same is exactly how a gate reports equivalent about
 * a method it never really checked.
 */
export type Comparison = 'same' | 'different' | 'unknown';

function combine(parts: Comparison[]): Comparison {
  // A single proven difference decides. Otherwise one unknown is enough to
  // leave the whole value unproven: two of three fields matching says
  // nothing about the third.
  if (parts.some((p) => p === 'different')) {
    return 'different';
  }
  return parts.some((p) => p === 'unknown') ? 'unknown' : 'same';
}

export function compareValue(before: Captured, after: Captured): Comparison {
  if (before.t === 'uncomparable' || after.t === 'uncomparable') {
    return 'unknown';
  }
  if (before.t !== after.t) {
    return 'different';
  }
  switch (before.t) {
    case 'null':
    case 'undefined':
      return 'same';
    case 'num':
    case 'str':
      return before.v === (after as typeof before).v ? 'same' : 'different';
    case 'bool':
      return before.v === (after as typeof before).v ? 'same' : 'different';
    case 'date':
      return before.v === (after as typeof before).v ? 'same' : 'different';
    case 'regex': {
      const other = (after as typeof before).v;
      return before.v.source === other.source && before.v.flags === other.flags ? 'same' : 'different';
    }
    case 'error': {
      // Type name and message. Stacks are not compared: a stack changes
      // whenever the code moves, which is the one thing that certainly happened.
      const other = (after as typeof before).v;
      return before.v.name === other.name && before.v.message === other.message ? 'same' : 'different';
    }
    case 'array': {
      const other = (after as typeof before).v;
      if (before.v.length !== other.length) {
        return 'different';
      }
      return combine(before.v.map((item, at) => compareValue(item, other[at])));
    }
    case 'object': {
      const other = (after as typeof before).v;
      const keys = Object.keys(before.v).sort();
      const otherKeys = Object.keys(other).sort();
      if (keys.length !== otherKeys.length || keys.some((key, at) => key !== otherKeys[at])) {
        return 'different';
      }
      return combine(keys.map((key) => compareValue(before.v[key], other[key])));
    }
  }
}

/** The observations of one run, grouped by test, each in entry order. */
function byTest(records: Observation[]): Map<string, Observation[]> {
  const out = new Map<string, Observation[]>();
  for (const record of records) {
    const key = record.test === null ? '\u0000no-test' : record.test;
    const list = out.get(key);
    if (list) {
      list.push(record);
    } else {
      out.set(key, [record]);
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.index - b.index);
  }
  return out;
}

/**
 * The verdict for one boundary, from the run before the hand-off and the
 * run at "Measure again".
 */
export function decide(before: BoundaryRecord[], after: BoundaryRecord[]): Verdict {
  for (const record of [...before, ...after]) {
    if (isProblem(record)) {
      // The recorder never attached, so there is nothing to compare and no
      // claim to make. The person is told which.
      return { verdict: 'insufficient', reason: record.problem };
    }
  }

  const first = before as Observation[];
  const second = after as Observation[];
  if (first.length === 0 || second.length === 0) {
    return { verdict: 'insufficient', reason: 'never-exercised' };
  }

  const left = byTest(first);
  const right = byTest(second);
  if (left.size !== right.size || [...left.keys()].some((key) => !right.has(key))) {
    return { verdict: 'insufficient', reason: 'unstable-pairing' };
  }

  const pairs: Array<[Observation, Observation]> = [];
  for (const [key, mine] of left) {
    const theirs = right.get(key)!;
    if (mine.length !== theirs.length) {
      // A test that entered the boundary a different number of times cannot
      // be paired. Something reordered, and which call is which is a guess.
      return { verdict: 'insufficient', reason: 'unstable-pairing' };
    }
    for (let at = 0; at < mine.length; at += 1) {
      if (mine[at].depth !== theirs[at].depth) {
        return { verdict: 'insufficient', reason: 'unstable-pairing' };
      }
      pairs.push([mine[at], theirs[at]]);
    }
  }

  for (const [mine, theirs] of pairs) {
    if (compareValue(mine.args, theirs.args) === 'different') {
      // The tests did not change, so a call arriving with different
      // arguments means something reordered. That is not proof the method
      // changed, and it is not proof it did not.
      return { verdict: 'insufficient', reason: 'arguments-differ' };
    }
  }

  const differences: Difference[] = [];
  let compared = 0;
  for (const [mine, theirs] of pairs) {
    if (mine.outcome.kind !== theirs.outcome.kind) {
      // Returning where it used to throw is a change, and the most
      // important one this gate catches.
      differences.push({ test: mine.test, index: mine.index, args: mine.args, before: mine.outcome, after: theirs.outcome });
      continue;
    }
    const result = compareValue(mine.outcome.value, theirs.outcome.value);
    if (result === 'different') {
      differences.push({ test: mine.test, index: mine.index, args: mine.args, before: mine.outcome, after: theirs.outcome });
    } else if (result === 'same') {
      compared += 1;
    }
  }

  if (differences.length > 0) {
    return { verdict: 'changed', compared, differences };
  }
  if (compared === 0) {
    // Every observation paired and none of them could be compared. The gate
    // ran and learned nothing, which is not a pass.
    return { verdict: 'insufficient', reason: 'nothing-comparable' };
  }
  return { verdict: 'equivalent', compared };
}

/**
 * The one sentence the person is shown. The wording of `equivalent` is
 * deliberately narrow: the gap between the two runs belongs to the person
 * and their assistant, so the gate can say nothing about the rest of the
 * file or the rest of the application, and must never be worded as if it
 * could.
 */
export function sentence(verdict: Verdict, target: string): string {
  if (verdict.verdict === 'equivalent') {
    return `For the tests that exercised it, "${target}" behaved the same before the hand-off and now. That covers this method's boundary and nothing else.`;
  }
  if (verdict.verdict === 'changed') {
    const count = verdict.differences.length;
    return `"${target}" does not behave the same as it did. ${count === 1 ? 'One call' : `${count} calls`} ended differently. This is not behaviour-verified.`;
  }
  switch (verdict.reason) {
    case 'target-not-found':
      return `"${target}" could not be found again after the hand-off, so nothing was compared. Nothing here is verified.`;
    case 'unsupported-target':
      return `"${target}" is a kind of method this gate does not record, so nothing was compared. Nothing here is verified.`;
    case 'never-exercised':
      return `No test reached "${target}", so there is nothing to compare. A green suite does not cover this method.`;
    case 'unstable-pairing':
      return `The two runs entered "${target}" in ways that could not be matched up, so nothing was compared. Nothing here is verified.`;
    case 'arguments-differ':
      return `"${target}" was called with different arguments in the two runs, so the calls could not be matched up. Nothing here is verified.`;
    case 'nothing-comparable':
      return `"${target}" was exercised, but nothing it took or returned could be compared. Nothing here is verified.`;
  }
}
