/**
 * Python plugin: tree-sitter for the methods and their ways through, pytest
 * through the project's own interpreter for verification, and detection
 * that fills in the interpreter and the tests folder without asking.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FunctionComplexity } from '../../engine/types';
import { runProcess } from '../shared/process';
import { createParser, initTreeSitter } from '../shared/treeSitter';
import { Detection, FieldSpec, HostServices, LanguagePlugin, LanguageSettings, RunContext, StructureEnvironment, StructureSource, TestRunSummary, TestRunner } from '../types';
import { analyzePythonTree } from './structure';

const FIELDS: FieldSpec[] = [
  {
    key: 'interpreter',
    label: 'Python interpreter',
    kind: 'text',
    placeholder: process.platform === 'win32' ? 'python' : 'python3',
    hint: 'Pre-filled from the Python extension when it has one selected, else from the project\'s own virtual environment. Needs pytest.',
  },
  {
    key: 'pytestArgs',
    label: 'Extra pytest arguments',
    kind: 'text',
    placeholder: '-x --maxfail=5',
    hint: 'Optional. Passed to pytest as typed.',
  },
];

const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', '.env', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache', '.refactorit', '.deeptest', '.keepsafe', 'build', 'dist', '.eggs']);
const TEST_FILE = /^(test_.*\.py|.*_test\.py|tests?\.py)$/;

export function isTestFile(relativePath: string): boolean {
  return TEST_FILE.test(path.basename(relativePath));
}

export function walkPython(root: string, relative = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        out.push(...walkPython(root, rel));
      }
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      out.push(rel);
    }
  }
  return out;
}

export function guessTestsPath(workspaceRoot: string): string {
  for (const candidate of ['tests', 'test', 'src/tests', 'src/test']) {
    if (fs.existsSync(path.join(workspaceRoot, candidate))) {
      return candidate;
    }
  }
  return '';
}

function guessSourceRoot(workspaceRoot: string, testsPath: string): string {
  for (const candidate of ['src', 'lib', 'app']) {
    const abs = path.join(workspaceRoot, candidate);
    if (candidate !== testsPath && fs.existsSync(abs) && walkPython(abs).length > 0) {
      return candidate;
    }
  }
  return '';
}

/** The project's own virtual environment, when it has one. */
export function interpreterFromProject(workspaceRoot: string): string | undefined {
  const bin = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  for (const env of ['.venv', 'venv', 'env', '.env', 'virtualenv']) {
    const candidate = path.join(workspaceRoot, env, ...bin);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function interpreterFromEditor(host: HostServices, workspaceRoot: string): Promise<string | undefined> {
  try {
    const api = (await host.extensionApi('ms-python.python')) as
      | { environments?: { getActiveEnvironmentPath?: (scope?: unknown) => { path?: string } | undefined } }
      | undefined;
    const env = api?.environments?.getActiveEnvironmentPath?.(workspaceRoot);
    if (env?.path && fs.existsSync(env.path)) {
      return env.path;
    }
  } catch {
    // The Python extension is optional.
  }
  return undefined;
}

export function pythonFields(settings: LanguageSettings, workspaceRoot?: string): { interpreter: string; pytestArgs: string } {
  const f = settings.fields;
  const fromProject = workspaceRoot ? interpreterFromProject(workspaceRoot) : undefined;
  return {
    interpreter: typeof f.interpreter === 'string' && f.interpreter ? f.interpreter : fromProject ?? (process.platform === 'win32' ? 'python' : 'python3'),
    pytestArgs: typeof f.pytestArgs === 'string' ? f.pytestArgs : '',
  };
}

export function splitArgs(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

export function parsePytestSummary(output: string, exitCode: number | null): TestRunSummary {
  const summary: TestRunSummary = { passed: 0, failed: 0, errors: 0, skipped: 0, exitCode };
  const lines = output.split(/\r?\n/).reverse();
  const line = lines.find((l) => /\b(passed|failed|error|errors|skipped|no tests ran)\b/.test(l) && /\bin [\d.]+s\b/.test(l));
  if (!line) {
    return summary;
  }
  const grab = (word: string): number => {
    const m = line.match(new RegExp(`(\\d+) ${word}`));
    return m ? Number(m[1]) : 0;
  };
  summary.passed = grab('passed');
  summary.failed = grab('failed');
  summary.errors = grab('errors?');
  summary.skipped = grab('skipped');
  return summary;
}

function walkSources(workspaceRoot: string, sourceRoot: string, testsPath: string): string[] {
  const base = sourceRoot ? path.join(workspaceRoot, sourceRoot) : workspaceRoot;
  return walkPython(base)
    .map((rel) => (sourceRoot ? `${sourceRoot}/${rel}` : rel))
    .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
}

async function detect(workspaceRoot: string, host: HostServices): Promise<Detection> {
  const notes: string[] = [];
  const testsPath = guessTestsPath(workspaceRoot);
  const sourceRoot = guessSourceRoot(workspaceRoot, testsPath);
  const sourceFiles = walkSources(workspaceRoot, sourceRoot, testsPath);
  let interpreter = await interpreterFromEditor(host, workspaceRoot);
  if (interpreter) {
    notes.push(`Using the Python selected in the Python extension: ${interpreter}`);
  } else if ((interpreter = interpreterFromProject(workspaceRoot) ?? '')) {
    notes.push(`Using the project's own virtual environment: ${interpreter}`);
  } else {
    interpreter = '';
    const fallback = process.platform === 'win32' ? 'python' : 'python3';
    try {
      const probe = await runProcess(fallback, ['--version'], { cwd: workspaceRoot });
      if (probe.exitCode === 0) {
        notes.push(`Using ${fallback} on PATH (${probe.output.trim()}).`);
      }
    } catch {
      notes.push(`No Python found on PATH as '${fallback}'. Enter one below.`);
    }
  }
  if (!testsPath) {
    notes.push('No tests folder found. Without tests, RefactorIt cannot verify that an untangling kept the behaviour; it will still measure.');
  }
  return { testsPath, sourceRoot, sourceFiles, fields: { interpreter, pytestArgs: '' }, notes };
}

class PytestRunner implements TestRunner {
  describe(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): string {
    const { interpreter } = pythonFields(ctx.settings, ctx.workspaceRoot);
    return `${interpreter} -m pytest ${ctx.settings.testsPath || '.'}`;
  }

  async run(ctx: RunContext): Promise<TestRunSummary> {
    const { interpreter, pytestArgs } = pythonFields(ctx.settings, ctx.workspaceRoot);
    const args = ['-m', 'pytest', ctx.settings.testsPath || '.', '-q', '-p', 'no:cacheprovider', ...splitArgs(pytestArgs)];
    ctx.log(`$ ${interpreter} ${args.join(' ')}`);
    const run = await runProcess(interpreter, args, { cwd: ctx.workspaceRoot, log: ctx.log, signal: ctx.signal });
    return parsePytestSummary(run.output, run.exitCode);
  }
}

class PythonStructureSource implements StructureSource {
  constructor(private readonly parser: { parse(text: string): { rootNode: unknown; delete(): void } | null; delete(): void }) {}

  measure(relativePath: string, text: string): FunctionComplexity[] {
    const tree = this.parser.parse(text);
    if (!tree) {
      throw new Error(`tree-sitter could not parse ${relativePath}`);
    }
    try {
      return analyzePythonTree(relativePath, tree as never).functions;
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.parser.delete();
  }
}

export const pythonPlugin: LanguagePlugin = {
  id: 'python',
  displayName: 'Python',
  vscodeLanguageIds: ['python'],
  extensions: ['.py'],
  configFields: FIELDS,
  isTestFile,
  walkSources,
  detect,
  createTestRunner(): TestRunner {
    return new PytestRunner();
  },
  async createStructureSource(env: StructureEnvironment): Promise<StructureSource> {
    await initTreeSitter(path.join(env.wasmDir, 'web-tree-sitter.wasm'));
    const parser = await createParser(path.join(env.wasmDir, 'tree-sitter-python.wasm'));
    return new PythonStructureSource(parser);
  },
};
