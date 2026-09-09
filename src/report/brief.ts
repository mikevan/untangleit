/**
 * The untangle brief: everything an assistant needs to break one method
 * into pieces that each fit under the limit without changing what the code
 * does. Written so that a capable model can nail it and a weak one cannot
 * mistake it for something simpler. RefactorIt hands this over and judges
 * the result; it does not vouch for whoever does the work.
 *
 * This brief began life inside DeepTest (its function-level "Break it into
 * smaller pieces" choice) and moved here on 2026-09-06 when refactoring
 * became its own tool. The first field run of that brief reduced a method
 * by 10 ways through instead of down to 10, which is why the loop measures
 * after every round and why the target is stated three ways here.
 */
import { Piece } from '../engine/tangle';

export interface BriefInput {
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
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

function ways(n: number): string {
  return `${n} way${n === 1 ? '' : 's'} through`;
}

export function buildUntangleBrief(input: BriefInput): string {
  const { path, name, startLine, endLine, complexity, limit, source, sourceTruncated, testsPath, language, round, remaining } = input;
  const lines: string[] = [];
  lines.push(`# RefactorIt: bring ${name}() in ${path} down to at most ${limit} ways through`);
  lines.push('');
  lines.push(`Language: ${language}. Tests live under: ${testsPath || '(workspace root)'}.${round > 1 ? ` This is round ${round}.` : ''}`);
  lines.push('');
  lines.push('## The target, stated three ways');
  lines.push('');
  lines.push(`- The limit is ${limit}. Every method you leave behind, including \`${name}()\` itself and every piece you split out of it, must have cyclomatic complexity of ${limit} or less.`);
  lines.push(`- "${limit} or less" means the count of ways through ends at or below ${limit}. It does not mean "reduce by ${limit}". A method that goes from ${complexity} to ${Math.max(complexity - limit, limit + 1)} has not met the target.`);
  lines.push(`- Ways through is 1 plus one for each decision inside the method: each \`if\`, \`else if\`, loop, \`case\`, error handler, ternary, and each half of an \`and\` or \`or\`.`);
  lines.push('');
  lines.push('## The method');
  lines.push('');
  lines.push(`\`${name}()\`, ${path} lines ${startLine} to ${endLine}. It has ${ways(complexity)} (cyclomatic complexity ${complexity}).`);
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
      lines.push(`- \`${p.name}()\` (line ${p.startLine}): ${ways(p.complexity)}, ${p.over} over the limit.`);
    }
    lines.push('');
    lines.push('Untangle these too. The rule is the same for every piece you create.');
    lines.push('');
  }
  lines.push('## The job');
  lines.push('');
  lines.push(`Break \`${name}()\` into smaller methods so that it, and every method you create from it, has at most ${limit} ways through. Behaviour must not change: same inputs, same outputs, same errors, same side effects, in the same order. Extract; do not redesign.`);
  lines.push('');
  lines.push('## How to work');
  lines.push('');
  lines.push('1. Read the whole method and its callers before changing anything.');
  lines.push(`2. Extract one coherent block at a time into a named method. After each extraction, count the ways through of the method you took it from and of the new method. Stop extracting from a method once it is at ${limit} or below; keep going on any piece that is still over.`);
  lines.push('3. Run the whole test suite. If anything fails, undo the last extraction and take a different block.');
  lines.push('4. When every piece is within the limit and the suite passes, list every method you created with its ways through, and stop.');
  lines.push('');
  lines.push('## Done means');
  lines.push('');
  lines.push(`- \`${name}()\` and every method produced from it has at most ${limit} ways through. Not one of them is over.`);
  lines.push('- The existing tests pass without being edited. They are the contract for the behaviour. If a test must change for the split to work, stop and explain why before changing it.');
  lines.push('- No new features, no removed behaviour, no changed error messages, no reordered side effects, no changed public signatures.');
  lines.push('- Names for the new methods say what they do; a reader who has never seen the code should follow the main method from top to bottom.');
  lines.push('- Every test passes. Run the whole suite yourself before you report done.');
  lines.push('- Your report ends with a list: each method you created or changed, and its ways through.');
  lines.push('');
  lines.push('RefactorIt will run the suite and measure every piece again. It will not accept the result on your behalf; if any piece is still over the limit, the person decides whether to send another round.');
  return lines.join('\n');
}
