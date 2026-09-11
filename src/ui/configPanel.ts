/**
 * The setup screen. Opens before the first measure (and on demand),
 * pre-filled by the language plugin's detection so the correct action for
 * most people is to press "Save and find the tangled methods" without
 * touching a field. The common fields are the same for every language; the
 * plugin's own block is rendered from its FieldSpec list, so this file
 * knows no language.
 */
import * as vscode from 'vscode';
import { UntangleItConfig, writeConfig } from '../config';
import { DEEPTEST_REPOSITORY_URL, showDeepTestInExtensionsView } from '../deeptest';
import { LanguageGuess } from '../detect/language';
import { KEEPSAFE_MARKETPLACE_URL, showKeepSafeInExtensionsView } from '../keepsafe';
import { allPlugins } from '../languages/registry';
import { Detection, FieldSpec } from '../languages/types';

export interface ConfigDefaults {
  detected: LanguageGuess[];
  languageId: string;
  detection?: Detection;
  keepSafeInstalled: boolean;
  deepTestInstalled: boolean;
}

interface PanelMessage {
  type: 'save' | 'saveAndRun' | 'redetect' | 'showKeepSafe' | 'showDeepTest';
  values?: Record<string, unknown>;
  languageId?: string;
}

export class ConfigPanel {
  private static current: ConfigPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(extensionUri: vscode.Uri, config: UntangleItConfig, defaults: ConfigDefaults, onSaved: (run: boolean) => void, redetect: (languageId: string) => Promise<ConfigDefaults>): void {
    if (ConfigPanel.current) {
      ConfigPanel.current.panel.reveal();
      ConfigPanel.current.render(config, defaults);
      return;
    }
    ConfigPanel.current = new ConfigPanel(extensionUri, config, defaults, onSaved, redetect);
  }

  private constructor(
    extensionUri: vscode.Uri,
    private config: UntangleItConfig,
    private defaults: ConfigDefaults,
    onSaved: (run: boolean) => void,
    redetect: (languageId: string) => Promise<ConfigDefaults>,
  ) {
    this.panel = vscode.window.createWebviewPanel('untangleit.config', 'UntangleIt setup', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [extensionUri],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'untangleit.svg');
    this.panel.onDidDispose(() => {
      ConfigPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg: PanelMessage) => {
      if (msg.type === 'showKeepSafe') {
        await showKeepSafeInExtensionsView();
        return;
      }
      if (msg.type === 'showDeepTest') {
        await showDeepTestInExtensionsView();
        return;
      }
      if (msg.type === 'redetect') {
        this.defaults = await redetect(msg.languageId ?? this.defaults.languageId);
        this.render(this.config, this.defaults);
        return;
      }
      if (msg.values) {
        await writeConfig(msg.values);
        vscode.window.setStatusBarMessage('Setup saved', 3000);
        onSaved(msg.type === 'saveAndRun');
        if (msg.type === 'saveAndRun') {
          this.panel.dispose();
        }
      }
    });
    this.render(config, defaults);
  }

  render(config: UntangleItConfig, defaults: ConfigDefaults): void {
    this.config = config;
    this.defaults = defaults;
    this.panel.webview.html = this.html();
  }

  private html(): string {
    const c = this.config;
    const d = this.defaults;
    const nonce = Math.random().toString(36).slice(2);
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const plugins = allPlugins();
    const language = d.languageId;
    const plugin = plugins.find((p) => p.id === language);
    const detectedList = d.detected.length ? d.detected.map((g) => `${g.language} (${g.files} file${g.files === 1 ? '' : 's'})`).join(', ') : 'no code I recognise';
    const unsupported = d.detected.map((g) => g.language).filter((id) => !plugins.some((p) => p.id === id || p.vscodeLanguageIds.includes(id)));
    const languageOptions = [
      ...plugins.map((p) => `<option value="${esc(p.id)}" ${p.id === language ? 'selected' : ''}>${esc(p.displayName)}</option>`),
      ...Array.from(new Set(unsupported)).map((id) => `<option value="${esc(id)}" ${id === language ? 'selected' : ''}>${esc(id)} (not yet)</option>`),
    ].join('');
    const testsPath = c.testsPath || d.detection?.testsPath || '';
    const sourceRoot = c.sourceRoot || d.detection?.sourceRoot || '';
    const found = d.detection?.sourceFiles.length ?? 0;
    const notes = d.detection?.notes ?? [];
    const saved = c.languageSettings[language] ?? {};
    const fieldValue = (f: FieldSpec): unknown => (saved[f.key] !== undefined && saved[f.key] !== '' ? saved[f.key] : d.detection?.fields[f.key]);
    const renderField = (f: FieldSpec): string => {
      const id = `lang_${f.key}`;
      const value = fieldValue(f);
      const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
      switch (f.kind) {
        case 'checkbox':
          return `<label class="check"><input type="checkbox" id="${id}" data-key="${esc(f.key)}" data-kind="checkbox" ${value ? 'checked' : ''}> ${esc(f.label)}</label>${hint}`;
        case 'select':
          return `<label for="${id}">${esc(f.label)}</label><select id="${id}" data-key="${esc(f.key)}" data-kind="select">${(f.options ?? [])
            .map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`)
            .join('')}</select>${hint}`;
        case 'number':
          return `<label for="${id}">${esc(f.label)}</label><input type="number" id="${id}" data-key="${esc(f.key)}" data-kind="number" value="${esc(String(value ?? ''))}">${hint}`;
        default:
          return `<label for="${id}">${esc(f.label)}</label><input type="text" id="${id}" data-key="${esc(f.key)}" data-kind="text" value="${esc(String(value ?? ''))}" placeholder="${esc(f.placeholder ?? '')}">${hint}`;
      }
    };
    const languageBlock = plugin
      ? `<h2>${esc(plugin.displayName)}</h2>${plugin.configFields.map(renderField).join('')}`
      : `<h2>Language</h2><div class="note">I cannot measure <code>${esc(language || 'this language')}</code> yet. I can measure: ${plugins.map((p) => esc(p.displayName)).join(', ')}. Pick one of those above if it fits, or watch for the next release.</div>`;
    const keepSafeBlock = d.keepSafeInstalled
      ? `<p class="hint">KeepSafe is installed. It takes a checkpoint of your whole project and can put everything back the way it was.</p>
  <label class="check"><input type="checkbox" id="offerCheckpoint" ${c.keepSafe.offerCheckpoint ? 'checked' : ''}> Before "Untangle it" hands work to your AI assistant, ask me whether to create a KeepSafe checkpoint.</label>`
      : `<p class="hint">"Untangle it" hands work to your AI assistant, and the assistant will change your code. UntangleIt recommends KeepSafe, a separate extension that takes a checkpoint of your whole project first and puts everything back if the change goes wrong. It is not installed. <a href="${KEEPSAFE_MARKETPLACE_URL}">KeepSafe on the VS Code Marketplace</a>.</p>
  <button id="showKeepSafe">Show KeepSafe in the Extensions view</button>`;
    const deepTestBlock = d.deepTestInstalled
      ? `<p class="hint">DeepTest is installed. After an untangling, press "Check my code again" in DeepTest to see whether every new piece has the tests it needs.</p>`
      : `<p class="hint">UntangleIt checks that an untangling kept the behaviour by running your tests. DeepTest, a separate tool, goes further and says whether every new piece has enough tests. It is not installed. <a href="${DEEPTEST_REPOSITORY_URL}">DeepTest on GitHub</a>.</p>
  <button id="showDeepTest">Show DeepTest in the Extensions view</button>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 24px 24px; max-width: 760px; }
  h1 { font-size: 1.3em; font-weight: 600; margin: 20px 0 4px; }
  h2 { font-size: 1em; font-weight: 600; margin: 24px 0 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); padding-bottom: 4px; }
  p.hint { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
  label { display: block; margin: 10px 0 4px; font-weight: 500; }
  input[type=text], input[type=number], select { width: 100%; box-sizing: border-box; padding: 5px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font-family: inherit; }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .check { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-weight: normal; }
  .check input { width: auto; }
  .actions { margin-top: 24px; display: flex; gap: 8px; }
  button { padding: 6px 14px; border: none; border-radius: 2px; cursor: pointer; font-family: inherit; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.1); }
  .note { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 8px 12px; margin: 8px 0; }
  a { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
  <h1>UntangleIt setup</h1>
  <p class="hint">These fields were filled in from what UntangleIt found in your project. If they look right, press "Save and find the tangled methods". Everything here is also an ordinary setting under <code>untangleit.*</code>.</p>

  <h2>Your project</h2>
  <p class="hint">Found: ${esc(detectedList)}.</p>
  <label for="language">Language</label>
  <select id="language">${languageOptions}</select>
  <div class="row">
    <div><label for="sourceRoot">Folder with the code</label><input type="text" id="sourceRoot" value="${esc(sourceRoot)}" placeholder="src (empty means the whole project)"><p class="hint">${found} source file${found === 1 ? '' : 's'} found.</p></div>
    <div><label for="testsPath">Folder with the tests</label><input type="text" id="testsPath" value="${esc(testsPath)}" placeholder="tests"><p class="hint">UntangleIt runs these to check that an untangling kept the behaviour.</p></div>
  </div>
  ${notes.length ? `<div class="note">${notes.map((n) => `<div>${esc(n)}</div>`).join('')}</div>` : ''}
  <button id="redetect">Look at the project again</button>

  ${languageBlock}

  <h2>What counts as tangled</h2>
  <div class="row">
    <div><label for="limit">Most ways through one method</label><input type="number" id="limit" min="1" step="1" value="${c.limit}"><p class="hint">Above this, a method is too tangled. Every piece produced by an untangling must fit under it too.</p></div>
    <div><label for="rounds">Rounds before UntangleIt stops</label><input type="number" id="rounds" min="1" step="1" value="${c.rounds}"><p class="hint">How many times "Measure again" may offer to send the method back before it hands the result to you.</p></div>
  </div>
  <label class="check"><input type="checkbox" id="showNumbers" ${c.showNumbers ? 'checked' : ''}> Show the engineer's numbers next to the plain words.</label>

  <h2>Before the AI changes your code</h2>
  ${keepSafeBlock}

  <h2>After the AI changes your code</h2>
  ${deepTestBlock}

  <div class="actions">
    <button class="primary" id="saveRun">Save and find the tangled methods</button>
    <button id="save">Save</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const v = (id) => document.getElementById(id).value;
  const n = (id) => Number(document.getElementById(id).value);
  const b = (id) => document.getElementById(id).checked;
  function collect() {
    const fields = {};
    for (const el of document.querySelectorAll('[data-key]')) {
      const kind = el.getAttribute('data-kind');
      fields[el.getAttribute('data-key')] = kind === 'checkbox' ? el.checked : kind === 'number' ? Number(el.value) : el.value.trim();
    }
    const languageSettings = Object.assign({}, ${JSON.stringify(c.languageSettings).replace(/</g, '\\u003c')});
    languageSettings[v('language')] = fields;
    return {
      'language': v('language'),
      'testsPath': v('testsPath').trim(),
      'sourceRoot': v('sourceRoot').trim(),
      'languageSettings': languageSettings,
      'limit': n('limit'),
      'rounds': n('rounds'),
      'showNumbers': b('showNumbers'),
      ...(document.getElementById('offerCheckpoint') ? { 'keepSafe.offerCheckpoint': b('offerCheckpoint') } : {}),
    };
  }
  document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save', values: collect() }));
  document.getElementById('saveRun').addEventListener('click', () => vscode.postMessage({ type: 'saveAndRun', values: collect() }));
  document.getElementById('redetect').addEventListener('click', () => vscode.postMessage({ type: 'redetect', languageId: v('language') }));
  document.getElementById('language').addEventListener('change', () => vscode.postMessage({ type: 'redetect', languageId: v('language') }));
  for (const [id, type] of [['showKeepSafe', 'showKeepSafe'], ['showDeepTest', 'showDeepTest']]) {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('click', () => vscode.postMessage({ type })); }
  }
</script>
</body>
</html>`;
  }
}
