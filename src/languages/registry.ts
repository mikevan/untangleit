/**
 * The one list of languages. Everything above the contract asks this file;
 * nothing above the contract imports a plugin directly.
 */
import { pythonPlugin } from './python';
import { LanguagePlugin } from './types';
import { typescriptPlugin } from './typescript';

const PLUGINS: LanguagePlugin[] = [typescriptPlugin, pythonPlugin];

export function allPlugins(): LanguagePlugin[] {
  return PLUGINS;
}

export function pluginById(id: string): LanguagePlugin | undefined {
  return PLUGINS.find((p) => p.id === id || p.vscodeLanguageIds.includes(id));
}

export function pluginForFile(relativePath: string): LanguagePlugin | undefined {
  const lower = relativePath.toLowerCase();
  return PLUGINS.find((p) => p.extensions.some((ext) => lower.endsWith(ext)));
}
