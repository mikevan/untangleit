/**
 * TypeScript / JavaScript plugin: tree-sitter (typescript, tsx, javascript
 * grammars) for the methods and their ways through, Jest or Vitest from
 * the project's own node_modules for verification, and detection from
 * package.json so the first run asks nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Parser } from 'web-tree-sitter';
import { FunctionComplexity } from '../../engine/types';
import { runProcess } from '../shared/process';
import { createParser, initTreeSitter } from '../shared/treeSitter';
import { Detection, FieldSpec, HostServices, LanguagePlugin, LanguageSettings, RunContext, StructureEnvironment, StructureSource, TestRunSummary, TestRunner } from '../types';
import { analyzeTypeScriptTree } from './structure';

export type Runner = 'jest' | 'vitest';

const FIELDS: FieldSpec[] = [
  {
    key: 'runner',
    label: 'Test runner',
    kind: 'select',
    options: [
      { value: 'auto', label: 'Detect from package.json' },
      { value: 'vitest', label: 'Vitest' },
      { value: 'jest', label: 'Jest' },
    ],
    hint: 'UntangleIt runs the project\'s own tests to check that an untangling kept the behaviour.',
  },
  {
    key: 'extraArgs',
    label: 'Extra runner arguments',
    kind: 'text',
    placeholder: '--bail',
    hint: 'Optional. Passed to the runner as typed.',
  },
];

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.untangleit', '.deeptest', '.keepsafe', '.vscode-test', '.next', '.nuxt', '.svelte-kit', 'vendor']);
const SOURCE_EXT = /\.(m?[jt]sx?|c[jt]s)$/;
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)/;

export function isTestFile(relativePath: string): boolean {
  return TEST_FILE.test(path.basename(relativePath)) || relativePath.split('/').includes('__tests__');
}

export function walkTree(root: string, relative = ''): string[] {
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
        out.push(...walkTree(root, rel));
      }
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

export function readPackageJson(workspaceRoot: string): { deps: Record<string, string>; scripts: Record<string, string> } | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    return {
      deps: { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) },
      scripts: (pkg.scripts as Record<string, string> | undefined) ?? {},
    };
  } catch {
    return undefined;
  }
}

/** Finds an installed package by walking up from the workspace, the way Node resolves modules. */
export function resolveModuleDir(workspaceRoot: string, name: string): string | undefined {
  let dir = workspaceRoot;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function detectRunner(workspaceRoot: string): Runner | undefined {
  const pkg = readPackageJson(workspaceRoot);
  const hasVitest = Boolean(pkg?.deps.vitest) || Boolean(resolveModuleDir(workspaceRoot, 'vitest'));
  const hasJest = Boolean(pkg?.deps.jest) || Boolean(resolveModuleDir(workspaceRoot, 'jest'));
  const testScript = pkg?.scripts.test ?? '';
  if (hasVitest && hasJest) {
    return /\bjest\b/.test(testScript) && !/\bvitest\b/.test(testScript) ? 'jest' : 'vitest';
  }
  return hasVitest ? 'vitest' : hasJest ? 'jest' : undefined;
}

export function guessTestsPath(workspaceRoot: string): string {
  for (const candidate of ['test', 'tests', '__tests__', 'spec', 'src/__tests__']) {
    if (fs.existsSync(path.join(workspaceRoot, candidate))) {
      return candidate;
    }
  }
  return '';
}

export function guessSourceRoot(workspaceRoot: string, testsPath: string): string {
  for (const candidate of ['src', 'lib', 'app']) {
    if (candidate !== testsPath && fs.existsSync(path.join(workspaceRoot, candidate)) && walkTree(path.join(workspaceRoot, candidate)).length > 0) {
      return candidate;
    }
  }
  return '';
}

/** Terminal colour codes, which runners emit even when asked not to. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function grabCounts(line: string): Pick<TestRunSummary, 'passed' | 'failed' | 'skipped'> {
  const grab = (word: string): number => {
    const m = line.match(new RegExp(`(\\d+) ${word}`));
    return m ? Number(m[1]) : 0;
  };
  return { passed: grab('passed'), failed: grab('failed'), skipped: grab('skipped') + grab('todo') };
}

export function parseJestSummary(output: string, exitCode: number | null): TestRunSummary {
  const line = stripAnsi(output).split(/\r?\n/).reverse().find((l) => /^\s*Tests:/.test(l));
  return { errors: 0, exitCode, ...(line ? grabCounts(line) : { passed: 0, failed: 0, skipped: 0 }) };
}

export function parseVitestSummary(output: string, exitCode: number | null): TestRunSummary {
  const line = stripAnsi(output).split(/\r?\n/).reverse().find((l) => /^\s*Tests\s+\d/.test(l));
  return { errors: 0, exitCode, ...(line ? grabCounts(line) : { passed: 0, failed: 0, skipped: 0 }) };
}

export function tsFields(settings: LanguageSettings): { runner: 'auto' | Runner; extraArgs: string } {
  const f = settings.fields;
  const runner = f.runner === 'jest' || f.runner === 'vitest' ? f.runner : 'auto';
  return { runner, extraArgs: typeof f.extraArgs === 'string' ? f.extraArgs : '' };
}

function splitArgs(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

function walkSources(workspaceRoot: string, sourceRoot: string, testsPath: string): string[] {
  const base = sourceRoot ? path.join(workspaceRoot, sourceRoot) : workspaceRoot;
  return walkTree(base)
    .map((rel) => (sourceRoot ? `${sourceRoot}/${rel}` : rel))
    .filter((rel) => !isTestFile(rel) && !(testsPath && rel.startsWith(`${testsPath}/`)));
}

async function detect(workspaceRoot: string, _host: HostServices): Promise<Detection> {
  const notes: string[] = [];
  const runner = detectRunner(workspaceRoot);
  if (!readPackageJson(workspaceRoot)) {
    notes.push('No package.json at the workspace root.');
  } else if (runner) {
    notes.push(`Found ${runner}. UntangleIt will run it to check that an untangling kept the behaviour.`);
  } else {
    notes.push('No test runner found in package.json. Without tests, UntangleIt cannot verify behaviour; it will still measure.');
  }
  const testsPath = guessTestsPath(workspaceRoot);
  const sourceRoot = guessSourceRoot(workspaceRoot, testsPath);
  return { testsPath, sourceRoot, sourceFiles: walkSources(workspaceRoot, sourceRoot, testsPath), fields: { runner: 'auto', extraArgs: '' }, notes };
}

class NodeTestRunner implements TestRunner {
  private runnerFor(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): Runner | undefined {
    const { runner } = tsFields(ctx.settings);
    return runner === 'auto' ? detectRunner(ctx.workspaceRoot) : runner;
  }

  describe(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): string {
    const runner = this.runnerFor(ctx);
    return runner ? `${runner} ${ctx.settings.testsPath || ''}`.trim() : 'no test runner found';
  }

  async run(ctx: RunContext): Promise<TestRunSummary> {
    const runner = this.runnerFor(ctx);
    if (!runner) {
      throw new Error('No test runner was found. Install Vitest or Jest, or pick one on the setup screen.');
    }
    const moduleDir = resolveModuleDir(ctx.workspaceRoot, runner);
    if (!moduleDir) {
      throw new Error(`${runner} is not installed. Run npm install.`);
    }
    const { extraArgs } = tsFields(ctx.settings);
    const env = { ...process.env, CI: process.env.CI ?? 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
    const testsPath = ctx.settings.testsPath;
    const args =
      runner === 'jest'
        ? [path.join(moduleDir, 'bin', 'jest.js'), '--ci', ...splitArgs(extraArgs), ...(testsPath ? [`^${escapeRegex(path.join(ctx.workspaceRoot, testsPath).split(path.sep).join('/'))}/`] : [])]
        : [path.join(moduleDir, 'vitest.mjs'), 'run', ...(testsPath ? [`${testsPath}/`] : []), ...splitArgs(extraArgs)];
    ctx.log(`$ node ${args.join(' ')}`);
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env, log: ctx.log, signal: ctx.signal });
    return runner === 'jest' ? parseJestSummary(run.output, run.exitCode) : parseVitestSummary(run.output, run.exitCode);
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class TypeScriptStructureSource implements StructureSource {
  constructor(private readonly parsers: { typescript: Parser; tsx: Parser; javascript: Parser }) {}

  measure(relativePath: string, text: string): FunctionComplexity[] {
    const ext = path.extname(relativePath).toLowerCase();
    const parser = ext === '.tsx' ? this.parsers.tsx : ext === '.ts' || ext === '.mts' || ext === '.cts' ? this.parsers.typescript : this.parsers.javascript;
    const tree = parser.parse(text);
    if (!tree) {
      throw new Error(`tree-sitter could not parse ${relativePath}`);
    }
    try {
      return analyzeTypeScriptTree(relativePath, tree).functions;
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.parsers.typescript.delete();
    this.parsers.tsx.delete();
    this.parsers.javascript.delete();
  }
}

export const typescriptPlugin: LanguagePlugin = {
  id: 'typescript',
  displayName: 'TypeScript / JavaScript',
  vscodeLanguageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  configFields: FIELDS,
  isTestFile,
  walkSources,
  detect,
  createTestRunner(): TestRunner {
    return new NodeTestRunner();
  },
  async createStructureSource(env: StructureEnvironment): Promise<StructureSource> {
    await initTreeSitter(path.join(env.wasmDir, 'web-tree-sitter.wasm'));
    const [typescript, tsx, javascript] = await Promise.all([
      createParser(path.join(env.wasmDir, 'tree-sitter-typescript.wasm')),
      createParser(path.join(env.wasmDir, 'tree-sitter-tsx.wasm')),
      createParser(path.join(env.wasmDir, 'tree-sitter-javascript.wasm')),
    ]);
    return new TypeScriptStructureSource({ typescript, tsx, javascript });
  },
};
