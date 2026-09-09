import * as vscode from 'vscode';
import { LanguageSettings } from './languages/types';

export interface RefactorItConfig {
  language: string;
  testsPath: string;
  sourceRoot: string;
  languageSettings: Record<string, Record<string, unknown>>;
  /** Most ways through one method before it is tangled; every piece must fit under it too. */
  limit: number;
  /** Rounds of untangle-and-measure to offer before stopping. */
  rounds: number;
  keepSafe: { offerCheckpoint: boolean };
  showNumbers: boolean;
}

export function readConfig(folder?: vscode.WorkspaceFolder): RefactorItConfig {
  const c = vscode.workspace.getConfiguration('refactorit', folder);
  return {
    language: c.get<string>('language', ''),
    testsPath: c.get<string>('testsPath', ''),
    sourceRoot: c.get<string>('sourceRoot', ''),
    languageSettings: c.get<Record<string, Record<string, unknown>>>('languageSettings', {}),
    limit: Math.max(1, c.get<number>('limit', 5)),
    rounds: Math.max(1, c.get<number>('rounds', 3)),
    keepSafe: { offerCheckpoint: c.get<boolean>('keepSafe.offerCheckpoint', true) },
    showNumbers: c.get<boolean>('showNumbers', false),
  };
}

export function settingsFor(config: RefactorItConfig, languageId: string): LanguageSettings {
  return { testsPath: config.testsPath, sourceRoot: config.sourceRoot, fields: config.languageSettings[languageId] ?? {} };
}

export async function writeConfig(values: Record<string, unknown>, folder?: vscode.WorkspaceFolder): Promise<void> {
  const c = vscode.workspace.getConfiguration('refactorit', folder);
  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  for (const [key, value] of Object.entries(values)) {
    await c.update(key, value, target);
  }
}
