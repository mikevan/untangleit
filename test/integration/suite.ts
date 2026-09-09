/**
 * Drives the real extension in a real editor against the Vitest fixture:
 * measure, find the tangled method, send it (the harness lets the suite
 * through the modal), then "Measure again" against an unchanged file and
 * check that RefactorIt reports "not done" rather than taking anyone's
 * word for it.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RefactorItApi } from '../../src/extension';

async function waitFor(check: () => boolean, ms: number, what: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('prs.refactorit');
  assert.ok(ext, 'extension not found');
  const api = (await ext.activate()) as RefactorItApi;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'no workspace folder');
  fs.rmSync(path.join(folder.uri.fsPath, '.refactorit'), { recursive: true, force: true });

  const cfg = vscode.workspace.getConfiguration('refactorit', folder);
  await cfg.update('language', 'typescript', vscode.ConfigurationTarget.Workspace);
  await cfg.update('testsPath', 'test', vscode.ConfigurationTarget.Workspace);
  await cfg.update('sourceRoot', 'src', vscode.ConfigurationTarget.Workspace);
  await cfg.update('limit', 5, vscode.ConfigurationTarget.Workspace);
  await cfg.update('keepSafe.offerCheckpoint', false, vscode.ConfigurationTarget.Workspace);

  await api.run();
  await waitFor(() => api.state.phase === 'results' || api.state.phase === 'error', 60_000, 'measure to finish');
  assert.equal(api.state.phase, 'results', `measure ended in phase ${api.state.phase}: ${api.state.message}`);
  const tangled = api.state.measure?.tangled ?? [];
  assert.deepEqual(
    tangled.map((t) => [t.name, t.complexity]),
    [['describeNumber', 8]],
  );

  // Send it. The harness sets REFACTORIT_TEST_HOST=1, so the modal is bypassed.
  await vscode.commands.executeCommand('refactorit.method', { path: 'src/calc.ts', startLine: tangled[0].startLine });
  await waitFor(() => api.state.runs.runs.length === 1, 10_000, 'run record');
  const record = api.state.runs.runs[0];
  assert.equal(record.status, 'sent');
  assert.equal(record.before, 8);
  const clip = await vscode.env.clipboard.readText();
  assert.match(clip, /^# RefactorIt: bring describeNumber\(\) in src\/calc\.ts down to at most 5 ways through/);
  assert.match(clip, /It does not mean "reduce by 5"/);
  const onDisk = JSON.parse(fs.readFileSync(path.join(folder.uri.fsPath, '.refactorit', 'runs.json'), 'utf8')) as { runs: Array<{ status: string }> };
  assert.equal(onDisk.runs[0].status, 'sent');

  // Measure again without any change: the tests pass, the method is still over, and the
  // loop must say so (it is round 1 of 3, so it offers another round; nobody answers).
  void vscode.commands.executeCommand('refactorit.measureAgain', { path: 'src/calc.ts', name: 'describeNumber' });
  await waitFor(() => api.state.runs.runs[0]?.status === 'still-over', 120_000, 'measure again');
  const after = api.state.runs.runs[0];
  assert.equal(after.tests?.failed, 0);
  assert.ok((after.tests?.passed ?? 0) >= 4);
  assert.match(after.outcome ?? '', /^Not done\. 1 piece: describeNumber\(\) 8\. 1 piece is still over your limit of 5\. All \d+ tests pass\. Your call\.$/);

  // The silent command for sibling tools.
  const envelope = (await vscode.commands.executeCommand('refactorit.api.measure', { path: 'src/calc.ts' })) as { ok: boolean; protocol: number; tool: string; result: { methods: Array<{ name: string; waysThrough: number; over: number }> } };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.protocol, 1);
  assert.equal(envelope.tool, 'refactorit');
  assert.deepEqual(
    envelope.result.methods.filter((m) => m.over > 0).map((m) => [m.name, m.waysThrough, m.over]),
    [['describeNumber', 8, 3]],
  );
  const bad = (await vscode.commands.executeCommand('refactorit.api.measure', {})) as { ok: boolean; error: string };
  assert.equal(bad.ok, false);
  assert.match(bad.error, /\.$/);

  console.log('RefactorIt integration suite passed');
}
