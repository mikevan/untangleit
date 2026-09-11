/**
 * Every sentence UntangleIt says, in one place, written for Jeff first.
 * Engineer's terms (cyclomatic complexity) appear only beside the plain
 * phrase and only when "Show the engineer's numbers" is on. Every sentence
 * is complete and ends with punctuation; every instruction names the
 * control exactly as it is labelled on screen.
 */
import { Comparison, Tangled, WorkspaceMeasure } from '../engine/tangle';
import { RunRecord } from '../runs';
import { TestRunSummary } from '../languages/types';

export const PRODUCT = 'UntangleIt';

export interface Voice {
  showNumbers: boolean;
}

export function ways(n: number): string {
  return `${n} way${n === 1 ? '' : 's'} through`;
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
    return { ready: true, headline: 'Every method is within your limit.', detail: `${plural(m.methods.length, 'method')} in ${plural(m.files, 'file')}, none with more than ${ways(m.limit)}.` };
  }
  const worst = m.tangled[0];
  return {
    ready: false,
    headline: `${plural(m.tangled.length, 'method')} ${m.tangled.length === 1 ? 'is' : 'are'} too tangled.`,
    detail: `Your limit is ${ways(m.limit)}. The worst is ${worst.name}() with ${worst.complexity}. ${plural(m.methods.length, 'method')} measured in ${plural(m.files, 'file')}.`,
  };
}

/** One line for a tangled method in the list. */
export function tangledSentence(t: Tangled, voice: Voice): string {
  const plain = `${t.name}() has ${ways(t.complexity)}. Your limit is ${t.limit}.`;
  return voice.showNumbers ? `${plain} (cyclomatic complexity ${t.complexity}, ${t.over} over)` : plain;
}

/** What "too tangled" means, for the card and the report. */
export function meaning(t: Tangled): string {
  return `This one method makes ${t.complexity - 1} decisions, so there are ${t.complexity} different paths a program can take through it, and each one has to be tested before anyone can say it works. Above ${t.limit} a person cannot hold it in their head, and any change can break a path nobody thought to test.`;
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

/** The sentence after a "Measure again". */
export function outcomeSentence(c: Comparison, tests: TestRunSummary | undefined, limit: number, name: string): string {
  const failing = tests ? tests.failed + tests.errors : 0;
  if (tests && failing > 0) {
    return `The untangling broke ${plural(failing, 'test')}. Behaviour changed, which the brief forbade. Restore the checkpoint, or send it back.`;
  }
  if (!c.original && c.pieces.length === 0) {
    return `${name}() is gone and no new methods appeared in its file. If the assistant moved it to another file, open that file and measure it there.`;
  }
  const piecesText = `${plural(c.pieces.length, 'piece')}: ${c.pieces.map((p) => `${p.name}() ${p.complexity}`).join(', ')}.`;
  if (c.withinLimit) {
    return `Untangled into ${piecesText} Every piece is within your limit of ${limit}.${tests ? ` ${testsSentence(tests)}` : ''}`;
  }
  const over = c.pieces.filter((p) => p.over > 0);
  return `Not done. ${piecesText} ${plural(over.length, 'piece')} ${over.length === 1 ? 'is' : 'are'} still over your limit of ${limit}${c.moved ? `; ${name}() went from ${c.before} to ${c.original?.complexity}` : ''}.${tests ? ` ${testsSentence(tests)}` : ''} Your call.`;
}

/** The status line for an open or finished run, under a method in the list. */
export function runSentence(r: RunRecord): string {
  const date = r.startedAt.slice(0, 10);
  switch (r.status) {
    case 'sent':
      return `Sent to your assistant on ${date} (round ${r.rounds}). When it says done, press "Measure again".`;
    case 'within-limit':
      return `Untangled on ${r.measuredAt?.slice(0, 10) ?? date}: was ${r.before}, every piece within ${r.limit}.`;
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
