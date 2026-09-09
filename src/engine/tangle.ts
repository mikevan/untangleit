/**
 * The pure model. No vscode, no file system. Given methods with their ways
 * through, it says which are tangled, ranks them, and, after an untangling,
 * compares before with after to say which pieces came out of a method and
 * whether every one of them fits under the limit.
 *
 * "Ways through" is McCabe cyclomatic complexity: one, plus one per
 * decision. A method is tangled when it is over the limit. The limit is the
 * person's; the default is 5.
 */
import { FunctionComplexity } from './types';

export interface MeasuredMethod extends FunctionComplexity {
  path: string;
}

export interface Tangled extends MeasuredMethod {
  limit: number;
  /** Ways through above the limit. Always at least 1. */
  over: number;
}

/** Tangled methods, worst first, then by path and line for a stable order. */
export function rankTangled(methods: MeasuredMethod[], limit: number): Tangled[] {
  return methods
    .filter((m) => m.complexity > limit)
    .map((m) => ({ ...m, limit, over: m.complexity - limit }))
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
  /** Every method in the same file at the time, so new pieces can be told from old neighbours. */
  siblings: Array<{ name: string; startLine: number; complexity: number }>;
}

export function snapshot(target: MeasuredMethod, fileMethods: FunctionComplexity[]): Snapshot {
  return {
    path: target.path,
    name: target.name,
    startLine: target.startLine,
    endLine: target.endLine,
    complexity: target.complexity,
    siblings: fileMethods.map((m) => ({ name: m.name, startLine: m.startLine, complexity: m.complexity })),
  };
}

export interface Piece {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
  /** Over the limit by this much; 0 when it fits. */
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
  /** Sum of ways through over the limit across the pieces; 0 when done. */
  remainingOver: number;
  /** The original still exists and has fewer ways through than before. */
  moved: boolean;
  /** Ways through before, for the sentence "was 48". */
  before: number;
}

/**
 * Compares the file's methods now with the snapshot. Pieces are the original
 * method (by name) plus every method that is new since the snapshot or whose
 * ways through changed, on the reasoning that an untangling touches only
 * what it creates or splits. Unrelated neighbours that did not move are left
 * out, so they are neither credited nor blamed.
 */
export function compare(before: Snapshot, after: FunctionComplexity[], limit: number): Comparison {
  const oldByName = new Map(before.siblings.map((s) => [s.name, s]));
  const pieces: Piece[] = [];
  let original: Piece | undefined;
  for (const m of after) {
    const old = oldByName.get(m.name);
    const over = Math.max(0, m.complexity - limit);
    if (m.name === before.name) {
      original = { name: m.name, startLine: m.startLine, endLine: m.endLine, complexity: m.complexity, over, kind: 'original' };
      pieces.push(original);
    } else if (!old) {
      pieces.push({ name: m.name, startLine: m.startLine, endLine: m.endLine, complexity: m.complexity, over, kind: 'new' });
    } else if (old.complexity !== m.complexity) {
      pieces.push({ name: m.name, startLine: m.startLine, endLine: m.endLine, complexity: m.complexity, over, kind: 'changed' });
    }
  }
  pieces.sort((a, b) => b.over - a.over || a.startLine - b.startLine);
  const remainingOver = pieces.reduce((sum, p) => sum + p.over, 0);
  return {
    original,
    pieces,
    withinLimit: pieces.length > 0 && remainingOver === 0,
    remainingOver,
    moved: original !== undefined && original.complexity < before.complexity,
    before: before.complexity,
  };
}
