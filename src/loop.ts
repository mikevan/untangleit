/**
 * The loop, with a person at every gate:
 *
 *   1. Show      the method, its ways through, the limit (the card).
 *   2. Checkpoint the KeepSafe offer, when KeepSafe is installed.
 *   3. Confirm   one modal sentence; nothing is sent before "Yes, send it".
 *   4. Transform the assistant works from the brief. RefactorIt waits.
 *   5. Verify    "Measure again": run the suite, measure every piece.
 *   6. Decide    within the limit, or another round, or stop. The person.
 *
 * RefactorIt never edits code, never restores a checkpoint, never retries
 * on its own, and never accepts its own result.
 */
import * as vscode from 'vscode';
import { RefactorItConfig, settingsFor } from './config';
import { Comparison, compare, snapshot } from './engine/tangle';
import { KEEPSAFE_EXTENSION_ID, keepSafeInstalled, offerCheckpoint } from './keepsafe';
import { deepTestInstalled } from './deeptest';
import { LanguagePlugin, TestRunSummary } from './languages/types';
import { measureFile } from './measure';
import { lineReader } from './paths';
import { buildUntangleBrief } from './report/brief';
import { RunRecord, loadRuns, newRunId, openRunFor, saveRuns, upsertRun, whoAmI } from './runs';
import { ResultState } from './state';
import { outcomeSentence, ways } from './ui/words';

export interface LoopDeps {
  state: ResultState;
  output: vscode.OutputChannel;
  workspaceRoot: () => string | undefined;
  plugin: () => LanguagePlugin | undefined;
  config: () => RefactorItConfig;
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
    process.env.REFACTORIT_TEST_HOST === '1'
      ? 'Yes, send it'
      : await vscode.window.showWarningMessage(
          'Send this to your AI assistant?',
          {
            modal: true,
            detail: `RefactorIt will hand your assistant a brief asking it to ${task}. The assistant will change your code. RefactorIt will run your tests and measure every piece when you press "Measure again"; it will not accept the result for you.`,
          },
          'Yes, send it',
        );
  if (confirmed !== 'Yes, send it') {
    deps.output.appendLine('Not sent; the confirmation was declined.');
    return { proceed: false, checkpointNote };
  }
  return { proceed: true, checkpointNote };
}

async function handOff(brief: string): Promise<string> {
  await vscode.env.clipboard.writeText(brief);
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: brief });
    return 'The brief is in the editor chat and on your clipboard.';
  } catch {
    return 'The brief is on your clipboard. Paste it into the assistant you use.';
  }
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

/** "Untangle it" on a method: the gates, the brief, the record. */
export async function untangle(deps: LoopDeps, relativePath: string, startLine: number): Promise<void> {
  const root = deps.workspaceRoot();
  const plugin = deps.plugin();
  const config = deps.config();
  const measured = deps.state.measure?.methods.find((m) => m.path === relativePath && m.startLine === startLine);
  if (!root || !plugin || !measured) {
    void vscode.window.showErrorMessage('Press "Find the tangled methods" first, and then choose a method to untangle.');
    return;
  }
  if (measured.complexity <= config.limit) {
    void vscode.window.showInformationMessage(`${measured.name}() has ${ways(measured.complexity)}, which is within your limit of ${config.limit}. There is nothing to untangle.`);
    return;
  }
  const target = { ...measured, limit: config.limit, over: measured.complexity - config.limit };
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
  const gate = await gates(deps, `break ${target.name}() into pieces that each have at most ${ways(config.limit)}, without changing what it does`);
  if (!gate.proceed) {
    return;
  }
  const fileMethods = await measureFile(plugin, root, relativePath, (l) => deps.output.appendLine(l));
  const { source, truncated } = sourceOf(root, relativePath, target.startLine, target.endLine);
  const brief = buildUntangleBrief({
    path: relativePath,
    name: target.name,
    startLine: target.startLine,
    endLine: target.endLine,
    complexity: target.complexity,
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
    before: target.complexity,
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
  const how = await handOff(brief);
  deps.output.appendLine(`Untangle requested for ${relativePath} ${target.name}() (${target.complexity} ways through, limit ${config.limit}). ${how}`);
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

async function runTests(deps: LoopDeps, plugin: LanguagePlugin, root: string, config: RefactorItConfig): Promise<TestRunSummary | undefined> {
  const settings = settingsFor(config, plugin.id);
  const runner = plugin.createTestRunner();
  try {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `RefactorIt is running your tests (${runner.describe({ workspaceRoot: root, settings })}).` }, () =>
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
  const sentence = outcomeSentence(comparison, tests, run.limit, name);
  const failing = tests ? tests.failed + tests.errors : 0;
  run.measuredAt = new Date().toISOString();
  run.pieces = comparison.pieces;
  run.tests = tests ? { passed: tests.passed, failed: tests.failed, errors: tests.errors } : undefined;
  run.outcome = sentence;
  run.status = failing > 0 ? 'tests-fail' : comparison.withinLimit ? 'within-limit' : 'still-over';
  const saved = upsertRun(runs, run);
  saveRuns(root, saved);
  deps.state.setRuns(saved);
  deps.output.appendLine(`Measured ${relativePath} ${name}() after round ${run.rounds}: ${sentence}`);
  await vscode.commands.executeCommand('refactorit.run');

  if (run.status === 'within-limit') {
    const tail = deepTestInstalled() ? ' Press "Check my code again" in DeepTest to see whether every piece has the tests it needs.' : '';
    void vscode.window.showInformationMessage(`${sentence}${tail}`);
    return;
  }
  if (run.rounds >= config.rounds) {
    void vscode.window.showWarningMessage(`${sentence} That was round ${run.rounds} of ${config.rounds}, so RefactorIt stops here. Restore the checkpoint if you want the original back, or raise the rounds on the setup screen and press "Untangle it" again.`);
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

async function anotherRound(deps: LoopDeps, plugin: LanguagePlugin, root: string, config: RefactorItConfig, run: RunRecord, comparison: Comparison): Promise<void> {
  const gate = await gates(deps, `keep untangling ${run.name}() and the pieces that are still over ${ways(run.limit)}, without changing what the code does`);
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
