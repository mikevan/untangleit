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
 * A plugin supplies four things, and may supply a fifth:
 *   detect       - look at the workspace and pre-fill every setting it can,
 *                  so the first run asks the user nothing
 *   structure    - parse a source file and say which methods it holds and
 *                  how many ways through each one has
 *   tests        - run the project's own test suite through the project's
 *                  own runner and say whether it passed
 *   configFields - the small language-specific block on the setup screen,
 *                  rendered by the shared screen from this description
 *   recorder     - optional: run the project's own tests once more with the
 *                  Witness boundary recorder attached, for the behaviour
 *                  gate. A language without one has no gate, and the gate
 *                  says so rather than passing.
 */
import type { BoundaryRecord, ProblemPacket } from '@projectrevivesolutions/witness';
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
  /**
   * The person's own surface, as against the log.
   *
   * A driver uses this for the rare thing a person has to be told even
   * though the run itself did not raise it: the project path stopped the
   * runner before a test executed, for instance, which the verdict alone
   * reports as no evidence and which would otherwise look like their fault.
   *
   * What travels is a packet, not a paragraph. The driver states what it
   * established, what it could not, and what must not be recommended; the
   * product decides how to show it and offers to have it explained. Nothing
   * down here writes prose for a person to read.
   *
   * Optional because a headless caller has no such surface, and a driver
   * that has nothing to say to a person is the ordinary case.
   */
  report?: (packet: ProblemPacket) => void;
  signal?: AbortSignal;
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  exitCode: number | null;
}

/** The one method a recorded run watches. */
export interface BoundarySpec {
  /** The file holding it, workspace-relative, forward slashes. */
  path: string;
  /** The method name. */
  name: string;
  /** The class it belongs to, when it has one. */
  container?: string;
}

/**
 * Runs the project's own tests once with the Witness boundary recorder
 * attached, and hands back what it recorded.
 *
 * The project still runs its tests the way the project runs them. Witness
 * supplies the path in and nothing here replaces a runner, edits a line of
 * the person's source, or asks the project to install anything.
 */
export interface BoundaryRecorder {
  /** Plain-language description of what will run, for the log. */
  describe(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): string;
  record(ctx: RunContext & { boundary: BoundarySpec }): Promise<BoundaryRecord[]>;
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
  /** The behaviour gate's recorder, when this language has one. */
  createBoundaryRecorder?(): BoundaryRecorder | undefined;
  createStructureSource(env: StructureEnvironment): Promise<StructureSource>;
}
