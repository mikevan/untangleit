/**
 * The side panel: verdict first, one button, then the tangled methods as
 * cards worst first, each with "Untangle it", "Open", and, once sent,
 * "Measure again". Plain words; the engineer's numbers behind one switch.
 */
import * as vscode from 'vscode';
import { ResultState } from '../state';
import { openRunFor } from '../runs';
import { PRODUCT, Voice, meaning, runSentence, tangledSentence, tangle, verdict, wasBefore } from './words';

export interface SidebarMessage {
  type: 'run' | 'configure' | 'output' | 'open' | 'untangle' | 'measureAgain' | 'toggleNumbers';
  path?: string;
  line?: number;
  name?: string;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class SidebarView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: ResultState,
    private readonly voice: () => Voice,
    private readonly onMessage: (msg: SidebarMessage) => void,
    private readonly version: string,
  ) {
    this.disposables.push(state.onDidChange(() => this.render()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // The panel header is the view container's title, set in package.json at
    // build time, and it already reads "UntangleIt - Polyglot <version>".
    // Setting the view's own title here as well made VS Code render the two
    // joined by a colon, so the name and the build number each appeared twice.
    // One name, in one place.
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.onDidReceiveMessage((msg: SidebarMessage) => this.onMessage(msg));
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.render();
  }

  render(): void {
    if (this.view) {
      this.view.webview.html = this.html(this.voice());
    }
  }

  private html(voice: Voice): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 12px 24px; margin: 0; line-height: 1.4; }
  h2 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 18px 0 6px; font-weight: 600; }
  .verdict { padding: 10px 12px; border-radius: 6px; margin: 4px 0 10px; }
  .verdict.ready { background: rgba(46,160,67,0.16); border-left: 4px solid #2ea043; }
  .verdict.notready { background: rgba(248,81,73,0.16); border-left: 4px solid #f85149; }
  .verdict.neutral { background: var(--vscode-textBlockQuote-background); border-left: 4px solid var(--vscode-textBlockQuote-border); }
  .verdict strong { display: block; font-size: 1.05em; margin-bottom: 2px; }
  .muted { color: var(--vscode-descriptionForeground); }
  button { font-family: inherit; font-size: inherit; padding: 6px 12px; border: none; border-radius: 3px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); width: 100%; padding: 9px; font-size: 1.05em; }
  button.small { padding: 3px 9px; font-size: 0.92em; }
  button.small.primary-ish { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.12); }
  button:disabled { opacity: 0.6; cursor: default; }
  .links { display: flex; gap: 12px; margin: 8px 0 0; flex-wrap: wrap; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }
  .card { border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
  .card .where { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .card .where a { font-family: var(--vscode-editor-font-family); }
  .badge { font-size: 0.85em; padding: 1px 7px; border-radius: 10px; white-space: nowrap; background: rgba(248,81,73,0.22); }
  .actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .run { font-size: 0.92em; padding: 5px 8px; border-radius: 3px; margin-top: 6px; background: var(--vscode-textBlockQuote-background); }
  details { margin: 6px 0; }
  summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
  ul.rest { list-style: none; padding: 0; margin: 4px 0; }
  ul.rest li { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px dashed var(--vscode-widget-border, #444); }
  label.switch { display: flex; align-items: center; gap: 6px; margin-top: 18px; color: var(--vscode-descriptionForeground); cursor: pointer; }
  .numbers { font-size: 0.88em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
${this.body(voice)}
<p class="numbers" style="margin-top:24px">${PRODUCT} ${esc(this.version)}</p>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { return; }
    vscode.postMessage({ type: el.getAttribute('data-act'), path: el.getAttribute('data-path') || undefined, line: el.getAttribute('data-line') ? Number(el.getAttribute('data-line')) : undefined, name: el.getAttribute('data-name') || undefined });
  });
  const numbers = document.getElementById('numbers');
  if (numbers) { numbers.addEventListener('change', () => vscode.postMessage({ type: 'toggleNumbers' })); }
</script>
</body>
</html>`;
  }

  private body(voice: Voice): string {
    const s = this.state;
    switch (s.phase) {
      case 'running':
        return `<div class="verdict neutral"><strong>Measuring your code.</strong><span class="muted">${PRODUCT} is measuring the tangle of every method.</span></div>
          <button class="primary" disabled>Measuring.</button>
          <div class="links"><a data-act="output">Show the log</a></div>`;
      case 'noCode':
        return `<div class="verdict notready"><strong>No code was found to measure.</strong><span class="muted">${esc(s.message)}</span></div>
          <button class="primary" data-act="configure">Tell me where the code is</button>
          <div class="links"><a data-act="run">Try again</a><a data-act="output">Show the log</a></div>`;
      case 'error':
        return `<div class="verdict notready"><strong>The measuring did not finish.</strong><span class="muted">${esc(s.message)}</span></div>
          <button class="primary" data-act="run">Find the tangled methods again</button>
          <div class="links"><a data-act="output">Show the log</a><a data-act="configure">Change the setup</a></div>`;
      case 'results':
        return this.results(voice);
      default:
        return `<div class="verdict neutral"><strong>This project has not been measured yet.</strong><span class="muted">${PRODUCT} measures how tangled every method is, shows the ones that are too tangled to trust, and hands your AI assistant a strict brief to untangle them without changing what they do. You decide at every step.</span></div>
          <button class="primary" data-act="run">Find the tangled methods</button>
          <div class="links"><a data-act="configure">Tell me where the code is</a></div>`;
    }
  }

  private results(voice: Voice): string {
    const s = this.state;
    const m = s.measure;
    if (!m || !s.info) {
      return '';
    }
    const v = verdict(m);
    const parts: string[] = [];
    parts.push(`<div class="verdict ${v.ready ? 'ready' : 'notready'}"><strong>${esc(v.headline)}</strong><span class="muted">${esc(v.detail)}</span></div>`);
    parts.push(`<button class="primary" data-act="run">Find the tangled methods again</button>`);
    parts.push(`<div class="links"><a data-act="configure">Change the setup</a><a data-act="output">Show the log</a></div>`);
    parts.push(`<p class="muted">${esc(s.info.language)}, measured in ${(s.info.durationMs / 1000).toFixed(1)} seconds at ${esc(s.info.finishedAt.toLocaleTimeString())}.</p>`);
    // Open untanglings first, whether or not the method is still tangled:
    // a method the assistant brought under the limit leaves the tangled
    // list, and the button that judges the work must not leave with it.
    const open = s.runs.runs.filter((r) => r.status === 'sent' || r.status === 'still-over' || r.status === 'tests-fail');
    if (open.length > 0) {
      parts.push('<h2>Waiting on your assistance.</h2>');
      for (const r of open) {
        const attrs = `data-path="${esc(r.path)}" data-line="${r.startLine}" data-name="${esc(r.name)}"`;
        parts.push(`<div class="card">
          <div class="where"><a data-act="open" ${attrs}>${esc(r.name)}() in ${esc(r.path)}</a><span class="badge">${esc(wasBefore(r))}</span></div>
          <div class="run">${esc(runSentence(r))}</div>
          <div class="actions"><button class="small primary-ish" data-act="measureAgain" ${attrs}>Measure again</button><button class="small" data-act="open" ${attrs}>Open</button></div>
        </div>`);
      }
    }
    if (m.tangled.length > 0) {
      parts.push('<h2>Untangle these first</h2>');
      const top = m.tangled.slice(0, 5);
      for (const t of top) {
        const attrs = `data-path="${esc(t.path)}" data-line="${t.startLine}" data-name="${esc(t.name)}"`;
        const run = openRunFor(s.runs, t.path, t.name);
        const done = s.runs.runs.filter((r) => r.path === t.path && r.name === t.name && r.status === 'within-limit').pop();
        parts.push(`<div class="card">
          <div class="where"><a data-act="open" ${attrs}>${esc(t.path)} line ${t.startLine}</a><span class="badge">${esc(tangle(t.mbcc))}</span></div>
          <div>${esc(tangledSentence(t, voice))}</div>
          <div class="muted">${esc(meaning(t))}</div>
          ${run ? `<div class="run">${esc(runSentence(run))}</div>` : done ? `<div class="run">${esc(runSentence(done))}</div>` : ''}
          <div class="actions">${run ? `<button class="small primary-ish" data-act="measureAgain" ${attrs}>Measure again</button>` : `<button class="small primary-ish" data-act="untangle" ${attrs}>Untangle it</button>`}<button class="small" data-act="open" ${attrs}>Open</button></div>
        </div>`);
      }
      if (m.tangled.length > top.length) {
        parts.push(`<details><summary>${m.tangled.length - top.length} more tangled methods.</summary><ul class="rest">${m.tangled
          .slice(top.length)
          .map((t) => `<li><a data-act="open" data-path="${esc(t.path)}" data-line="${t.startLine}">${esc(t.name)}() in ${esc(t.path)}</a><span>${esc(tangle(t.mbcc))} <button class="small" data-act="untangle" data-path="${esc(t.path)}" data-line="${t.startLine}" data-name="${esc(t.name)}">Untangle it</button></span></li>`)
          .join('')}</ul></details>`);
      }
    }
    const finished = s.runs.runs.filter((r) => r.status === 'within-limit');
    if (finished.length > 0) {
      parts.push(`<details><summary>Untangled so far: ${finished.length}.</summary><ul class="rest">${finished
        .map((r) => `<li><span><a data-act="open" data-path="${esc(r.path)}" data-line="${r.startLine}">${esc(r.name)}() in ${esc(r.path)}</a><br><span class="muted">${esc(runSentence(r))}</span></span></li>`)
        .join('')}</ul></details>`);
    }
    parts.push(`<label class="switch"><input type="checkbox" id="numbers" ${voice.showNumbers ? 'checked' : ''}> Show the engineer's numbers next to the plain words.</label>`);
    return parts.join('\n');
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
