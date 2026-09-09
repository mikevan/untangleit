/**
 * DeepTest is the sibling that measures and judges tests (prs.deeptest).
 * RefactorIt does not call it; after an untangling it tells the person to
 * press "Check my code again" in DeepTest when DeepTest is installed, so the
 * pieces get their test bars measured. This is the only file in Refactor
 * It that names DeepTest.
 */
import * as vscode from 'vscode';

export const DEEPTEST_EXTENSION_ID = 'prs.deeptest';
export const DEEPTEST_REPOSITORY_URL = 'https://github.com/mikevan/deeptest';

export function deepTestInstalled(): boolean {
  return vscode.extensions.getExtension(DEEPTEST_EXTENSION_ID) !== undefined;
}

export async function showDeepTestInExtensionsView(): Promise<void> {
  try {
    await vscode.commands.executeCommand('extension.open', DEEPTEST_EXTENSION_ID);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(DEEPTEST_REPOSITORY_URL));
  }
}
