/**
 * The pure model. No vscode, no file system. Given methods with their three
 * numbers, it says which are tangled, ranks them, and, after an untangling,
 * compares before with after to say which pieces came out of a method and
 * whether every one of them fits under the limit.
 *
 * The number that ranks and judges is tangle (MBCC): how hard a method is
 * to follow, which is what untangling is for. Ways through (cyclomatic)
 * rides along for display and for DeepTest's test bar, and is never the
 * driver here: a flat switch has many ways through and a tangle of one, and
 * splitting it into a method per case would leave every piece at one and
 * the class no easier to follow, so the number does not reward it. The
 * extraction that lowers tangle honestly is the one that removes nesting:
 * the piece starts at no nesting and the parent loses a level. One
 * extraction lowers it dishonestly, and the scorer cannot see it, because it
 * measures one method at a time: moving a charged boolean run into a helper
 * turns operands the caller paid for into one call it does not pay for, and
 * the caller's number falls without the reader's work falling with it. That
 * is why every comparison reports what the pieces come to together as well
 * as what the worst piece comes to. A split that only moved the work shows
 * up in the total. A method is
 * tangled when its tangle is over the limit. The limit is the person's;
 * the default is 15 (SonarSource's published default for cognitive
 * complexity per method).
 */
import { FunctionComplexity } from './types';

export interface MeasuredMethod extends FunctionComplexity {
  path: string;
}

export interface Tangled extends MeasuredMethod {
  limit: number;
  /** Tangle (MBCC) above the limit. Always at least 1. */
  over: number;
}

/** Tangled methods, worst first by tangle (MBCC), then by path and line for a stable order. */
export function rankTangled(methods: MeasuredMethod[], limit: number): Tangled[] {
  return methods
    .filter((m) => m.mbcc > limit)
    .map((m) => ({ ...m, limit, over: m.mbcc - limit }))
    .sort((a, b) => b.over - a.over || a.path.localeCompare(b.path) || a.startLine - b.startLine);
}

export interface WorkspaceMeasure {
  methods: MeasuredMethod[];
  tangled: Tangled[];
  limit: number;
  files: number;
}

export function measureWorkspace(methods: MeasuredMethod[], limit: number, files: number): WorkspaceMeasure {
  return { methods, tangled: rankTangled(methods, limit), limit, files };
}

/** What a method looked like when the untangling was requested. */
export interface Snapshot {
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
  campbell: number;
  mbcc: number;
  /** Every method in the same file at the time, so new pieces can be told from old neighbours. */
  siblings: Array<{ name: string; startLine: number; complexity: number; campbell: number; mbcc: number }>;
}

export function snapshot(target: MeasuredMethod, fileMethods: FunctionComplexity[]): Snapshot {
  return {
    path: target.path,
    name: target.name,
    startLine: target.startLine,
    endLine: target.endLine,
    complexity: target.complexity,
    campbell: target.campbell,
    mbcc: target.mbcc,
    siblings: fileMethods.map((m) => ({ name: m.name, startLine: m.startLine, complexity: m.complexity, campbell: m.campbell, mbcc: m.mbcc })),
  };
}

export interface Piece {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
  campbell: number;
  mbcc: number;
  /** Tangle (MBCC) over the limit by this much; 0 when it fits. */
  over: number;
  /** 'original' is the method that was untangled; 'new' appeared since the snapshot; 'changed' existed and its ways through moved. */
  kind: 'original' | 'new' | 'changed';
}

export interface Comparison {
  /** The method by its old name, or undefined when it is gone (renamed or dissolved). */
  original?: Piece;
  pieces: Piece[];
  /** Every piece fits under the limit. */
  withinLimit: boolean;
  /** Sum of tangle (MBCC) over the limit across the pieces; 0 when done. */
  remainingOver: number;
  /** The original still exists and has a lower tangle than before. */
  moved: boolean;
  /** Tangle (MBCC) before, for the sentence "was 48". */
  before: number;
  /** Tangle (MBCC) of the method plus every piece that already existed, as they stood before. */
  totalBefore: number;
  /** Tangle (MBCC) summed across the pieces now. Compare it with totalBefore to see whether the tangle went away or only moved. */
  totalAfter: number;
}

/**
 * Compares the file's methods now with the snapshot. Pieces are the original
 * method (by name) plus every method that is new since the snapshot or whose
 * numbers changed, on the reasoning that an untangling touches only what it
 * creates or splits. Unrelated neighbours that did not move are left out,
 * so they are neither credited nor blamed. Judged by tangle (MBCC).
 */
export function compare(before: Snapshot, after: FunctionComplexity[], limit: number): Comparison {
  const oldByName = new Map(before.siblings.map((s) => [s.name, s]));
  const pieces: Piece[] = [];
  let original: Piece | undefined;
  const piece = (m: FunctionComplexity, kind: Piece['kind']): Piece => ({
    name: m.name,
    startLine: m.startLine,
    endLine: m.endLine,
    complexity: m.complexity,
    campbell: m.campbell,
    mbcc: m.mbcc,
    over: Math.max(0, m.mbcc - limit),
    kind,
  });
  for (const m of after) {
    const old = oldByName.get(m.name);
    if (m.name === before.name) {
      original = piece(m, 'original');
      pieces.push(original);
    } else if (!old) {
      pieces.push(piece(m, 'new'));
    } else if (old.mbcc !== m.mbcc || old.complexity !== m.complexity) {
      pieces.push(piece(m, 'changed'));
    }
  }
  pieces.sort((a, b) => b.over - a.over || a.startLine - b.startLine);
  const remainingOver = pieces.reduce((sum, p) => sum + p.over, 0);
  // The method's own tangle, plus what each neighbour it disturbed was
  // carrying before. A piece that is new contributed nothing before, which
  // is the point: if the work were truly gone the total would fall, and if
  // it were only moved into new methods the total would hold or rise.
  const totalBefore = pieces
    .filter((p) => p.kind === 'changed')
    .reduce((sum, p) => sum + (oldByName.get(p.name)?.mbcc ?? 0), before.mbcc);
  const totalAfter = pieces.reduce((sum, p) => sum + p.mbcc, 0);
  return {
    original,
    pieces,
    withinLimit: pieces.length > 0 && remainingOver === 0,
    remainingOver,
    moved: original !== undefined && original.mbcc < before.mbcc,
    before: before.mbcc,
    totalBefore,
    totalAfter,
  };
}
