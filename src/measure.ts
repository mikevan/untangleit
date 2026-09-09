/**
 * Measures the workspace: every source file of the chosen language, parsed
 * to its methods and their ways through. Pure measurement; no AI, no test
 * run. This is the method-call half of the tool.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RefactorItConfig, settingsFor } from './config';
import { FunctionComplexity } from './engine/types';
import { MeasuredMethod, WorkspaceMeasure, measureWorkspace } from './engine/tangle';
import { LanguagePlugin, StructureSource } from './languages/types';
import { runtimeEnvironment } from './languages/shared/runtime';

export interface MeasureResult {
  measure: WorkspaceMeasure;
  language: string;
  files: string[];
}

export async function measureFiles(plugin: LanguagePlugin, workspaceRoot: string, files: string[], limit: number, log: (line: string) => void): Promise<MeasureResult> {
  let source: StructureSource | undefined;
  try {
    source = await plugin.createStructureSource({ wasmDir: runtimeEnvironment().wasmDir });
    const methods: MeasuredMethod[] = [];
    let parsed = 0;
    for (const rel of files) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(workspaceRoot, ...rel.split('/')), 'utf8');
      } catch {
        continue;
      }
      try {
        for (const fn of source.measure(rel, text)) {
          methods.push({ ...fn, path: rel });
        }
        parsed += 1;
      } catch (err) {
        log(`Could not parse ${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { measure: measureWorkspace(methods, limit, parsed), language: plugin.displayName, files };
  } finally {
    source?.dispose();
  }
}

export async function measureFile(plugin: LanguagePlugin, workspaceRoot: string, relativePath: string, log: (line: string) => void): Promise<FunctionComplexity[]> {
  const result = await measureFiles(plugin, workspaceRoot, [relativePath], Number.MAX_SAFE_INTEGER, log);
  return result.measure.methods;
}

export function sourceFilesFor(plugin: LanguagePlugin, config: RefactorItConfig, workspaceRoot: string): string[] {
  const settings = settingsFor(config, plugin.id);
  return plugin.walkSources(workspaceRoot, settings.sourceRoot, settings.testsPath);
}
