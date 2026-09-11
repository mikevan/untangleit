import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Workspace-relative path with forward slashes, or undefined when outside the workspace. */
export function relativePathOf(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder || uri.scheme !== 'file') {
    return undefined;
  }
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
}

export function absoluteUri(folder: vscode.WorkspaceFolder, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
}

/**
 * The workspace folder as the file system spells it. VS Code hands out
 * "c:\\workspace\\..." with a lower-case drive letter on Windows, while Node
 * and the test runners resolve files to "C:\\workspace\\...". Every path
 * UntangleIt passes to a runner starts from the real spelling.
 */
export function workspaceRootOf(folder: vscode.WorkspaceFolder): string {
  try {
    return fs.realpathSync.native(folder.uri.fsPath);
  } catch {
    return folder.uri.fsPath;
  }
}

/** Reads one line of a file, 1-based, or undefined. Re-reads on every call: the file may have changed. */
export function lineReader(root: string): (relativePath: string, line: number) => string | undefined {
  const cache = new Map<string, string[]>();
  return (relativePath, line) => {
    let lines = cache.get(relativePath);
    if (!lines) {
      try {
        lines = fs.readFileSync(path.join(root, ...relativePath.split('/')), 'utf8').split(/\r?\n/);
      } catch {
        return undefined;
      }
      cache.set(relativePath, lines);
    }
    return lines[line - 1];
  };
}
