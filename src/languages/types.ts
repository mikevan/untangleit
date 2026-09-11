/**
 * THE CONTRACT.
 *
 * Every language plugs in here, and nothing above this file knows which
 * language it is talking to. The measurer, the loop, the side panel, the
 * brief, and the setup screen consume only these types. Adding a language
 * is a new folder under src/languages/, one line in the registry, and zero
 * edits anywhere else. If adding a language needs an edit above this
 * contract, that is a bug in the contract.
 *
 * A plugin supplies four things:
 *   detect       - look at the workspace and pre-fill every setting it can,
 *                  so the first run asks the user nothing
 *   structure    - parse a source file and say which methods it holds and
 *                  how many ways through each one has
 *   tests        - run the project's own test suite through the project's
 *                  own runner and say whether it passed
 *   configFields - the small language-specific block on the setup screen,
 *                  rendered by the shared screen from this description
 */
import { FunctionComplexity } from '../engine/types';

/** One language-specific field on the setup screen. */
export interface FieldSpec {
  /** Key inside untangleit.languageSettings.<languageId>. */
  key: string;
  label: string;
  kind: 'text' | 'number' | 'checkbox' | 'select';
  placeholder?: string;
  /** One sentence under the field. Plain words. */
  hint?: string;
  options?: Array<{ value: string; label: string }>;
}

/** Everything a plugin worked out about a workspace without asking. */
export interface Detection {
  /** Tests folder relative to the workspace, or empty when unknown. */
  testsPath: string;
  /** Code to measure relative to the workspace, or empty for the whole workspace. */
  sourceRoot: string;
  /** Source files found, workspace-relative, forward slashes. */
  sourceFiles: string[];
  /** Pre-filled values for this plugin's configFields. */
  fields: Record<string, unknown>;
  /** Plain-language notes shown on the setup screen. */
  notes: string[];
}

/** What the host can do for a plugin during detection. Keeps vscode out of plugins. */
export interface HostServices {
  activeLanguageId?: string;
  extensionApi(extensionId: string): Promise<unknown>;
}

/** The user's answers for one language: the common fields plus the plugin's own. */
export interface LanguageSettings {
  testsPath: string;
  sourceRoot: string;
  fields: Record<string, unknown>;
}

export interface RunContext {
  workspaceRoot: string;
  settings: LanguageSettings;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  exitCode: number | null;
}

/** Runs the project's tests the way the project runs them. No coverage, no hooks. */
export interface TestRunner {
  /** Plain-language description of what will run, for the log and the setup screen. */
  describe(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): string;
  run(ctx: RunContext): Promise<TestRunSummary>;
}

/** Parses one source file into its methods with their ways through. */
export interface StructureSource {
  measure(relativePath: string, text: string): FunctionComplexity[];
  dispose(): void;
}

export interface StructureEnvironment {
  /** Absolute folder holding the tree-sitter runtime and grammar wasm files. */
  wasmDir: string;
}

export interface LanguagePlugin {
  /** Stable id used in settings: 'python', 'typescript'. */
  readonly id: string;
  readonly displayName: string;
  /** VS Code language ids this plugin measures. */
  readonly vscodeLanguageIds: string[];
  /** File extensions, with the dot, for workspace detection. */
  readonly extensions: string[];
  readonly configFields: FieldSpec[];

  isTestFile(relativePath: string): boolean;
  /** Source files under a root, workspace-relative, forward slashes, tests excluded. */
  walkSources(workspaceRoot: string, sourceRoot: string, testsPath: string): string[];
  detect(workspaceRoot: string, host: HostServices): Promise<Detection>;
  createTestRunner(): TestRunner;
  createStructureSource(env: StructureEnvironment): Promise<StructureSource>;
}
