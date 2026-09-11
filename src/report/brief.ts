/**
 * The untangle brief: everything an assistant needs to break one method
 * into pieces that each fit under the limit without changing what the code
 * does. Written so that a capable model can nail it and a weak one cannot
 * mistake it for something simpler. UntangleIt hands this over and judges
 * the result; it does not vouch for whoever does the work.
 *
 * This brief began life inside DeepTest (its function-level "Break it into
 * smaller pieces" choice) and moved here on 2026-09-06 when refactoring
 * became its own tool. The first field run of that brief reduced a method
 * by 10 instead of down to 10, which is why the loop measures after every
 * round and why the target is stated three ways here. From 0.1.11 the target
 * is tangle (MBCC), not ways through: the brief says what lowers tangle and
 * what does not, so the assistant is not tempted to split a flat switch
 * into a method per case, which moves breadth around and removes no depth.
 */
import { Piece } from '../engine/tangle';

export interface BriefInput {
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
  campbell: number;
  mbcc: number;
  limit: number;
  /** The method's own text, 1-based line numbers; long methods are cut with a note. */
  source: Array<{ line: number; text: string }>;
  sourceTruncated: boolean;
  testsPath: string;
  language: string;
  /** 1 for the first hand-off; later rounds carry the pieces still over the limit. */
  round: number;
  remaining?: Piece[];
}

function tangle(n: number): string {
  return `a tangle of ${n}`;
}

export function buildUntangleBrief(input: BriefInput): string {
  const { path, name, startLine, endLine, complexity, campbell, mbcc, limit, source, sourceTruncated, testsPath, language, round, remaining } = input;
  const lines: string[] = [];
  lines.push(`# UntangleIt: bring ${name}() in ${path} down to a tangle of at most ${limit}`);
  lines.push('');
  lines.push(`Language: ${language}. Tests live under: ${testsPath || '(workspace root)'}.${round > 1 ? ` This is round ${round}.` : ''}`);
  lines.push('');
  lines.push('## The target, stated three ways');
  lines.push('');
  lines.push(`- The limit is ${limit}. Every method you leave behind, including \`${name}()\` itself and every piece you split out of it, must have a tangle of ${limit} or less.`);
  lines.push(`- "${limit} or less" means the tangle ends at or below ${limit}. It does not mean "reduce by ${limit}". A method that goes from ${mbcc} to ${Math.max(mbcc - limit, limit + 1)} has not met the target.`);
  lines.push('- Tangle is cognitive complexity (Campbell, SonarSource 2018) with one change, MikeVan\'s Better Cognitive Complexity (MBCC). It is counted like this:');
  lines.push('  - One for each break in straight-line flow: `if`, a loop, `catch` / `except`, a ternary, a whole `switch` / `match` (one, however many cases).');
  lines.push('  - One MORE for each level of nesting the break sits inside. An `if` inside a loop inside an `if` costs 3. Nesting is what makes tangle, and removing nesting is what lowers it.');
  lines.push('  - A run of `and` / `or` costs one if its operands are independent, or one per operand when the order matters (a later operand relies on an earlier check, or an operand makes a call).');
  lines.push('  - In an `if` / `else if` / `else` chain whose branches test DIFFERENT facts, the k-th branch costs k: 1 + 2 + 3 + 4 for four branches. A chain that tests ONE value against constants (`kind == "a"`, `else if kind == "b"`) is a switch in disguise and costs one in total, however long.');
  lines.push('');
  lines.push('## The method');
  lines.push('');
  lines.push(`\`${name}()\`, ${path} lines ${startLine} to ${endLine}. It has ${tangle(mbcc)} (MBCC ${mbcc}; Campbell ${campbell}; ${complexity} ways through, which is its cyclomatic complexity and is not the target).`);
  lines.push('');
  lines.push('```');
  for (const c of source) {
    lines.push(`${String(c.line).padStart(4)} | ${c.text}`);
  }
  if (sourceTruncated) {
    lines.push('     | ... (cut here; read the rest of the method from the file)');
  }
  lines.push('```');
  lines.push('');
  if (remaining && remaining.length > 0) {
    lines.push('## What the last round left over the limit');
    lines.push('');
    for (const p of remaining) {
      lines.push(`- \`${p.name}()\` (line ${p.startLine}): ${tangle(p.mbcc)}, ${p.over} over the limit.`);
    }
    lines.push('');
    lines.push('Untangle these too. The rule is the same for every piece you create.');
    lines.push('');
  }
  lines.push('## The job');
  lines.push('');
  lines.push(`Break \`${name}()\` into smaller methods so that it, and every method you create from it, has a tangle of at most ${limit}. Behaviour must not change: same inputs, same outputs, same errors, same side effects, in the same order. Extract; do not redesign.`);
  lines.push('');
  lines.push('## What lowers tangle, and what does not');
  lines.push('');
  lines.push('- Pulling a NESTED block up into its own method lowers tangle twice: the block starts at nesting zero in its new home, and the parent loses a level. This is the move that works.');
  lines.push('- Replacing nested `if`s with early returns (guard clauses) lowers tangle, because it removes nesting without adding decisions.');
  lines.push('- Splitting a flat `switch`, or a flat chain on one value, into one method per case does NOT lower tangle. The switch cost one before and each piece costs one after, and the class is no easier to follow. Do not do it. Leave flat dispatch alone.');
  lines.push('- Extracting a flat, un-nested run of statements does not lower tangle either; it only moves code. Extract the nested part.');
  lines.push('- A long `and` / `or` chain where order matters is lowered by naming it: extract the condition into a method whose name says what it checks. That turns one tangled line into one call.');
  lines.push('');
  lines.push('## How to work');
  lines.push('');
  lines.push('1. Read the whole method and its callers before changing anything.');
  lines.push(`2. Find the deepest nesting first. Extract that block into a named method. After each extraction, count the tangle of the method you took it from and of the new method. Stop extracting from a method once it is at ${limit} or below; keep going on any piece that is still over.`);
  lines.push('3. Run the whole test suite. If anything fails, undo the last extraction and take a different block.');
  lines.push('4. When every piece is within the limit and the suite passes, list every method you created with its tangle, and stop.');
  lines.push('');
  lines.push('## Done means');
  lines.push('');
  lines.push(`- \`${name}()\` and every method produced from it has a tangle of at most ${limit}. Not one of them is over.`);
  lines.push('- The existing tests pass without being edited. They are the contract for the behaviour. If a test must change for the split to work, stop and explain why before changing it.');
  lines.push('- No new features, no removed behaviour, no changed error messages, no reordered side effects, no changed public signatures.');
  lines.push('- Names for the new methods say what they do; a reader who has never seen the code should follow the main method from top to bottom.');
  lines.push('- Every test passes. Run the whole suite yourself before you report done.');
  lines.push('- Your report ends with a list: each method you created or changed, and its tangle.');
  lines.push('');
  lines.push('UntangleIt will run the suite and measure every piece again with its own counter. It will not accept the result on your behalf; if any piece is still over the limit, the person decides whether to send another round.');
  return lines.join('\n');
}
