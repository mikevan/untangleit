/**
 * The JavaScript and TypeScript half of the behaviour gate's recorder.
 *
 * Every runner reached here is reached through Witness's delivery layer,
 * the same one DeepTest's measured runs go through. UntangleIt builds no
 * second path: it names the function to watch, and Witness's hooks do the
 * rest. That is why this file is short for six runners.
 *
 * The rule that has not changed: the project runs its tests the way the
 * project runs them. Nothing here replaces a runner, edits a line of the
 * person's source, or asks the project to install anything. The one
 * rewritten file exists only inside UntangleIt's own folder, or only inside
 * the runner's memory, depending on which seam the runner offers.
 *
 * Three shapes of delivery, decided by what each runner allows:
 *
 *   Vitest, Mocha, and Playwright's page instrument as the runner loads or
 *   builds the file, so the target is named in the environment and the hook
 *   rewrites it in passing.
 *
 *   Jest's transform contract is synchronous and the instrumenter is not,
 *   so the one file is rewritten ahead of the run and the transformer
 *   substitutes the text.
 *
 *   Angular's builder bundles the application before either runner is
 *   involved and exposes no hook in front of that, so the source is
 *   mirrored into a shadow tree with the one file rewritten, and the
 *   builder is pointed at the mirror.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ENV as WITNESS_ENV,
  angularKarmaConfig,
  detectPlaywrightCt,
  writePlaywrightFixture,
  playwrightWrapperConfig,
  copyHooks,
  createInstrumenter,
  escapeRegex,
  findVitestConfig,
  posixPath,
  readBoundaryRecords,
  resolveModuleDir,
  splitArgs,
  vitestWrapperConfig,
  witnessTransform,
  writeInstrumented,
  writeShadowTree,
  writeShadowTsConfig,
  detectAngularTestTarget,
  pathCondition,
  pathConditionNote,
  presentPathFailure,
} from '@projectrevivesolutions/witness';
import type { BoundaryRecord, JestResolvedConfig } from '@projectrevivesolutions/witness';
import { runProcess } from '../shared/process';
import { runtimeEnvironment } from '../shared/runtime';
import { BoundaryRecorder, BoundarySpec, RunContext } from '../types';
import { detectRunner } from '@projectrevivesolutions/witness';
import { Runner, detectAngularRunner, tsFields } from './index';

/**
 * The pointer at the run log, in the words of the control a person presses.
 * The sidebar carries a "Show the log" link, so this says "Show the log".
 */
export const SHOW_THE_LOG = 'Press "Show the log" to see the runner\'s own output.';

interface Prepared {
  workDir: string;
  hookDir: string;
  boundaryDir: string;
  env: NodeJS.ProcessEnv;
  sourceRoot: string;
  wasmDir: string;
  /** Absolute path of the file holding the watched method. */
  target: string;
}

function prepare(ctx: RunContext & { boundary: BoundarySpec }): Prepared {
  const workDir = path.join(ctx.workspaceRoot, '.untangleit');
  const hookDir = copyHooks(path.join(workDir, 'hooks'));
  // A folder per recording, so the run before the hand-off and the run at
  // "Measure again" never read each other's records.
  const boundaryDir = path.join(workDir, 'boundary', String(Date.now()));
  fs.mkdirSync(boundaryDir, { recursive: true });
  const sourceRoot = path.join(ctx.workspaceRoot, ctx.settings.sourceRoot || '');
  const wasmDir = runtimeEnvironment().wasmDir;
  const target = path.resolve(ctx.workspaceRoot, ctx.boundary.path);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [WITNESS_ENV.hooksDir]: hookDir,
    [WITNESS_ENV.wasmDir]: wasmDir,
    [WITNESS_ENV.sourceRoot]: sourceRoot,
    [WITNESS_ENV.boundaryDir]: boundaryDir,
    WITNESS_BOUNDARY_TARGET: JSON.stringify({ file: posixPath(target), name: ctx.boundary.name, ...(ctx.boundary.container ? { container: ctx.boundary.container } : {}) }),
    CI: process.env.CI ?? 'true',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
  return { workDir, hookDir, boundaryDir, env, sourceRoot, wasmDir, target };
}

class TypeScriptBoundaryRecorder implements BoundaryRecorder {
  private runnerFor(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): Runner | undefined {
    const { runner } = tsFields(ctx.settings);
    if (runner !== 'auto') {
      return runner;
    }
    const angular = detectAngularRunner(ctx.workspaceRoot);
    return angular === 'vitest' ? 'ng-vitest' : angular === 'karma' ? 'ng-karma' : detectRunner(ctx.workspaceRoot);
  }

  describe(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): string {
    const runner = this.runnerFor(ctx);
    const name = runner === 'ng-vitest' ? 'ng test with Vitest' : runner === 'ng-karma' ? 'ng test with Karma' : runner === 'playwright-ct' ? 'Playwright component tests' : runner;
    return runner ? `${name} with the Witness recorder` : 'no test runner found';
  }

  async record(ctx: RunContext & { boundary: BoundarySpec }): Promise<BoundaryRecord[]> {
    const runner = this.runnerFor(ctx);
    if (!runner) {
      throw new Error('No test runner was found. Install Vitest or Jest, or pick one on the setup screen.');
    }
    const prepared = prepare(ctx);
    const { extraArgs } = tsFields(ctx.settings);
    const testsPath = ctx.settings.testsPath;

    if (runner === 'ng-vitest' || runner === 'ng-karma') {
      await this.angular(ctx, prepared, runner, extraArgs);
      return readBoundaryRecords(prepared.boundaryDir);
    }

    if (runner === 'mocha') {
      const mochaDir = resolveModuleDir(ctx.workspaceRoot, 'mocha');
      if (!mochaDir) {
        throw new Error('mocha is not installed. Run npm install.');
      }
      const loader = pathToFileURL(path.join(prepared.hookDir, 'witness-loader.mjs')).href;
      const args = [path.join(mochaDir, 'bin', 'mocha.js'), '--require', path.join(prepared.hookDir, 'mocha.cjs'), ...splitArgs(extraArgs), ...(testsPath ? [`${testsPath}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`] : [])];
      ctx.log(`$ node ${args.join(' ')}`);
      await runProcess('node', args, { cwd: ctx.workspaceRoot, env: { ...prepared.env, NODE_OPTIONS: `${prepared.env.NODE_OPTIONS ? `${prepared.env.NODE_OPTIONS} ` : ''}--import=${loader}` }, log: ctx.log, signal: ctx.signal });
      return readBoundaryRecords(prepared.boundaryDir);
    }

    if (runner === 'playwright-ct') {
      await this.playwright(ctx, prepared, extraArgs);
      return readBoundaryRecords(prepared.boundaryDir);
    }

    const moduleDir = resolveModuleDir(ctx.workspaceRoot, runner);
    if (!moduleDir) {
      throw new Error(`${runner} is not installed. Run npm install.`);
    }

    if (runner === 'jest') {
      const bin = path.join(moduleDir, 'bin', 'jest.js');
      // Exactly one file is rewritten ahead of the run, because exactly one
      // method is watched. Everything else goes through the project's own
      // transformer, untouched, as it always did.
      const instrumentedDir = path.join(prepared.workDir, 'instrumented');
      fs.rmSync(instrumentedDir, { recursive: true, force: true });
      const instrumenter = await createInstrumenter(prepared.wasmDir);
      const rewritten = instrumenter.instrumentBoundary(posixPath(prepared.target), fs.readFileSync(prepared.target, 'utf8'), { name: ctx.boundary.name, container: ctx.boundary.container });
      if (!rewritten.ok) {
        // Nothing is written, and the run is not made: the recorder could
        // not attach, and the gate reports that rather than an empty run.
        return [{ problem: 'target-not-found', target: `${ctx.boundary.container ? `${ctx.boundary.container}.` : ''}${ctx.boundary.name}` }];
      }
      writeInstrumented(instrumentedDir, prepared.sourceRoot, prepared.target, rewritten.code);
      const shown = await runProcess('node', [bin, '--showConfig'], { cwd: ctx.workspaceRoot, signal: ctx.signal });
      let resolved: JestResolvedConfig | undefined;
      try {
        resolved = (JSON.parse(shown.stdout) as { configs?: JestResolvedConfig[] }).configs?.[0];
      } catch {
        resolved = undefined;
      }
      const transform = witnessTransform(resolved?.transform, path.join(prepared.hookDir, 'witness-jest-transform.cjs'));
      if (!transform) {
        throw new Error('UntangleIt could not read this project\'s Jest configuration, so it cannot record the run. Press "Show the log" to see what "jest --showConfig" reported.');
      }
      const args = [
        bin,
        // The test-path filter goes ahead of every flag: Jest's CLI options
        // are yargs arrays and swallow each following word.
        ...(testsPath ? [`^${escapeRegex(posixPath(path.join(ctx.workspaceRoot, testsPath)))}/`] : []),
        '--ci',
        '--transform',
        JSON.stringify(transform),
        ...['--setupFiles', path.join(prepared.hookDir, 'witness-jest-runtime.cjs')],
        ...(resolved?.setupFiles ?? []).flatMap((f) => ['--setupFiles', f]),
        ...['--setupFilesAfterEnv', path.join(prepared.hookDir, 'witness-jest.cjs')],
        ...(resolved?.setupFilesAfterEnv ?? []).flatMap((f) => ['--setupFilesAfterEnv', f]),
        ...splitArgs(extraArgs),
      ];
      ctx.log(`$ node ${args.join(' ')}`);
      await runProcess('node', args, { cwd: ctx.workspaceRoot, env: { ...prepared.env, [WITNESS_ENV.instrumentedDir]: instrumentedDir }, log: ctx.log, signal: ctx.signal });
      return readBoundaryRecords(prepared.boundaryDir);
    }

    const wrapperPath = path.join(prepared.workDir, 'vitest.config.mjs');
    fs.writeFileSync(wrapperPath, vitestWrapperConfig({ tool: 'UntangleIt', workDir: prepared.workDir, hookDir: prepared.hookDir, wasmDir: prepared.wasmDir, sourceRoot: prepared.sourceRoot, workspaceRoot: ctx.workspaceRoot, userConfig: findVitestConfig(ctx.workspaceRoot) }), 'utf8');
    const args = [path.join(moduleDir, 'vitest.mjs'), 'run', '--config', wrapperPath, ...(testsPath ? [`${testsPath}/`] : []), ...splitArgs(extraArgs)];
    ctx.log(`$ node ${args.join(' ')}`);
    await runProcess('node', args, { cwd: ctx.workspaceRoot, env: prepared.env, log: ctx.log, signal: ctx.signal });
    return readBoundaryRecords(prepared.boundaryDir);
  }

  /**
   * Angular, either runner. The builder bundles before either one is
   * involved, so the source is mirrored with the one file rewritten and the
   * builder is told to build the mirror. Everything beside the rewritten
   * file is copied through: a component names its template by relative path
   * and a stylesheet names an image the same way.
   */
  private async angular(ctx: RunContext & { boundary: BoundarySpec }, prepared: Prepared, runner: 'ng-vitest' | 'ng-karma', extraArgs: string): Promise<void> {
    const cli = resolveModuleDir(ctx.workspaceRoot, '@angular/cli');
    if (!cli) {
      throw new Error('@angular/cli is not installed. Run npm install.');
    }
    const instrumentedDir = path.join(prepared.workDir, 'instrumented');
    fs.rmSync(instrumentedDir, { recursive: true, force: true });
    const instrumenter = await createInstrumenter(prepared.wasmDir);
    const relTarget = posixPath(path.relative(ctx.workspaceRoot, prepared.target));
    writeShadowTree({
      workspaceRoot: ctx.workspaceRoot,
      sourceRoot: prepared.sourceRoot,
      instrumentedDir,
      files: [relTarget],
      rewrite: (absolute, source) => {
        const out = instrumenter.instrumentBoundary(absolute, source, { name: ctx.boundary.name, container: ctx.boundary.container });
        if (!out.ok) {
          throw new Error(`the method was not found in ${relTarget}`);
        }
        return out.code;
      },
    });
    ctx.log(`Shadow source tree at ${instrumentedDir}: one file recorded, the rest copied through.`);
    const relative = (p: string): string => posixPath(path.relative(ctx.workspaceRoot, p));
    const target = detectAngularTestTarget(ctx.workspaceRoot);
    const from = target?.projectSourceRoot ?? prepared.sourceRoot;
    const specs = ctx.settings.testsPath ? path.join(instrumentedDir, path.relative(prepared.sourceRoot, path.join(ctx.workspaceRoot, ctx.settings.testsPath))) : instrumentedDir;
    // Relative to the project source root, never absolute: the Karma
    // compatibility layer strips a leading slash from every pattern, which
    // turns an absolute pattern into one that matches nothing, and the run
    // then reports zero tests and passes.
    const include = `${posixPath(path.relative(from, specs))}/**/*.@(spec|test).@(ts|tsx)`;
    // The mirror has to be in the TypeScript program. Without a tsconfig
    // pointing at it, the builder fails the whole bundle on the first file
    // carrying Angular metadata, with "not found in TypeScript compilation",
    // and the run records nothing at all.
    const tsConfig = target?.tsConfig ? writeShadowTsConfig(prepared.workDir, path.join(ctx.workspaceRoot, target.tsConfig), prepared.sourceRoot, instrumentedDir) : undefined;
    if (!target) {
      ctx.log('angular.json does not name a project using the unit-test builder, so the mirror is addressed from the source root and the project tsconfig is left as it is.');
    }
    const args = [
      path.join(cli, 'bin', 'ng.js'),
      'test',
      '--watch=false',
      ...(runner === 'ng-vitest' ? ['--isolate'] : []),
      '--include',
      include,
      ...(tsConfig ? ['--ts-config', relative(tsConfig)] : []),
      ...(runner === 'ng-vitest' ? ['--setup-files', relative(path.join(prepared.hookDir, 'witness-vitest.mjs'))] : ['--runner-config', relative(this.karmaConfig(ctx, prepared))]),
      ...splitArgs(extraArgs),
    ];
    ctx.log(`$ node ${args.join(' ')}`);
    const note = pathConditionNote(pathCondition(ctx.workspaceRoot), runner);
    if (note) {
      ctx.log(note);
    }
    const run = await runProcess('node', args, { cwd: ctx.workspaceRoot, env: prepared.env, log: ctx.log, signal: ctx.signal });
    this.explainPath(ctx, runner, run.output, run.exitCode === 0);
  }

  /**
   * When a run fails and the project path may be why, say so.
   *
   * It never fails a run on its own and never looks at the person's source.
   * A customer who already writes quoting or path normalising into their own
   * code solved a real problem, and the message says in as many words that
   * it should stay.
   */
  private explainPath(ctx: RunContext, runner: Runner, output: string, succeeded: boolean): void {
    const shown = presentPathFailure({ workspaceRoot: ctx.workspaceRoot, runner, output, succeeded, detailsHint: SHOW_THE_LOG });
    if (!shown) {
      return;
    }
    for (const line of shown.log) {
      ctx.log(line);
    }
    // The verdict that follows will be "no evidence", which is true and, on
    // its own, reads like the person's code did something wrong. This is the
    // one place that says what actually happened, so it goes to the person
    // and not only to a log they have no reason to open.
    ctx.report?.(shown.packet);
  }

  /**
   * Playwright component tests. The component build is instrumented by the
   * Witness Vite plugin the wrapper config adds, and the page reports to the
   * boundary runtime the same plugin injects. Nothing is installed in the
   * project: the fixture goes in UntangleIt's own folder and a resolve hook
   * in every Playwright process answers each spec's import of the component
   * package with it, so a spec keeps its ordinary import.
   *
   * The standing limit applies and is not a gate defect. Playwright's own
   * loader transforms what a test imports in the worker and short-circuits
   * every other loader, so only code running in the page is reached. A
   * boundary outside that path records nothing, and the gate reports
   * insufficient evidence rather than a pass. Widening that is not 1.0.19's
   * job.
   */
  private async playwright(ctx: RunContext & { boundary: BoundarySpec }, prepared: Prepared, extraArgs: string): Promise<void> {
    const ct = detectPlaywrightCt(ctx.workspaceRoot);
    const cli = ct ? resolveModuleDir(ctx.workspaceRoot, ct.package) : undefined;
    if (!ct || !cli) {
      throw new Error('Playwright component tests are not installed. Run npm install.');
    }
    if (!ct.configFile) {
      throw new Error('No playwright-ct config file was found at the workspace root.');
    }
    const fixture = writePlaywrightFixture(prepared.workDir, ct.package);
    const wrapperPath = path.join(prepared.workDir, 'playwright-ct.config.mjs');
    fs.writeFileSync(wrapperPath, playwrightWrapperConfig({ tool: 'UntangleIt', workspaceRoot: ctx.workspaceRoot, configFile: ct.configFile }), 'utf8');
    fs.rmSync(path.join(prepared.workDir, 'playwright-cache'), { recursive: true, force: true });
    const workerHook = pathToFileURL(path.join(prepared.hookDir, 'witness-playwright-loader.mjs')).href;
    const args = [path.join(cli, 'cli.js'), 'test', '-c', wrapperPath, ...splitArgs(extraArgs)];
    ctx.log(`$ NODE_OPTIONS=--import=${workerHook} node ${args.join(' ')}`);
    ctx.log('Playwright reaches only the code that runs in the page. A boundary outside that path records nothing, and the gate reports insufficient evidence rather than a pass.');
    const note = pathConditionNote(pathCondition(ctx.workspaceRoot), 'playwright-ct');
    if (note) {
      ctx.log(note);
    }
    const run = await runProcess('node', args, {
      cwd: ctx.workspaceRoot,
      env: { ...prepared.env, [WITNESS_ENV.fixture]: fixture, [WITNESS_ENV.ctPackage]: ct.package, NODE_OPTIONS: `${prepared.env.NODE_OPTIONS ? `${prepared.env.NODE_OPTIONS} ` : ''}--import=${workerHook}` },
      log: ctx.log,
      signal: ctx.signal,
    });
    this.explainPath(ctx, 'playwright-ct', run.output, run.exitCode === 0);
    if (/Executable doesn't exist|playwright install/.test(run.output) && run.exitCode !== 0) {
      throw new Error('Playwright has no browser installed for this project. Run "npx playwright install chromium" in the project, then record again.');
    }
  }

  private karmaConfig(ctx: RunContext, prepared: Prepared): string {
    const configPath = path.join(prepared.workDir, 'karma.conf.cjs');
    const userConfig = ['karma.conf.js', 'karma.conf.cjs'].find((f) => fs.existsSync(path.join(ctx.workspaceRoot, f)));
    fs.writeFileSync(configPath, angularKarmaConfig({ tool: 'UntangleIt', workspaceRoot: ctx.workspaceRoot, hookDir: prepared.hookDir, userConfig }), 'utf8');
    return configPath;
  }
}

export function createTypeScriptBoundaryRecorder(): BoundaryRecorder {
  return new TypeScriptBoundaryRecorder();
}
