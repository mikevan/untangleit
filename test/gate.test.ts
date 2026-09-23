/**
 * The behaviour gate, end to end, through both language families.
 *
 * Each case builds a project, records the selected method while the
 * project's own tests run, changes the code the way an assistant would
 * change it, records again, and asks for a verdict. The recorders are the
 * real ones and the runners are real: Vitest for JavaScript and TypeScript,
 * pytest for Python. Nothing here is a fixture of a record.
 *
 * Five cases, and the third and the fifth are the ones that catch a gate
 * that only looks like it works. The third because comparing outcome kinds
 * is easy to get wrong in a way that passes everything, and the fifth
 * because a gate that secretly depends on a one-to-one mapping between the
 * original method and the pieces it became falls over exactly there.
 *
 * Why this is a suite and not a survey someone remembers to run: the
 * Angular drivers are the standing lesson. Three defects in one day, every
 * one found by Angular rather than by us, every one in the only drivers
 * with no end-to-end test.
 */
import { test } from 'vitest';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BoundaryRecord } from '@projectrevivesolutions/witness';
import { decide } from '../src/engine/behaviour';
import { locateBoundary, recordBoundary } from '../src/gate';
import { setRuntimeEnvironment } from '../src/languages/shared/runtime';
import { pythonPlugin } from '../src/languages/python';
import { typescriptPlugin } from '../src/languages/typescript';
import type { BoundarySpec, LanguagePlugin, LanguageSettings, RunContext } from '../src/languages/types';
import { presentPathFailure, buildFailureBrief } from '@projectrevivesolutions/witness';
import type { ProblemPacket } from '@projectrevivesolutions/witness';
import { SHOW_THE_LOG } from '../src/languages/typescript/boundary';

// The grammars come from the Witness checkout, as they come from the
// extension's own dist at runtime.
setRuntimeEnvironment({ wasmDir: path.resolve('node_modules', '@projectrevivesolutions', 'witness', 'dist') });

const silent = (): void => undefined;

function pythonAvailable(): string | undefined {
  for (const interpreter of ['python3', 'python']) {
    try {
      execFileSync(interpreter, ['-m', 'pytest', '--version'], { stdio: 'ignore' });
      return interpreter;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

// ------------------------------------------------ JavaScript and TypeScript

/** A Vitest project with one class, one method under the gate, and two tests. */
function tsProject(method: string, extra = ''): { root: string; settings: LanguageSettings } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'untangleit-gate-ts-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"gate-fixture","private":true,"type":"module"}\n');
  fs.writeFileSync(path.join(root, 'src', 'pricing.ts'), `${extra}export class Pricing {\n${method}}\n`);
  fs.writeFileSync(
    path.join(root, 'test', 'pricing.test.ts'),
    [
      // The gold path is exercised and only weakly asserted, which is the
      // suite this gate exists for: a discount that changes keeps this green.
      // A suite that asserted the exact number would fail instead, and the
      // gate would not be the thing that caught it.
      'import { test, expect } from "vitest";',
      'import { Pricing } from "../src/pricing";',
      'test("totals", () => {',
      '  const p = new Pricing();',
      '  expect(typeof p.total([{ price: 10, qty: 2 }], "gold")).toBe("number");',
      '  expect(p.total([{ price: 10, qty: 1 }], "none")).toBe(10);',
      '});',
      'test("refuses nothing", () => {',
      '  expect(() => new Pricing().total([], "gold")).toThrow();',
      '});',
      '',
    ].join('\n'),
  );
  return { root, settings: { testsPath: 'test', sourceRoot: 'src', fields: { runner: 'vitest', extraArgs: '' } } };
}

/** The method as it starts: two branches, one throw, one discount table. */
const ORIGINAL_TS = [
  '  total(lines: Array<{ price: number; qty: number }>, tier: string): number {',
  '    if (lines.length === 0) {',
  '      throw new RangeError("nothing to total");',
  '    }',
  '    let sum = 0;',
  '    for (const line of lines) {',
  '      sum += line.price * line.qty;',
  '    }',
  '    if (tier === "gold") {',
  '      return sum * 0.9;',
  '    }',
  '    return sum;',
  '  }',
  '',
].join('\n');

async function recordTs(root: string, settings: LanguageSettings, line = 2): Promise<BoundaryRecord[] | undefined> {
  const boundary = await locateBoundary(root, 'src/pricing.ts', line);
  assert.ok(boundary, 'the method is found on the line the person chose, with the class it belongs to');
  return recordBoundary(typescriptPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: silent });
}

/** Rewrites the file the way an assistant would, and says where the method now starts. */
function rewriteTs(root: string, method: string, extra = ''): number {
  fs.writeFileSync(path.join(root, 'src', 'pricing.ts'), `${extra}export class Pricing {\n${method}}\n`);
  const lines = fs.readFileSync(path.join(root, 'src', 'pricing.ts'), 'utf8').split('\n');
  return lines.findIndex((l) => /\btotal\(/.test(l)) + 1;
}

test('JavaScript: a correct untangling reports equivalent', async () => {
  const { root, settings } = tsProject(ORIGINAL_TS);
  const before = await recordTs(root, settings);
  // The same behaviour, restructured: an early return instead of a branch,
  // a reduce instead of a loop, and the discount pulled out as a constant.
  const line = rewriteTs(
    root,
    ['  total(lines: Array<{ price: number; qty: number }>, tier: string): number {', '    if (lines.length === 0) {', '      throw new RangeError("nothing to total");', '    }', '    const sum = lines.reduce((at, line) => at + line.price * line.qty, 0);', '    return tier === "gold" ? sum * 0.9 : sum;', '  }', ''].join('\n'),
  );
  const after = await recordTs(root, settings, line);
  assert.deepEqual(decide(before!, after!), { verdict: 'equivalent', compared: 3 });
});

test('JavaScript: a changed return value reports changed', async () => {
  const { root, settings } = tsProject(ORIGINAL_TS);
  const before = await recordTs(root, settings);
  // The discount became 0.8. The suite is not asked about it here; the
  // point is that the gate sees it even when a suite would not.
  const line = rewriteTs(root, ORIGINAL_TS.replace('sum * 0.9', 'sum * 0.8'));
  const after = await recordTs(root, settings, line);
  const verdict = decide(before!, after!);
  assert.equal(verdict.verdict, 'changed');
  assert.equal(verdict.verdict === 'changed' && verdict.differences.length, 1, 'one call ended differently, and the gate names which');
  assert.deepEqual(verdict.verdict === 'changed' && verdict.differences[0].before.value, { t: 'num', v: '18' });
  assert.deepEqual(verdict.verdict === 'changed' && verdict.differences[0].after.value, { t: 'num', v: '16' });
});

test('JavaScript: a changed thrown outcome reports changed', async () => {
  const { root, settings } = tsProject(ORIGINAL_TS);
  const before = await recordTs(root, settings);
  // It returns zero now where it used to throw. This is the case a gate
  // that compares only values passes without noticing anything.
  const line = rewriteTs(root, ORIGINAL_TS.replace('      throw new RangeError("nothing to total");', '      return 0;'));
  const after = await recordTs(root, settings, line);
  const verdict = decide(before!, after!);
  assert.equal(verdict.verdict, 'changed');
  const difference = verdict.verdict === 'changed' ? verdict.differences.find((d) => d.before.kind === 'throw') : undefined;
  assert.ok(difference, 'the throw that became a return is the difference, and the kind is what shows it');
  assert.equal(difference.after.kind, 'return');
});

test('JavaScript: a method no test exercises reports insufficient evidence', async () => {
  const { root, settings } = tsProject(`${ORIGINAL_TS}  unused(n: number): number {\n    return n + 1;\n  }\n`);
  const at = fs.readFileSync(path.join(root, 'src', 'pricing.ts'), 'utf8').split('\n').findIndex((l) => /\bunused\(/.test(l)) + 1;
  const boundary = await locateBoundary(root, 'src/pricing.ts', at);
  assert.ok(boundary);
  const before = await recordBoundary(typescriptPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: silent });
  const after = await recordBoundary(typescriptPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: silent });
  const verdict = decide(before!, after!);
  assert.deepEqual(verdict, { verdict: 'insufficient', reason: 'never-exercised' }, 'a green suite does not cover a method it never reached, and the gate says so rather than passing it');
});

test('JavaScript: one method split into helpers, including a shared one, reports equivalent', async () => {
  const { root, settings } = tsProject(ORIGINAL_TS);
  const before = await recordTs(root, settings);
  // Five pieces out of one method, and `discountFor` is shared with another
  // caller. The gate watches the boundary the tests already call and has no
  // opinion about any of the pieces, which is the simplification that makes
  // it work at all: after a good restructuring there is often no
  // correspondence left to find.
  const line = rewriteTs(
    root,
    [
      '  total(lines: Array<{ price: number; qty: number }>, tier: string): number {',
      '    this.refuseEmpty(lines);',
      '    return applyDiscount(this.subtotal(lines), tier);',
      '  }',
      '  private refuseEmpty(lines: Array<{ price: number; qty: number }>): void {',
      '    if (lines.length === 0) {',
      '      throw new RangeError("nothing to total");',
      '    }',
      '  }',
      '  private subtotal(lines: Array<{ price: number; qty: number }>): number {',
      '    return lines.reduce((at, line) => at + line.price * line.qty, 0);',
      '  }',
      '',
    ].join('\n'),
    // The shared helper, used by the method under the gate and by a second
    // caller that has nothing to do with it.
    ['export function discountFor(tier: string): number {', '  return tier === "gold" ? 0.9 : 1;', '}', 'export function applyDiscount(sum: number, tier: string): number {', '  return sum * discountFor(tier);', '}', 'export function quote(sum: number): number {', '  return applyDiscount(sum, "gold");', '}', ''].join('\n'),
  );
  const after = await recordTs(root, settings, line);
  assert.deepEqual(decide(before!, after!), { verdict: 'equivalent', compared: 3 }, 'the boundary still does what it did, whatever it is made of now');
});

// ------------------------------------------------------------------ Python

function pyProject(method: string, extra = ''): { root: string; settings: LanguageSettings } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'untangleit-gate-py-'));
  fs.mkdirSync(path.join(root, 'src', 'shop'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'shop', '__init__.py'), '');
  fs.writeFileSync(path.join(root, 'src', 'shop', 'pricing.py'), `${extra}class Pricing:\n${method}`);
  fs.writeFileSync(
    path.join(root, 'tests', 'test_pricing.py'),
    // As above: the gold path is exercised and only weakly asserted, and the
    // raise is caught by base Exception, so neither change breaks the suite.
    ['import pytest', 'from shop.pricing import Pricing', '', '', 'def test_totals():', '    p = Pricing()', '    assert isinstance(p.total([{"price": 10, "qty": 2}], "gold"), float)', '    assert p.total([{"price": 10, "qty": 1}], "none") == 10', '', '', 'def test_refuses_nothing():', '    with pytest.raises(Exception):', '        Pricing().total([], "gold")', ''].join('\n'),
  );
  // pytest imports the package from the source root, as a real project does.
  fs.writeFileSync(path.join(root, 'pytest.ini'), '[pytest]\npythonpath = src\n');
  return { root, settings: { testsPath: 'tests', sourceRoot: 'src', fields: { interpreter: pythonAvailable() ?? 'python3', pytestArgs: '' } } };
}

const ORIGINAL_PY = [
  '    def total(self, lines, tier):',
  '        if not lines:',
  '            raise ValueError("nothing to total")',
  '        sum_ = 0',
  '        for line in lines:',
  '            sum_ += line["price"] * line["qty"]',
  '        if tier == "gold":',
  '            return sum_ * 0.9',
  '        return sum_',
  '',
].join('\n');

function recordPy(root: string, settings: LanguageSettings): Promise<BoundaryRecord[] | undefined> {
  // Python is located by module and qualified name, and the recorder finds
  // the class holding the name itself, refusing if two classes hold it.
  return recordBoundary(pythonPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary: { path: 'src/shop/pricing.py', name: 'total' }, log: silent });
}

function rewritePy(root: string, method: string, extra = ''): void {
  fs.writeFileSync(path.join(root, 'src', 'shop', 'pricing.py'), `${extra}class Pricing:\n${method}`);
}

test('Python: a correct untangling reports equivalent', async () => {
  if (!pythonAvailable()) {
    return;
  }
  const { root, settings } = pyProject(ORIGINAL_PY);
  const before = await recordPy(root, settings);
  rewritePy(root, ['    def total(self, lines, tier):', '        if not lines:', '            raise ValueError("nothing to total")', '        sum_ = sum(line["price"] * line["qty"] for line in lines)', '        return sum_ * 0.9 if tier == "gold" else sum_', ''].join('\n'));
  const after = await recordPy(root, settings);
  assert.deepEqual(decide(before!, after!), { verdict: 'equivalent', compared: 3 });
});

test('Python: a changed return value reports changed', async () => {
  if (!pythonAvailable()) {
    return;
  }
  const { root, settings } = pyProject(ORIGINAL_PY);
  const before = await recordPy(root, settings);
  rewritePy(root, ORIGINAL_PY.replace('sum_ * 0.9', 'sum_ * 0.8'));
  const after = await recordPy(root, settings);
  const verdict = decide(before!, after!);
  assert.equal(verdict.verdict, 'changed');
  assert.equal(verdict.verdict === 'changed' && verdict.differences.length, 1);
});

test('Python: a changed raised outcome reports changed', async () => {
  if (!pythonAvailable()) {
    return;
  }
  const { root, settings } = pyProject(ORIGINAL_PY);
  const before = await recordPy(root, settings);
  // A different exception type, which a test asserting only "it raised"
  // would not notice and every caller catching ValueError would.
  rewritePy(root, ORIGINAL_PY.replace('raise ValueError', 'raise TypeError'));
  const after = await recordPy(root, settings);
  const verdict = decide(before!, after!);
  assert.equal(verdict.verdict, 'changed');
  const difference = verdict.verdict === 'changed' ? verdict.differences[0] : undefined;
  assert.ok(difference);
  assert.deepEqual(difference.before.value, { t: 'error', v: { name: 'ValueError', message: 'nothing to total' } });
  assert.deepEqual(difference.after.value, { t: 'error', v: { name: 'TypeError', message: 'nothing to total' } });
});

test('Python: a method no test exercises reports insufficient evidence', async () => {
  if (!pythonAvailable()) {
    return;
  }
  const { root, settings } = pyProject(`${ORIGINAL_PY}    def unused(self, n):\n        return n + 1\n`);
  const boundary = { path: 'src/shop/pricing.py', name: 'unused' };
  const before = await recordBoundary(pythonPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: silent });
  const after = await recordBoundary(pythonPlugin as LanguagePlugin, { workspaceRoot: root, settings, boundary, log: silent });
  assert.deepEqual(decide(before!, after!), { verdict: 'insufficient', reason: 'never-exercised' });
});

test('Python: one method split into helpers, including a shared one, reports equivalent', async () => {
  if (!pythonAvailable()) {
    return;
  }
  const { root, settings } = pyProject(ORIGINAL_PY);
  const before = await recordPy(root, settings);
  rewritePy(
    root,
    ['    def total(self, lines, tier):', '        self._refuse_empty(lines)', '        return apply_discount(self._subtotal(lines), tier)', '', '    def _refuse_empty(self, lines):', '        if not lines:', '            raise ValueError("nothing to total")', '', '    def _subtotal(self, lines):', '        return sum(line["price"] * line["qty"] for line in lines)', ''].join('\n'),
    ['def discount_for(tier):', '    return 0.9 if tier == "gold" else 1', '', '', 'def apply_discount(total, tier):', '    return total * discount_for(tier)', '', '', 'def quote(total):', '    return apply_discount(total, "gold")', '', '', ''].join('\n'),
  );
  const after = await recordPy(root, settings);
  assert.deepEqual(decide(before!, after!), { verdict: 'equivalent', compared: 3 }, 'the boundary still does what it did, and the gate has no opinion about the five pieces it became');
});

/**
 * The case that came out of building the two above, and the one that shows
 * the gate refusing to help itself.
 *
 * When the project's own suite asserts the value that changed, the test
 * fails at that assertion and stops, so the method is entered fewer times
 * than it was before. The gate could pair what it has and report a
 * difference it is sure of. It does not: the runs cannot be matched up, and
 * a verdict built on a guessed pairing is worth nothing. The suite already
 * told the person what broke.
 */
test('a suite that fails and stops early is insufficient evidence, not a guessed pairing', async () => {
  const { root, settings } = tsProject(ORIGINAL_TS);
  // A suite that does assert the exact number, unlike the fixture above.
  fs.writeFileSync(
    path.join(root, 'test', 'pricing.test.ts'),
    ['import { test, expect } from "vitest";', 'import { Pricing } from "../src/pricing";', 'test("totals", () => {', '  const p = new Pricing();', '  expect(p.total([{ price: 10, qty: 2 }], "gold")).toBe(18);', '  expect(p.total([{ price: 10, qty: 1 }], "none")).toBe(10);', '});', ''].join('\n'),
  );
  const before = await recordTs(root, settings);
  const line = rewriteTs(root, ORIGINAL_TS.replace('sum * 0.9', 'sum * 0.8'));
  const after = await recordTs(root, settings, line);

  assert.equal(before!.length, 2);
  assert.equal(after!.length, 1, 'the failing assertion stopped the test, so the second call never happened');
  assert.deepEqual(decide(before!, after!), { verdict: 'insufficient', reason: 'unstable-pairing' }, 'the gate never guesses a match, even when the difference in front of it looks obvious');
});

/**
 * What reaches the person when the runner could not start.
 *
 * The verdict for such a run is "no evidence", which is true and, standing
 * alone, reads like the person's code or their tests did something wrong.
 * The real reason is that the framework generated invalid JavaScript from
 * the project path, and that has to reach the person rather than only the
 * log.
 *
 * What travels is a packet, not a paragraph. The driver states the facts and
 * the guardrails; the sentences are the assistant's job, built from the
 * brief. It used to be a hand-written wall of prose, which is the thing this
 * design exists to stop.
 */
test('a driver hands the product a packet, not a paragraph, and no runner output with it', async () => {
  const reported: ProblemPacket[] = [];
  const logged: string[] = [];
  const recorder = {
    describe: () => 'a recorder that could not start',
    record: async (ctx: RunContext & { boundary: BoundarySpec }) => {
      const shown = presentPathFailure({
        workspaceRoot: "C:\\workspace\\MikeVan's AI Development Toolkit",
        runner: 'ng-karma',
        output: ['Application bundle generation failed.', '✘ [ERROR] Expected ";" but found "s"', "      1 │ import 'C:/workspace/MikeVan's AI Development Toolkit/app/polyfills.js';"].join('\n'),
        succeeded: false,
        detailsHint: SHOW_THE_LOG,
      });
      assert.ok(shown);
      for (const line of shown.log) {
        ctx.log(line);
      }
      ctx.report?.(shown.packet);
      return [];
    },
  };
  const plugin = { ...(typescriptPlugin as LanguagePlugin), createBoundaryRecorder: () => recorder };

  const records = await recordBoundary(plugin, {
    workspaceRoot: "C:\\workspace\\MikeVan's AI Development Toolkit",
    settings: { sourceRoot: 'src', testsPath: 'test' } as LanguageSettings,
    boundary: { path: 'src/pricing.ts', name: 'total' },
    log: (l) => logged.push(l),
    report: (p) => reported.push(p),
  });

  assert.deepEqual(records, [], 'the recording still reports no evidence; the verdict is untouched');
  assert.equal(reported.length, 1, 'the person is told once, not once per line');
  const packet = reported[0];

  assert.equal(packet.condition, 'path-character');
  assert.equal(packet.confidence, 'classified');
  assert.match(packet.headline, /Angular's unit-test builder with Karma could not start/);
  assert.doesNotMatch(packet.headline, /Expected ";"|polyfills|bundle generation failed/i, 'the headline carries no runner output');
  assert.deepEqual(packet.actions, ['explain'], 'moving a folder is not a code change, so no fix is offered');

  // The brief the product will hand the assistant carries the guardrails.
  const brief = buildFailureBrief(packet);
  assert.match(brief, /Do not diagnose it again from scratch/, 'the cause is established, so it is handed over rather than asked for');
  assert.match(brief, /Do not recommend or write Windows-specific path handling/);
  assert.match(brief, /Do not modify application logic, tests, or project configuration/);
  assert.ok(brief.includes("import 'C:/workspace/MikeVan's AI Development Toolkit/app/polyfills.js';"), 'with the evidence, verbatim');

  assert.ok(
    logged.some((l) => /polyfills/.test(l)),
    'and the raw diagnostics stay in the log, where someone can go and read them',
  );
});

/** The ordinary case: a driver with nothing to say says nothing. */
test('a recording with nothing to explain reports nothing to the person', async () => {
  const reported: ProblemPacket[] = [];
  const recorder = {
    describe: () => 'a recorder with nothing to say',
    record: async (ctx: RunContext & { boundary: BoundarySpec }) => {
      const shown = presentPathFailure({ workspaceRoot: 'C:\\workspace\\Toolkit', runner: 'ng-karma', output: 'Executed 4 of 4 SUCCESS\n', succeeded: true, detailsHint: SHOW_THE_LOG });
      assert.equal(shown, undefined);
      ctx.log('Executed 4 of 4 SUCCESS');
      return [];
    },
  };
  const plugin = { ...(typescriptPlugin as LanguagePlugin), createBoundaryRecorder: () => recorder };
  await recordBoundary(plugin, {
    workspaceRoot: 'C:\\workspace\\Toolkit',
    settings: { sourceRoot: 'src', testsPath: 'test' } as LanguageSettings,
    boundary: { path: 'src/pricing.ts', name: 'total' },
    log: silent,
    report: (p) => reported.push(p),
  });
  assert.deepEqual(reported, [], 'nothing interrupts a person over a run that was fine');
});
