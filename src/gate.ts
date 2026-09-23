/**
 * The behaviour gate, as the loop uses it.
 *
 * It sits inside the workflow that already exists and changes nothing about
 * it. At the existing "Yes, send it", after the person has confirmed and
 * before the brief reaches the clipboard and the editor chat, the selected
 * method's boundary is recorded while the project's own tests run. At the
 * existing "Measure again" it is recorded a second time and compared.
 *
 * UntangleIt does not edit source. It does not restore anything. It removes
 * no permission point and adds no new one. KeepSafe and the person keep
 * control exactly as they have it today.
 *
 * The comparison itself is in engine/behaviour.ts and knows nothing about
 * the editor or about which language produced a record. This file is the
 * wiring: find the recorder, run it, put the records somewhere the second
 * run can find them, and hand both sets to the verdict.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BoundaryRecord, ProblemPacket } from '@projectrevivesolutions/witness';
import { Verdict, decide } from './engine/behaviour';
import { LanguagePlugin, LanguageSettings } from './languages/types';
import { createInstrumenter, posixPath } from '@projectrevivesolutions/witness';
import { runtimeEnvironment } from './languages/shared/runtime';

/**
 * The method starting on a line, by name and by the class it belongs to.
 *
 * The loop knows the line, because that is what the person chose. The gate
 * needs the container too: after the hand-off the assistant has moved the
 * method and the second run has only a name to search by, and a name alone
 * resolves to two functions in any file with a `greet` on a class and a
 * `greet` beside it.
 *
 * Undefined for a language with no line locator, and for a file the parser
 * could not take. The caller then records nothing and claims nothing.
 */
export async function locateBoundary(workspaceRoot: string, relativePath: string, startLine: number): Promise<{ path: string; name: string; container?: string } | undefined> {
  if (!/\.[cm]?[jt]sx?$/i.test(relativePath)) {
    // Python is located by module and qualified name, which the recorder
    // works out from the file itself.
    return undefined;
  }
  try {
    const absolute = path.resolve(workspaceRoot, relativePath);
    const instrumenter = await createInstrumenter(runtimeEnvironment().wasmDir);
    const found = instrumenter.locateBoundary(posixPath(absolute), fs.readFileSync(absolute, 'utf8'), startLine);
    return found ? { path: relativePath, name: found.name, ...(found.container ? { container: found.container } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

/** Where a run's records are kept between the hand-off and "Measure again". */
function recordsFile(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, '.untangleit', 'behaviour', `${runId}.json`);
}

/**
 * Records the boundary while the project's own tests run.
 *
 * Returns undefined when this language has no recorder at all, which is not
 * the same as a recording that found nothing: the caller says so, and the
 * gate makes no claim either way.
 */
export async function recordBoundary(
  plugin: LanguagePlugin,
  options: { workspaceRoot: string; settings: LanguageSettings; boundary: { path: string; name: string; container?: string }; log: (line: string) => void; report?: (packet: ProblemPacket) => void; signal?: AbortSignal },
): Promise<BoundaryRecord[] | undefined> {
  const recorder = plugin.createBoundaryRecorder?.();
  if (!recorder) {
    return undefined;
  }
  try {
    return await recorder.record({ workspaceRoot: options.workspaceRoot, settings: options.settings, log: options.log, report: options.report, signal: options.signal, boundary: options.boundary });
  } catch (err) {
    // A recording that could not be made is not a failure of the person's
    // code and must never read as one. It is reported as no evidence.
    options.log(`The behaviour recording could not run: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Keeps the run before the hand-off, for the run at "Measure again" to compare against. */
export function saveBefore(workspaceRoot: string, runId: string, records: BoundaryRecord[]): void {
  const file = recordsFile(workspaceRoot, runId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(records), 'utf8');
  } catch {
    // Never fail a hand-off over the gate. A missing before is reported as
    // no evidence at "Measure again", which is the honest answer.
  }
}

export function loadBefore(workspaceRoot: string, runId: string): BoundaryRecord[] | undefined {
  try {
    return JSON.parse(fs.readFileSync(recordsFile(workspaceRoot, runId), 'utf8')) as BoundaryRecord[];
  } catch {
    return undefined;
  }
}

/**
 * The verdict for one round: the run kept from the hand-off against the run
 * just made. A missing before is insufficient evidence with the reason the
 * person can act on, never a pass.
 */
export function verdictFor(before: BoundaryRecord[] | undefined, after: BoundaryRecord[] | undefined): Verdict | undefined {
  if (before === undefined || after === undefined) {
    return undefined;
  }
  return decide(before, after);
}
