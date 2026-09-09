/**
 * Activation and orchestration. Everything the person can press lands here
 * and is routed to the measurer, the loop, or a screen. Nothing in this file
 * names a language or a sibling tool; those live behind the registry and
 * the sibling files.
 */
import * as vscode from 'vscode';
import { RefactorItConfig, readConfig } from './config';
import { deepTestInstalled } from './deeptest';
import { LanguageGuess, countLanguages } from './detect/language';
import { keepSafeInstalled } from './keepsafe';
import { pluginById, pluginForFile } from './languages/registry';
import { setRuntimeEnvironment } from './languages/shared/runtime';
import { HostServices, LanguagePlugin } from './languages/types';
import { LoopDeps, measureAgain, untangle, untangleWorst } from './loop';
import { measureFile, measureFiles, sourceFilesFor } from './measure';
import { absoluteUri, workspaceRootOf } from './paths';
import { loadRuns } from './runs';
import { ResultState } from './state';
import { ConfigDefaults, ConfigPanel } from './ui/configPanel';
import { SidebarMessage, SidebarView } from './ui/sidebarView';

export interface RefactorItApi {
  state: ResultState;
  run(): Promise<void>;
}

function workspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function host(): HostServices {
  return {
    activeLanguageId: vscode.window.activeTextEditor?.document.languageId,
    async extensionApi(extensionId: string): Promise<unknown> {
      const ext = vscode.extensions.getExtension(extensionId);
      if (!ext) {
        return undefined;
      }
      return ext.isActive ? ext.exports : ext.activate();
    },
  };
}

function choosePlugin(config: RefactorItConfig, detected: LanguageGuess[]): LanguagePlugin | undefined {
  if (config.language) {
    return pluginById(config.language);
  }
  for (const guess of detected) {
    const plugin = pluginById(guess.language);
    if (plugin) {
      return plugin;
    }
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): RefactorItApi {
  setRuntimeEnvironment({ wasmDir: vscode.Uri.joinPath(context.extensionUri, 'dist').fsPath });
  const output = vscode.window.createOutputChannel('RefactorIt');
  const state = new ResultState();
  let config = readConfig(workspaceFolder());
  const version = String((context.extension.packageJSON as { version?: string }).version ?? '');

  const currentPlugin = (): LanguagePlugin | undefined => {
    const folder = workspaceFolder();
    if (!folder) {
      return undefined;
    }
    return choosePlugin(config, countLanguages(workspaceRootOf(folder)));
  };

  const deps: LoopDeps = {
    state,
    output,
    workspaceRoot: () => {
      const folder = workspaceFolder();
      return folder ? workspaceRootOf(folder) : undefined;
    },
    plugin: currentPlugin,
    config: () => config,
  };

  async function detectDefaults(folder: vscode.WorkspaceFolder, languageId?: string): Promise<ConfigDefaults> {
    const root = workspaceRootOf(folder);
    const detected = countLanguages(root);
    const plugin = languageId ? pluginById(languageId) : choosePlugin(config, detected);
    const id = plugin?.id ?? languageId ?? config.language ?? detected[0]?.language ?? '';
    const detection = plugin ? await plugin.detect(root, host()) : undefined;
    return { detected, languageId: id, detection, keepSafeInstalled: keepSafeInstalled(), deepTestInstalled: deepTestInstalled() };
  }

  async function run(): Promise<void> {
    const folder = workspaceFolder();
    if (!folder) {
      void vscode.window.showInformationMessage('RefactorIt needs an open folder to measure. Open your project folder first.');
      return;
    }
    config = readConfig(folder);
    const root = workspaceRootOf(folder);
    const plugin = currentPlugin();
    if (!plugin) {
      state.setError(`RefactorIt cannot measure ${config.language || 'this language'} yet. Press "Change the setup" to pick a language it can.`);
      return;
    }
    if (!config.language && !config.testsPath && !config.sourceRoot) {
      // First contact: the setup screen, pre-filled, so the person sees what will happen.
      await openConfig();
      return;
    }
    const started = Date.now();
    output.appendLine(`\n=== RefactorIt measure: ${new Date().toISOString()} (${plugin.displayName}, limit ${config.limit}) ===`);
    state.setRunning();
    try {
      const files = sourceFilesFor(plugin, config, root);
      if (files.length === 0) {
        state.setNoCode(`RefactorIt looked ${config.sourceRoot ? `in the folder "${config.sourceRoot}"` : 'in the whole project'} for ${plugin.displayName} files and found none.`);
        return;
      }
      const result = await measureFiles(plugin, root, files, config.limit, (l) => output.appendLine(l));
      state.setRuns(loadRuns(root, (l) => output.appendLine(l)));
      state.setResults(result.measure, { language: plugin.displayName, finishedAt: new Date(), durationMs: Date.now() - started });
      output.appendLine(`Measured ${result.measure.methods.length} methods in ${result.measure.files} files; ${result.measure.tangled.length} over the limit of ${config.limit}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(`Measuring failed: ${message}`);
      state.setError(`${message} Press "Show the log" to see what happened.`);
    }
  }

  async function openConfig(languageId?: string): Promise<void> {
    const folder = workspaceFolder();
    if (!folder) {
      void vscode.window.showInformationMessage('RefactorIt needs an open folder to set up. Open your project folder first.');
      return;
    }
    config = readConfig(folder);
    const defaults = await detectDefaults(folder, languageId);
    ConfigPanel.show(
      context.extensionUri,
      config,
      defaults,
      (runAfter) => {
        config = readConfig(folder);
        if (runAfter) {
          void run();
        }
      },
      (id) => detectDefaults(folder, id),
    );
  }

  const onSidebarMessage = (msg: SidebarMessage): void => {
    switch (msg.type) {
      case 'run':
        void run();
        break;
      case 'configure':
        void openConfig();
        break;
      case 'output':
        output.show(true);
        break;
      case 'toggleNumbers':
        void vscode.workspace.getConfiguration('refactorit', workspaceFolder()).update('showNumbers', !config.showNumbers, vscode.ConfigurationTarget.Workspace).then(() => {
          config = readConfig(workspaceFolder());
          state.fire();
        });
        break;
      case 'open':
        if (msg.path && msg.line) {
          void openLine(msg.path, msg.line);
        }
        break;
      case 'untangle':
        if (msg.path && msg.line) {
          void untangle(deps, msg.path, msg.line);
        }
        break;
      case 'measureAgain':
        if (msg.path && msg.name) {
          void measureAgain(deps, msg.path, msg.name);
        }
        break;
      default:
        break;
    }
  };

  async function openLine(relativePath: string, line: number): Promise<void> {
    const folder = workspaceFolder();
    if (!folder) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(absoluteUri(folder, relativePath));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  const sidebar = new SidebarView(context.extensionUri, state, () => ({ showNumbers: config.showNumbers }), onSidebarMessage, version);
  const folder = workspaceFolder();
  if (folder) {
    state.setRuns(loadRuns(workspaceRootOf(folder), (l) => output.appendLine(l)));
  }

  context.subscriptions.push(
    output,
    state,
    sidebar,
    vscode.window.registerWebviewViewProvider('refactorit.sidebar', sidebar),
    vscode.commands.registerCommand('refactorit.run', run),
    vscode.commands.registerCommand('refactorit.configure', () => openConfig()),
    vscode.commands.registerCommand('refactorit.showOutput', () => output.show(true)),
    vscode.commands.registerCommand('refactorit.worst', () => untangleWorst(deps)),
    vscode.commands.registerCommand('refactorit.method', async (args?: { path: string; startLine?: number; line?: number }) => {
      if (!args?.path) {
        return;
      }
      if (state.phase !== 'results') {
        await run();
      }
      await untangle(deps, args.path, args.startLine ?? args.line ?? 0);
    }),
    vscode.commands.registerCommand('refactorit.measureAgain', (args?: { path: string; name: string }) => args && measureAgain(deps, args.path, args.name)),
    // Silent command for sibling tools: measure one file, no screens, one envelope.
    vscode.commands.registerCommand('refactorit.api.measure', async (args?: { path?: string }) => {
      const envelope = (ok: boolean, body: Record<string, unknown>) => ({ protocol: 1, tool: 'refactorit', version, ok, ...body });
      const folder = workspaceFolder();
      if (!folder || !args?.path) {
        return envelope(false, { error: 'RefactorIt needs an open folder and a file path to measure.' });
      }
      const plugin = pluginForFile(args.path) ?? currentPlugin();
      if (!plugin) {
        return envelope(false, { error: `RefactorIt cannot measure ${args.path} yet.` });
      }
      try {
        const methods = await measureFile(plugin, workspaceRootOf(folder), args.path, (l) => output.appendLine(l));
        const limit = readConfig(folder).limit;
        return envelope(true, { result: { path: args.path, limit, methods: methods.map((m) => ({ name: m.name, startLine: m.startLine, endLine: m.endLine, waysThrough: m.complexity, over: Math.max(0, m.complexity - limit) })) } });
      } catch (err) {
        return envelope(false, { error: `RefactorIt could not measure ${args.path}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('refactorit')) {
        config = readConfig(workspaceFolder());
        state.fire();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => state.fire()),
  );

  state.fire();
  return { state, run };
}

export function deactivate(): void {
  // Nothing to release beyond the subscriptions.
}
