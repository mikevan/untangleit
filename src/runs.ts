/**
 * The run record: one entry per untangling, in .untangleit/runs.json at the
 * workspace root. Plain JSON, human readable, meant to be committed so the
 * history of what was untangled, by whose decision, and with what result
 * travels with the code. This is the public record other tools may read
 * (see docs/toolkit/toolkit-api.md); its shape only grows.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Piece, Snapshot } from './engine/tangle';

/**
 * 'behaviour-changed' is from 1.0.19: the gate compared the method's
 * recorded behaviour before the hand-off with its behaviour now and they
 * disagreed. It is a blocking outcome, whatever the tangle came down to and
 * whatever the suite reported, and readers written before 1.0.19 that do
 * not know it should treat it as not within limit.
 */
export type RunStatus = 'sent' | 'within-limit' | 'still-over' | 'tests-fail' | 'behaviour-changed' | 'stopped';

export interface RunRecord {
  id: string;
  path: string;
  name: string;
  startLine: number;
  /** The number the run was judged by, before. See `measure` for which number. */
  before: number;
  /**
   * Which measure `before`, `limit`, and the pieces' `over` were judged by.
   * 'mbcc' (tangle) from 0.1.11. Absent on records written by 0.1.x, which
   * judged by ways through; readers treat a missing value as 'ways'. Added
   * without a file-version bump because the shape only grew.
   */
  measure?: 'ways' | 'mbcc';
  limit: number;
  by: string;
  startedAt: string;
  /** Rounds handed to the assistant so far. */
  rounds: number;
  status: RunStatus;
  /** Filled in by each "Measure again". */
  measuredAt?: string;
  pieces?: Piece[];
  tests?: { passed: number; failed: number; errors: number };
  /** Plain sentence for the person, kept so the record reads on its own. */
  outcome?: string;
  /**
   * The behaviour gate's answer for the latest round, when the gate ran.
   * Absent on records written before 1.0.19 and on languages with no
   * recorder; readers treat absent as "the gate did not run", which is not
   * a pass. Added without a file-version bump because the shape only grew.
   */
  behaviour?: { verdict: 'equivalent' | 'changed' | 'insufficient'; reason?: string; compared?: number; sentence: string };
  /**
   * The method the behaviour gate is watching, resolved at the hand-off. The
   * container is what lets the run at "Measure again" find the method again
   * after the assistant moved it. Absent when this language has no recorder.
   */
  boundary?: { path: string; name: string; container?: string };
  snapshot: Snapshot;
}

export interface RunFile {
  version: 1;
  runs: RunRecord[];
}

export function runFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.untangleit', 'runs.json');
}

export function emptyRunFile(): RunFile {
  return { version: 1, runs: [] };
}

export function loadRuns(workspaceRoot: string, log?: (line: string) => void): RunFile {
  const file = runFilePath(workspaceRoot);
  if (!fs.existsSync(file)) {
    return emptyRunFile();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RunFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
      throw new Error('not a UntangleIt run file');
    }
    return { version: 1, runs: parsed.runs };
  } catch (err) {
    log?.(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}. Starting a fresh record.`);
    return emptyRunFile();
  }
}

export function saveRuns(workspaceRoot: string, file: RunFile): void {
  const target = runFilePath(workspaceRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

/** The open run for a method, if any: the newest one not yet within the limit or stopped. */
export function openRunFor(file: RunFile, relativePath: string, name: string): RunRecord | undefined {
  return [...file.runs].reverse().find((r) => r.path === relativePath && r.name === name && (r.status === 'sent' || r.status === 'still-over' || r.status === 'tests-fail'));
}

export function upsertRun(file: RunFile, run: RunRecord): RunFile {
  const others = file.runs.filter((r) => r.id !== run.id);
  return { version: 1, runs: [...others, run] };
}

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function whoAmI(): string {
  return process.env.USERNAME || process.env.USER || 'someone';
}
