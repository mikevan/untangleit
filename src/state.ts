/**
 * The one place results live. The UI reads from here and listens for
 * changes; the measurer and the loop write here.
 */
import * as vscode from 'vscode';
import { WorkspaceMeasure } from './engine/tangle';
import { RunFile, emptyRunFile } from './runs';

export type Phase = 'idle' | 'running' | 'results' | 'noCode' | 'error';

export interface MeasureInfo {
  language: string;
  finishedAt: Date;
  durationMs: number;
}

export class ResultState implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  phase: Phase = 'idle';
  measure: WorkspaceMeasure | undefined;
  info: MeasureInfo | undefined;
  message = '';
  runs: RunFile = emptyRunFile();

  setRunning(): void {
    this.phase = 'running';
    this.message = '';
    this.fire();
  }

  setResults(measure: WorkspaceMeasure, info: MeasureInfo): void {
    this.phase = 'results';
    this.measure = measure;
    this.info = info;
    this.fire();
  }

  setRuns(runs: RunFile): void {
    this.runs = runs;
    this.fire();
  }

  setNoCode(message: string): void {
    this.phase = 'noCode';
    this.message = message;
    this.fire();
  }

  setError(message: string): void {
    this.phase = 'error';
    this.message = message;
    this.fire();
  }

  fire(): void {
    void vscode.commands.executeCommand('setContext', 'untangleit.hasResults', this.phase === 'results');
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
