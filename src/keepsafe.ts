/**
 * KeepSafe is a separate VS Code extension (publisher KeepSafe, id
 * KeepSafe.keepsafe) that takes a checkpoint of the whole workspace and
 * restores it on demand: an undo button for everything an AI assistant
 * changes. "Untangle it" is the one place UntangleIt hands work to an AI,
 * so it is the one place a checkpoint matters.
 *
 * The contract with KeepSafe is its public command `keepsafe.quickCheckpoint`
 * (v0.1.1): no arguments, checkpoints the first workspace folder under a
 * timestamped name, shows its own confirmation. Executing the command
 * activates the extension if it is installed but not yet running.
 *
 * When KeepSafe is not installed, UntangleIt recommends it once, in the
 * text of the setup screen, and does nothing else. This is the only file in
 * UntangleIt that names KeepSafe.
 */
import * as vscode from 'vscode';

export const KEEPSAFE_EXTENSION_ID = 'KeepSafe.keepsafe';
export const KEEPSAFE_CHECKPOINT_COMMAND = 'keepsafe.quickCheckpoint';
export const KEEPSAFE_MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=KeepSafe.keepsafe';

export function keepSafeInstalled(): boolean {
  return vscode.extensions.getExtension(KEEPSAFE_EXTENSION_ID) !== undefined;
}

export type CheckpointOutcome = 'created' | 'skipped' | 'failed';

export async function offerCheckpoint(log: (line: string) => void): Promise<CheckpointOutcome> {
  const answer = await vscode.window.showInformationMessage(
    'Create a KeepSafe checkpoint before the AI changes your code? You can restore it if the change goes wrong.',
    'Create a checkpoint',
    'Skip',
  );
  if (answer !== 'Create a checkpoint') {
    log('KeepSafe checkpoint skipped.');
    return 'skipped';
  }
  try {
    await vscode.commands.executeCommand(KEEPSAFE_CHECKPOINT_COMMAND);
    log('KeepSafe checkpoint requested.');
    return 'created';
  } catch (err) {
    log(`KeepSafe checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
}

export async function showKeepSafeInExtensionsView(): Promise<void> {
  try {
    await vscode.commands.executeCommand('extension.open', KEEPSAFE_EXTENSION_ID);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(KEEPSAFE_MARKETPLACE_URL));
  }
}
