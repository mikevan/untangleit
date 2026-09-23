/**
 * The Python half of the behaviour gate's recorder.
 *
 * Almost nothing happens here, and that is the point. Witness's pytest
 * plugin wraps the target at run time by module and qualified name, so
 * Python needs no shadow tree, no loader, and no rewritten file. The whole
 * job is to copy the plugin into UntangleIt's folder, work out the module
 * name, and run the project's own pytest with two more options than it
 * would otherwise have.
 *
 * The run is the project's own: the same interpreter, the same tests
 * folder, the same extra arguments the person set. Nothing is installed
 * into the project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ENV as WITNESS_ENV, copyHooks, readBoundaryRecords } from '@projectrevivesolutions/witness';
import type { BoundaryRecord } from '@projectrevivesolutions/witness';
import { runProcess } from '../shared/process';
import { BoundaryRecorder, BoundarySpec, RunContext } from '../types';
import { pythonFields } from './index';

/**
 * The importable module name for a source file: its path below the source
 * root, with separators turned into dots.
 *
 * A project whose layout does not make that importable gets a module the
 * plugin cannot import, and the plugin says `target-not-found` rather than
 * guessing at another spelling. That is the correct answer: the gate stops
 * any claim of verification instead of quietly comparing nothing.
 */
export function moduleNameFor(relativePath: string, sourceRoot: string): string {
  const posix = relativePath.split(path.sep).join('/');
  const root = sourceRoot ? `${sourceRoot.replace(/\/+$/, '')}/` : '';
  const below = root && posix.startsWith(root) ? posix.slice(root.length) : posix;
  return below
    .replace(/\.py$/i, '')
    .replace(/\/__init__$/, '')
    .split('/')
    .filter(Boolean)
    .join('.');
}

function splitArgs(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

class PythonBoundaryRecorder implements BoundaryRecorder {
  describe(ctx: Pick<RunContext, 'workspaceRoot' | 'settings'>): string {
    const { interpreter } = pythonFields(ctx.settings, ctx.workspaceRoot);
    return `${interpreter} -m pytest with the Witness recorder`;
  }

  async record(ctx: RunContext & { boundary: BoundarySpec }): Promise<BoundaryRecord[]> {
    const { interpreter, pytestArgs } = pythonFields(ctx.settings, ctx.workspaceRoot);
    const workDir = path.join(ctx.workspaceRoot, '.untangleit');
    const hookDir = copyHooks(path.join(workDir, 'hooks'));
    const boundaryDir = path.join(workDir, 'boundary', String(Date.now()));
    fs.mkdirSync(boundaryDir, { recursive: true });

    const target = {
      module: moduleNameFor(ctx.boundary.path, ctx.settings.sourceRoot),
      name: ctx.boundary.name,
      ...(ctx.boundary.container ? { container: ctx.boundary.container } : {}),
    };
    const testsPath = ctx.settings.testsPath;
    const args = ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'witness_boundary', ...splitArgs(pytestArgs), ...(testsPath ? [testsPath] : [])];
    // The plugin is found on PYTHONPATH rather than installed, and the
    // workspace goes on it too so the target module imports the way the
    // project's own tests import it.
    const pythonPath = [ctx.workspaceRoot, hookDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    ctx.log(`$ ${interpreter} ${args.join(' ')}`);
    await runProcess(interpreter, args, {
      cwd: ctx.workspaceRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
        // No bytecode. The two recorded runs happen a few seconds apart on a
        // file the assistant has just edited, and CPython decides a cached
        // .pyc is current from the source's size and its modification time
        // to the second. An edit of the same length inside the same second
        // is therefore invisible: the second run imports the first run's
        // bytecode and reports that nothing changed. That is the one answer
        // this gate must never give, and it cost an afternoon to see.
        PYTHONDONTWRITEBYTECODE: '1',
        [WITNESS_ENV.boundaryDir]: boundaryDir,
        WITNESS_BOUNDARY_TARGET: JSON.stringify(target),
        NO_COLOR: '1',
      },
      log: ctx.log,
      signal: ctx.signal,
    });
    return readBoundaryRecords(boundaryDir);
  }
}

export function createPythonBoundaryRecorder(): BoundaryRecorder {
  return new PythonBoundaryRecorder();
}
