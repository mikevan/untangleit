/**
 * Every sentence UntangleIt says, in one place, written for Jeff first.
 * The plain word is "tangle": how hard a method is to follow. The number
 * behind it is MikeVan's Better Cognitive Complexity (MBCC); Campbell's
 * published Cognitive Complexity and ways through (cyclomatic complexity)
 * appear beside it only when "Show the engineer's numbers" is on. Every
 * sentence is complete and ends with punctuation; every instruction names
 * the control exactly as it is labelled on screen.
 */
import { Comparison, Tangled, WorkspaceMeasure } from '../engine/tangle';
import { RunRecord } from '../runs';
import { TestRunSummary } from '../languages/types';

export const PRODUCT = 'UntangleIt';

/** The full product name, series included. Used where the product is named in full,
 *  never in running text like "UntangleIt: checking", which reads worse with it. */
export const PRODUCT_FULL = `${PRODUCT} - Polyglot`;

export interface Voice {
  showNumbers: boolean;
}

export function ways(n: number): string {
  return `${n} way${n === 1 ? '' : 's'} through`;
}

/** "a tangle of 14" */
export function tangle(n: number): string {
  return `a tangle of ${n}`;
}

/** "was a tangle of 15", or "was 15 ways through" for a record from 0.1.x, which judged by ways through. */
export function wasBefore(r: { before: number; measure?: 'ways' | 'mbcc' }): string {
  return r.measure === 'mbcc' ? `was ${tangle(r.before)}` : `was ${ways(r.before)}`;
}

/** The three numbers for the engineer's switch: "MBCC 14, Campbell 12, 9 ways through". */
export function threeNumbers(m: { complexity: number; campbell: number; mbcc: number }): string {
  return `MBCC ${m.mbcc}, Campbell ${m.campbell}, ${ways(m.complexity)}`;
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The headline for a measured workspace. */
export function verdict(m: WorkspaceMeasure): { ready: boolean; headline: string; detail: string } {
  if (m.methods.length === 0) {
    return { ready: true, headline: 'No methods were found to measure.', detail: 'Check the folder with the code on the setup screen.' };
  }
  if (m.tangled.length === 0) {
    return { ready: true, headline: 'Every method is within your limit.', detail: `${plural(m.methods.length, 'method')} in ${plural(m.files, 'file')}, none with ${tangle(m.limit + 1)} or more.` };
  }
  const worst = m.tangled[0];
  return {
    ready: false,
    headline: `${plural(m.tangled.length, 'method')} ${m.tangled.length === 1 ? 'is' : 'are'} too tangled.`,
    detail: `Your limit is ${tangle(m.limit)}. The worst is ${worst.name}() with ${tangle(worst.mbcc)}. ${plural(m.methods.length, 'method')} measured in ${plural(m.files, 'file')}.`,
  };
}

/** One line for a tangled method in the list. */
export function tangledSentence(t: Tangled, voice: Voice): string {
  const plain = `${t.name}() has ${tangle(t.mbcc)}. Your limit is ${t.limit}.`;
  return voice.showNumbers ? `${plain} (${threeNumbers(t)}; ${t.over} over)` : plain;
}

/** What "too tangled" means, for the card and the report. */
export function meaning(t: Tangled): string {
  return `Tangle is how hard a method is to follow. It goes up with every decision, more for a decision nested inside another, and more again when the reader has to hold earlier checks in their head to understand a later one. ${t.name}() has ${tangle(t.mbcc)}; above ${t.limit} a person cannot hold it in their head, and any change can break something nobody saw. It also has ${ways(t.complexity)}, which is how many tests it needs; that number is DeepTest's job and does not change here.`;
}

export function testsSentence(t: TestRunSummary): string {
  if (t.failed > 0 || t.errors > 0) {
    return `${plural(t.failed + t.errors, 'test')} fail${t.failed + t.errors === 1 ? 's' : ''}.`;
  }
  if (t.passed === 0 && t.exitCode !== 0) {
    return 'The tests could not run.';
  }
  return `All ${plural(t.passed, 'test')} pass.`;
}

/**
 * What the pieces come to together. The worst piece falling is not the same
 * as the tangle going away: a helper that only takes a charged boolean run
 * out of its caller lowers the caller's number and leaves the reader with
 * the same work in two places. The total is what shows the difference, so
 * the person decides on both numbers rather than on the headline alone.
 */
function totalSentence(c: Comparison): string {
  if (c.pieces.length < 2) {
    return '';
  }
  if (c.totalAfter >= c.totalBefore) {
    return ` Together the pieces come to ${c.totalAfter}, against ${c.totalBefore} before, so the tangle moved rather than went away.`;
  }
  return ` Together the pieces come to ${c.totalAfter}, against ${c.totalBefore} before.`;
}

/** The sentence after a "Measure again". */
export function outcomeSentence(c: Comparison, tests: TestRunSummary | undefined, limit: number, name: string): string {
  const failing = tests ? tests.failed + tests.errors : 0;
  if (tests && failing > 0) {
    return `The untangling broke ${plural(failing, 'test')}. Behaviour changed, which the brief forbade. Restore the checkpoint, or send it back.`;
  }
  if (!c.original && c.pieces.length === 0) {
    return `${name}() is gone and no new methods appeared in its file. If the assistant moved it to another file, open that file and measure it there.`;
  }
  const piecesText = `${plural(c.pieces.length, 'piece')}: ${c.pieces.map((p) => `${p.name}() ${p.mbcc}`).join(', ')}.`;
  if (c.withinLimit) {
    return `Untangled into ${piecesText} Every piece is within your limit of ${limit}.${totalSentence(c)}${tests ? ` ${testsSentence(tests)}` : ''}`;
  }
  const over = c.pieces.filter((p) => p.over > 0);
  return `Not done. ${piecesText} ${plural(over.length, 'piece')} ${over.length === 1 ? 'is' : 'are'} still over your limit of ${limit}${c.moved ? `; ${name}() went from ${c.before} to ${c.original?.mbcc}` : ''}.${totalSentence(c)}${tests ? ` ${testsSentence(tests)}` : ''} Your call.`;
}

/** The status line for an open or finished run, under a method in the list. */
export function runSentence(r: RunRecord): string {
  const date = r.startedAt.slice(0, 10);
  switch (r.status) {
    case 'sent':
      return `Sent to your assistant on ${date} (round ${r.rounds}). When it says done, press "Measure again".`;
    case 'within-limit':
      return `Untangled on ${r.measuredAt?.slice(0, 10) ?? date}: ${wasBefore(r)}, every piece within ${r.limit}.`;
    case 'still-over':
      return `After ${plural(r.rounds, 'round')}, still over your limit. ${r.outcome ?? ''}`.trim();
    case 'tests-fail':
      return `After round ${r.rounds}, tests fail. ${r.outcome ?? ''}`.trim();
    case 'stopped':
      return `Stopped on ${r.measuredAt?.slice(0, 10) ?? date} after ${plural(r.rounds, 'round')}. ${r.outcome ?? ''}`.trim();
    default:
      return '';
  }
}
