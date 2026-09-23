/**
 * The loop, with a person at every gate:
 *
 *   1. Show      the method, its tangle, the limit (the card).
 *   2. Checkpoint the KeepSafe offer, when KeepSafe is installed.
 *   3. Confirm   one modal sentence; nothing is sent before "Yes, send it".
 *   4. Transform the assistant works from the brief. UntangleIt waits.
 *   5. Verify    "Measure again": run the suite, measure every piece, and
 *                compare the selected method's recorded behaviour with what
 *                was recorded at the hand-off.
 *   6. Decide    within the limit, or another round, or stop. The person.
 *
 * UntangleIt never edits code, never restores a checkpoint, never retries
 * on its own, and never accepts its own result.
 */
import * as vscode from 'vscode';
import { UntangleItConfig, settingsFor } from './config';
import { Comparison, compare, snapshot } from './engine/tangle';
import { KEEPSAFE_EXTENSION_ID, keepSafeInstalled, offerCheckpoint } from './keepsafe';
import { deepTestInstalled } from './deeptest';
import { loadBefore, locateBoundary, recordBoundary, saveBefore, verdictFor } from './gate';
import { sentence as behaviourSentence } from './engine/behaviour';
import type { BoundaryRecord } from '@projectrevivesolutions/witness';
import { LanguagePlugin, TestRunSummary } from './languages/types';
import { measureFile } from './measure';
import { lineReader } from './paths';
import { buildUntangleBrief } from './report/brief';
import { handOff } from './copilot';
import { buildFailureBrief } from '@projectrevivesolutions/witness';
import type { ProblemPacket } from '@projectrevivesolutions/witness';
import { RunRecord, loadRuns, newRunId, openRunFor, saveRuns, upsertRun, whoAmI } from './runs';
import { ResultState } from './state';
import { outcomeSentence, tangle } from './ui/words';

export interface LoopDeps {
  state: ResultState;
  output: vscode.OutputChannel;
  workspaceRoot: () => string | undefined;
  plugin: () => LanguagePlugin | undefined;
  config: () => UntangleItConfig;
}

/** How many lines of a method the brief quotes before cutting. */
const SOURCE_LIMIT = 160;

interface GateResult {
  proceed: boolean;
  checkpointNote: string;
}

async function gates(deps: LoopDeps, task: string): Promise<GateResult> {
  let checkpointNote = '';
  const installed = keepSafeInstalled();
  const offer = deps.config().keepSafe.offerCheckpoint;
  deps.output.appendLine(`KeepSafe (${KEEPSAFE_EXTENSION_ID}) is ${installed ? 'installed' : 'not installed'}; the checkpoint offer is ${offer ? 'on' : 'off'}.`);
  if (installed && offer) {
    const outcome = await offerCheckpoint((l) => deps.output.appendLine(l));
    if (outcome === 'failed') {
      void vscode.window.showWarningMessage('KeepSafe could not create the checkpoint. Nothing was sent to the assistant. Press "Untangle it" again when KeepSafe is ready, or press "Skip" next time to go on without one.');
      return { proceed: false, checkpointNote };
    }
    checkpointNote = outcome === 'created' ? ' A KeepSafe checkpoint was taken first; "KeepSafe: Restore Latest Checkpoint" undoes everything the assistant changes.' : '';
  }
  // The integration suite cannot press a modal button, so the harness sets
  // this variable in the test host only. It is read from the process
  // environment, never from a setting a user could flip.
  const confirmed =
    process.env.UNTANGLEIT_TEST_HOST === '1'
      ? 'Yes, send it'
      : await vscode.window.showWarningMessage(
          'Send this to your AI assistant?',
          {
            modal: true,
            detail: `UntangleIt will hand your assistant a brief asking it to ${task}. The assistant will change your code. UntangleIt will run your tests and measure every piece when you press "Measure again"; it will not accept the result for you.`,
          },
          'Yes, send it',
        );
  if (confirmed !== 'Yes, send it') {
    deps.output.appendLine('Not sent; the confirmation was declined.');
    return { proceed: false, checkpointNote };
  }
  return { proceed: true, checkpointNote };
}


/**
 * A driver hit something the person has to be told about, and the verdict
 * alone would not tell them.
 *
 * UntangleIt shows the one-line headline and offers to have it explained.
 * The explaining is the assistant's job: the packet carries what was
 * established, what was not, and what must not be recommended, and the brief
 * built from it says so in as many words. UntangleIt does not write the
 * explanation, and it does not offer to fix what the packet says cannot be
 * fixed in code.
 */
function reportProblem(deps: LoopDeps, packet: ProblemPacket): void {
  for (const line of [packet.headline, ...packet.known.map((k) => `  ${k}`)]) {
    deps.output.appendLine(line);
  }
  const actions = [...(packet.actions.includes('explain') ? ['Explain with Copilot'] : []), 'Show the log'];
  void vscode.window.showWarningMessage(packet.headline, ...actions).then(async (choice) => {
    if (choice === 'Explain with Copilot') {
      const where = await handOff(buildFailureBrief(packet));
      deps.output.appendLine(`Handed the failure to your assistant. ${where}`);
    } else if (choice === 'Show the log') {
      await vscode.commands.executeCommand('untangleit.showOutput');
    }
  });
}

function sourceOf(root: string, relativePath: string, startLine: number, endLine: number): { source: Array<{ line: number; text: string }>; truncated: boolean } {
  const read = lineReader(root);
  const last = Math.min(endLine, startLine + SOURCE_LIMIT - 1);
  const source: Array<{ line: number; text: string }> = [];
  for (let n = startLine; n <= last; n += 1) {
    const text = read(relativePath, n);
    if (text !== undefined) {
      source.push({ line: n, text });
    }
  }
  return { source, truncated: last < endLine };
}

/**
 * The behaviour gate's "before", taken at the existing "Yes, send it".
 *
 * It runs the project's own tests once, with the Witness recorder watching
 * the selected method and nothing else. That is real time on a large suite
 * and there is no fast path that skips it, because a before-and-after
 * comparison with no before is not a comparison. The log says so rather
 * than hiding it.
 *
 * Nothing here can stop the hand-off. A recording that could not be made is
 * reported at "Measure again" as no evidence, which is not a pass and not a
 * failure, and the person decides as they do now.
 */
async function recordAtHandOff(
  deps: LoopDeps,
  plugin: LanguagePlugin,
  root: string,
  config: UntangleItConfig,
  relativePath: string,
  name: string,
  startLine: number,
): Promise<{ records: BoundaryRecord[]; boundary: { path: string; name: string; container?: string } } | undefined> {
  const recorder = plugin.createBoundaryRecorder?.();
  if (!recorder) {
    return undefined;
  }
  const settings = settingsFor(config, plugin.id);
  const boundary = (await locateBoundary(root, relativePath, startLine)) ?? { path: relativePath, name };
  const records = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `UntangleIt is recording what ${name}() does now (${recorder.describe({ workspaceRoot: root, settings })}).` }, () =>
    recordBoundary(plugin, { workspaceRoot: root, settings, boundary, log: (l) => deps.output.appendLine(l), report: (p) => reportProblem(deps, p) }),
  );
  if (!records) {
    return undefined;
  }
  deps.output.appendLine(`Recorded ${records.length} observation${records.length === 1 ? '' : 's'} of ${boundary.container ? `${boundary.container}.` : ''}${boundary.name} before the hand-off.`);
  return { records, boundary };
}

/** "Untangle it" on a method: the gates, the brief, the record. */
export async function untangle(deps: LoopDeps, relativePath: string, startLine: number): Promise<void> {
  const root = deps.workspaceRoot();
  const plugin = deps.plugin();
  const config = deps.config();
  if (!root || !plugin) {
    void vscode.window.showErrorMessage('Open the folder that holds the method, and then choose a method to untangle.');
    return;
  }
  // A sibling tool (DeepTest's "Break it into smaller pieces") calls this
  // command before UntangleIt has measured anything, so a method that is
  // not in the last measure is measured on demand from its own file. Only
  // when the file has no method starting on that line is the person asked
  // to run "Find the tangled methods" themselves.
  let measured = deps.state.measure?.methods.find((m) => m.path === relativePath && m.startLine === startLine);
  if (!measured) {
    const fresh = await measureFile(plugin, root, relativePath, (l) => deps.output.appendLine(l));
    const found = fresh.find((m) => m.startLine === startLine);
    if (found) {
      measured = { ...found, path: relativePath };
      deps.output.appendLine(`Measured ${relativePath} on demand for ${found.name}() at line ${startLine}.`);
    }
  }
  if (!measured) {
    void vscode.window.showErrorMessage(`No method starts on line ${startLine} of ${relativePath}. Press "Find the tangled methods", and then choose a method to untangle.`);
    return;
  }
  if (measured.mbcc <= config.limit) {
    void vscode.window.showInformationMessage(`${measured.name}() has ${tangle(measured.mbcc)}, which is within your limit of ${config.limit}. There is nothing to untangle.`);
    return;
  }
  const target = { ...measured, limit: config.limit, over: measured.mbcc - config.limit };
  const existing = openRunFor(deps.state.runs, relativePath, target.name);
  if (existing && existing.status === 'sent') {
    const answer = await vscode.window.showInformationMessage(`${target.name}() was already sent to your assistant on ${existing.startedAt.slice(0, 10)}. Press "Measure again" to see what came back, or send it again.`, 'Measure again', 'Send again');
    if (answer === 'Measure again') {
      await measureAgain(deps, relativePath, target.name);
      return;
    }
    if (answer !== 'Send again') {
      return;
    }
  }
  const gate = await gates(deps, `break ${target.name}() into pieces that each have a tangle of at most ${config.limit}, without changing what it does`);
  if (!gate.proceed) {
    return;
  }
  // The behaviour gate's "before", at the gate that already exists: the
  // person has confirmed, and nothing has been sent yet. It costs one run of
  // the project's tests, which the report names rather than hides.
  const before = await recordAtHandOff(deps, plugin, root, config, relativePath, target.name, target.startLine);
  const fileMethods = await measureFile(plugin, root, relativePath, (l) => deps.output.appendLine(l));
  const { source, truncated } = sourceOf(root, relativePath, target.startLine, target.endLine);
  const brief = buildUntangleBrief({
    path: relativePath,
    name: target.name,
    startLine: target.startLine,
    endLine: target.endLine,
    complexity: target.complexity,
    campbell: target.campbell,
    mbcc: target.mbcc,
    limit: config.limit,
    source,
    sourceTruncated: truncated,
    testsPath: config.testsPath,
    language: plugin.displayName,
    round: 1,
  });
  const run: RunRecord = {
    id: newRunId(),
    path: relativePath,
    name: target.name,
    startLine: target.startLine,
    before: target.mbcc,
    measure: 'mbcc',
    limit: config.limit,
    by: whoAmI(),
    startedAt: new Date().toISOString(),
    rounds: 1,
    status: 'sent',
    snapshot: snapshot(target, fileMethods),
  };
  const runs = upsertRun(loadRuns(root), run);
  saveRuns(root, runs);
  deps.state.setRuns(runs);
  if (before) {
    run.boundary = before.boundary;
    saveBefore(root, run.id, before.records);
    const saved = upsertRun(runs, run);
    saveRuns(root, saved);
    deps.state.setRuns(saved);
  }
  const how = await handOff(brief);
  deps.output.appendLine(`Untangle requested for ${relativePath} ${target.name}() (tangle ${target.mbcc} by MBCC, ${target.campbell} by Campbell, ${target.complexity} ways through; limit ${config.limit}). ${how}`);
  void vscode.window.showInformationMessage(`${how} When the assistant says it is done, press "Measure again" on ${target.name}().${gate.checkpointNote}`);
}

/** "Untangle it" on the worst method in the workspace. */
export async function untangleWorst(deps: LoopDeps): Promise<void> {
  const worst = deps.state.measure?.tangled[0];
  if (!worst) {
    void vscode.window.showInformationMessage('There is nothing to untangle. Every measured method is within your limit.');
    return;
  }
  await untangle(deps, worst.path, worst.startLine);
}

async function runTests(deps: LoopDeps, plugin: LanguagePlugin, root: string, config: UntangleItConfig): Promise<TestRunSummary | undefined> {
  const settings = settingsFor(config, plugin.id);
  const runner = plugin.createTestRunner();
  try {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `UntangleIt is running your tests (${runner.describe({ workspaceRoot: root, settings })}).` }, () =>
      runner.run({ workspaceRoot: root, settings, log: (l) => deps.output.appendLine(l) }),
    );
  } catch (err) {
    deps.output.appendLine(`The tests could not run: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** "Measure again" on a method with an open run: verify, compare, decide. */
export async function measureAgain(deps: LoopDeps, relativePath: string, name: string): Promise<void> {
  const root = deps.workspaceRoot();
  const plugin = deps.plugin();
  if (!root || !plugin) {
    return;
  }
  const runs = loadRuns(root, (l) => deps.output.appendLine(l));
  const run = openRunFor(runs, relativePath, name);
  if (!run) {
    void vscode.window.showInformationMessage(`${name}() has no untangling in progress. Press "Untangle it" to start one.`);
    return;
  }
  const config = deps.config();
  const after = await measureFile(plugin, root, relativePath, (l) => deps.output.appendLine(l));
  const comparison = compare(run.snapshot, after, run.limit);
  const tests = await runTests(deps, plugin, root, config);
  // The behaviour gate's "after", beside the test run and the tangle
  // measurement this step already performs. The method is found again by
  // name inside its container, because the assistant moved it and nothing
  // here knows where.
  const behaviour = await compareBehaviour(deps, plugin, root, config, run);
  const sentence = outcomeSentence(comparison, tests, run.limit, name);
  const failing = tests ? tests.failed + tests.errors : 0;
  run.measuredAt = new Date().toISOString();
  run.pieces = comparison.pieces;
  run.tests = tests ? { passed: tests.passed, failed: tests.failed, errors: tests.errors } : undefined;
  run.outcome = sentence;
  run.behaviour = behaviour;
  // A changed behaviour is a blocking gate. The untangling may have brought
  // the tangle down and the suite may be green, and it still does not
  // behave the way it did, so it is not within limit and the person is told
  // in those words. UntangleIt restores nothing and decides nothing.
  run.status = behaviour?.verdict === 'changed' ? 'behaviour-changed' : failing > 0 ? 'tests-fail' : comparison.withinLimit ? 'within-limit' : 'still-over';
  const saved = upsertRun(runs, run);
  saveRuns(root, saved);
  deps.state.setRuns(saved);
  deps.output.appendLine(`Measured ${relativePath} ${name}() after round ${run.rounds}: ${sentence}`);
  if (behaviour) {
    deps.output.appendLine(`Behaviour gate: ${behaviour.sentence}`);
  }
  await vscode.commands.executeCommand('untangleit.run');

  if (run.status === 'behaviour-changed') {
    void vscode.window.showWarningMessage(`${behaviour!.sentence} ${sentence} Restore the checkpoint if you want the original back, or look at what changed and decide.`);
    return;
  }
  if (run.status === 'within-limit') {
    const tail = deepTestInstalled() ? ' Press "Check my code again" in DeepTest to see whether every piece has the tests it needs.' : '';
    const said = behaviour ? ` ${behaviour.sentence}` : '';
    void vscode.window.showInformationMessage(`${sentence}${said}${tail}`);
    return;
  }
  if (run.rounds >= config.rounds) {
    void vscode.window.showWarningMessage(`${sentence} That was round ${run.rounds} of ${config.rounds}, so UntangleIt stops here. Restore the checkpoint if you want the original back, or raise the rounds on the setup screen and press "Untangle it" again.`);
    run.status = 'stopped';
    const stopped = upsertRun(saved, run);
    saveRuns(root, stopped);
    deps.state.setRuns(stopped);
    return;
  }
  const answer = await vscode.window.showWarningMessage(sentence, 'Send another round', 'Stop here');
  if (answer !== 'Send another round') {
    if (answer === 'Stop here') {
      run.status = 'stopped';
      const stopped = upsertRun(saved, run);
      saveRuns(root, stopped);
      deps.state.setRuns(stopped);
    }
    return;
  }
  await anotherRound(deps, plugin, root, config, run, comparison);
}

/**
 * The gate's answer for this round: the run kept from the hand-off against
 * a run made now.
 *
 * Undefined when the gate did not run at all, which is not a verdict and is
 * never shown as one. A before that was never kept reports as insufficient
 * evidence with the reason, because a comparison with no before is not a
 * comparison.
 */
async function compareBehaviour(deps: LoopDeps, plugin: LanguagePlugin, root: string, config: UntangleItConfig, run: RunRecord): Promise<RunRecord['behaviour']> {
  const recorder = plugin.createBoundaryRecorder?.();
  if (!recorder || !run.boundary) {
    return undefined;
  }
  const settings = settingsFor(config, plugin.id);
  const after = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `UntangleIt is recording what ${run.name}() does now (${recorder.describe({ workspaceRoot: root, settings })}).` }, () =>
    recordBoundary(plugin, { workspaceRoot: root, settings, boundary: run.boundary!, log: (l) => deps.output.appendLine(l), report: (p) => reportProblem(deps, p) }),
  );
  const before = loadBefore(root, run.id);
  const verdict = verdictFor(before, after);
  if (!verdict) {
    return undefined;
  }
  const label = `${run.boundary.container ? `${run.boundary.container}.` : ''}${run.boundary.name}`;
  return {
    verdict: verdict.verdict,
    ...(verdict.verdict === 'insufficient' ? { reason: verdict.reason } : { compared: verdict.compared }),
    sentence: behaviourSentence(verdict, label),
  };
}

async function anotherRound(deps: LoopDeps, plugin: LanguagePlugin, root: string, config: UntangleItConfig, run: RunRecord, comparison: Comparison): Promise<void> {
  const gate = await gates(deps, `keep untangling ${run.name}() and the pieces whose tangle is still over ${run.limit}, without changing what the code does`);
  if (!gate.proceed) {
    return;
  }
  const anchor = comparison.original ?? comparison.pieces[0];
  const { source, truncated } = anchor ? sourceOf(root, run.path, anchor.startLine, anchor.endLine) : { source: [], truncated: false };
  const brief = buildUntangleBrief({
    path: run.path,
    name: run.name,
    startLine: anchor?.startLine ?? run.startLine,
    endLine: anchor?.endLine ?? run.startLine,
    complexity: anchor?.complexity ?? run.before,
    campbell: anchor?.campbell ?? run.before,
    mbcc: anchor?.mbcc ?? run.before,
    limit: run.limit,
    source,
    sourceTruncated: truncated,
    testsPath: config.testsPath,
    language: plugin.displayName,
    round: run.rounds + 1,
    remaining: comparison.pieces.filter((p) => p.over > 0),
  });
  // The snapshot from before round 1 stays: every piece created since the
  // start is still a piece, whichever round created it.
  run.rounds += 1;
  run.status = 'sent';
  const saved = upsertRun(loadRuns(root), run);
  saveRuns(root, saved);
  deps.state.setRuns(saved);
  const how = await handOff(brief);
  deps.output.appendLine(`Round ${run.rounds} sent for ${run.path} ${run.name}(). ${how}`);
  void vscode.window.showInformationMessage(`${how} When the assistant says it is done, press "Measure again" on ${run.name}().${gate.checkpointNote}`);
}
