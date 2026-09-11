# UntangleIt engineering notes

What was built, what was tried, what failed, and why it is shaped this way. Companion to docs/build-status.md (where things stand) and docs/toolkit/ (the toolkit's common language, the inter-tool API, and this tool's spec).

## Where it came from

UntangleIt began as a branch inside DeepTest. DeepTest's "Hardest to test" row got a "Fix this" button on 2026-09-06 with two choices, test every way through the function or break it into smaller pieces, and the second choice was a refactoring brief handed to the assistant. Michael's review: that is an early version of a different tool, and by the toolkit's own rule (one verb per tool) it belongs in its own extension. The first field run settled it: against DeepTest's `visitStatement()` (48 ways through, limit 10), the assistant reduced the count by 10 instead of down to 10. A brief is not a loop. The code was pulled out here and fixed here, not patched in DeepTest.

What moved: the refactor brief (now `src/report/brief.ts`, rewritten to state the target three ways and to carry the pieces still over the limit into later rounds), the gates (checkpoint offer, then modal), and the hand-off. What was written new: the loop with "Measure again", the before-and-after comparison, the run record, and the side panel.

What was copied, not shared: the tree-sitter structure parsers for TypeScript and Python (`src/languages/*/structure.ts`) are byte-for-byte DeepTest's, with the runtime, process, and tree-sitter helpers. The toolkit rule is no shared code between tools, so they are copies, and each tool updates its own. `src/engine/types.ts` came with them and still carries DeepTest's line-level types (depth, routes); UntangleIt uses only `FunctionComplexity`. Trimming that file means editing the parsers, which is deferred until the parsers diverge for a real reason.

## The loop is enforced, not described

The lesson from the field run is the design. UntangleIt does not ask the assistant to tell it what happened; it measures. "Measure again" runs the project's tests through the project's own runner, parses the file again, and compares with a snapshot taken when the untangling was sent. The comparison (`src/engine/tangle.ts`, `compare`) treats as pieces: the original method by name, every method that did not exist at the snapshot, and every existing method whose ways through changed. Unrelated neighbours that did not move are left out so they are neither credited nor blamed. Every piece is reported with its count; the run is done only when the sum over the limit is zero and no test fails.

Rounds: the snapshot from before round 1 is kept across rounds, so a piece created in round 1 is still a piece in round 3. The round brief lists the pieces still over. `untangleit.rounds` (default 3) bounds it; when the bound is hit the run is marked stopped and the person gets the numbers.

## What "gone" means

If the original method's name disappears and no new methods appear in its file, the comparison has nothing to report. That happens when the assistant renamed the method or moved it to another file. UntangleIt says so and asks the person to open that file and measure it there, rather than guessing. A cross-file follow would need the assistant's cooperation, which the tool does not rely on.

## Verification without tests

A project with no tests folder can still be measured, and the setup screen says plainly that without tests UntangleIt cannot verify that an untangling kept the behaviour. "Measure again" then reports the numbers with no test sentence. Generating characterization tests before an untangling is an open question in the spec.

## Sibling tools

KeepSafe is called through its public command only, from `src/keepsafe.ts`, the one file that names it. DeepTest is named in `src/deeptest.ts` only; UntangleIt never calls it, and after a successful untangling it tells the person to press "Check my code again" in DeepTest when DeepTest is installed. DeepTest's own "Break it into smaller pieces" door calls `untangleit.method` with `{ path, startLine }`; that command measures first if nothing has been measured yet, then runs the loop.

The silent command `untangleit.api.measure` returns the toolkit envelope (`protocol`, `tool`, `version`, `ok`, `result` or `error`). Errors are complete sentences a caller may show as they are.

## Words

Every sentence lives in `src/ui/words.ts`. "Ways through" is the term for cyclomatic complexity; "limit" never appears as "threshold"; every instruction names a control by its label ("Untangle it", "Measure again", "Send another round", "Stop here"). Unit tests pin the exact strings.

## Versions

Every build increments the version and the build stamps it into the panel header (`esbuild.mjs`), for the same reason DeepTest does: two builds under one number once cost an hour.

## The integration harness and the modal

The suite cannot press a modal button. The harness sets `UNTANGLEIT_TEST_HOST=1` in the extension host's environment and the gate treats that as "Yes, send it". It is read from the process environment, never from a setting.

## Known gaps

- Only the AI engine transforms; the mechanical engine (extract method, guard clauses, dispatch table from the syntax tree) is the next piece of the spec. Measuring is mechanical already.
- `analyze*Tree` returns DeepTest's full structure; only `.functions` is used. Cost is a little wasted parsing per file.
- No report panel or Markdown export yet; the run record is the report.

## 0.1.1: the judging button that vanished

First field run, on DeepTest's `visitStatement()` (38 ways through at the
time). The assistant did the work well, seventeen pieces, every one claimed
at 5 or below. Then the person pressed "Find the tangled methods again",
`visitStatement()` fell out of the tangled list because it was now at 4,
and with it went the card that carried "Measure again". The command behind
that button is hidden from the palette because it takes arguments, so
there was no way to get the verdict. The tool judged nothing.

Fix: open untanglings are their own section, "Waiting on your assistance.",
listed from the run record rather than from the tangled list, so the
button to judge the work exists for as long as the work is unjudged. The
lesson is general for the toolkit: the control that judges an AI's result
must be keyed to the record of the hand-off, never to the condition the
hand-off was meant to remove.

## 0.1.2: the name, and the header that lagged a build

The product is spelled UntangleIt, one word, like its folder and its id;
every "UntangleIt" is gone.

The panel header showed the previous build's number after installing a new
VSIX and pressing "Restart Extensions". That button restarts the extension
host only. The header is the view container's title, a static contribution
the workbench reads from the manifest when the window loads, so it keeps
the old title until "Developer: Reload Window". The footer line inside the
panel is rendered by the running extension and is always right. The
instructions now say reload the window, and the same correction applies to
DeepTest's docs.

## Measure on demand for a sibling's call (0.1.8)

`untangleit.method` looked the method up in the last workspace measure and
refused when it was missing, which is every call that arrives from
DeepTest's "Break it into smaller pieces" on a fresh editor. Now, when the
method is not in the state, the file is measured on demand with
`measureFile` and the method found by its start line; the person is only
sent to "Find the tangled methods" when no method starts on that line.
The limit and the gates are unchanged; the only difference is that the
door from DeepTest opens without a prior run here.

## Tangle drives the tool (0.1.11)

Until now UntangleIt ranked and judged by ways through (cyclomatic), the
same number DeepTest uses for its test bar, with a limit of 5. The first
field runs showed the flaw: the top of the list was three flat message
switches at 28, 28, and 23 ways through, none of them hard to follow, and
the brief would have sent an assistant to split them into a method per
case. That move changes the depth of nothing: a class of 100 disconnected
methods has 100 paths through it and a depth of 1. It is the exact
outcome the toolkit exists to prevent.

The number that answers UntangleIt's question ("can a person follow this?")
is tangle, and specifically MikeVan's Better Cognitive Complexity (MBCC):
Campbell's Cognitive Complexity with one change, applied in two places.
Where order carries meaning the reader pays per step: a boolean run whose
operands depend on each other or make calls costs one per operand, and an
if / elif / else chain whose branches test different facts costs k for the
k-th branch. A chain on one value against constants is a switch in
disguise and costs one, as Campbell charges a switch. Both changes, the
reasoning, and what still needs validating are in the paper "MikeVan's
Better Cognitive Complexity: why it exists and what it is for" (in the
toolkit docs); the counting rules with worked cases are in the shared
library's docs/measures.md.

What changed here:

- The two structure parsers are now the same files DeepTest uses
  (src/languages/python/structure.ts, src/languages/typescript/structure.ts)
  and take all three numbers per function from
  `@projectrevivesolutions/complexity` (a `file:../complexity` link, so the
  library must be built before this tree is, and packaging must use
  `--no-dependencies` for the same reason DeepTest does). The old
  cyclomatic-only `complexityOf` walkers are gone; UntangleIt no longer
  owns a counter of its own.
- `rankTangled` filters and sorts on `mbcc`; `over` is mbcc minus the
  limit. `snapshot` and `compare` carry all three numbers and judge every
  piece by mbcc; `moved` and `before` are tangle. A flat switch with 29
  ways through and a tangle of 1 is never on the list, at any limit, and
  the test says so.
- The limit is a tangle limit, default 15 (SonarSource's published default
  for cognitive complexity per method). It was 5 ways through.
- Words: "big() has a tangle of 14. Your limit is 15." Behind the switch:
  "(MBCC 14, Campbell 12, 99 ways through; 9 over)". The card's meaning
  sentence says what tangle is and that ways through is DeepTest's number
  and does not change here.
- The brief targets tangle, explains how MBCC counts in five lines, and
  has a new section, "What lowers tangle, and what does not": pull nested
  blocks up, replace nested ifs with guard clauses, name an ordered
  condition; never split a flat switch or a flat chain into a method per
  case, never extract a flat run of statements. The done list and the
  judge sentence are unchanged in shape.
- `untangleit.api.measure` returns `cyclomatic`, `campbell`, and `mbcc` per
  method (and keeps `waysThrough` as an alias of `cyclomatic` so a caller
  written against 0.1.x still reads), with `over` computed on mbcc.

Fixture arithmetic, checked against the library: `classify` in both
fixtures is 5 ways through, Campbell 5, MBCC 6 (a two-branch chain on
different facts, 1 + 2, a nested if at 2, one independent `&&` run at 1);
`describeNumber` / `describe_number` is 8 on all three. At the old limit of
5 that ranks describeNumber (3 over) then classify (1 over); at the default
15 nothing is tangled, which is right for a fixture that small.

Verification on Michael's machine still owed: `npm install` (for the
link), `npm test`, build, install, then "Find the tangled methods" on
HelloWorld; `pick_greeting()` should top the list with its tangle, and the
brief it produces should carry the "What lowers tangle" section.

## The record says which number it holds (0.1.11)

A run record's `before` was ways through under 0.1.x and is tangle from
0.1.11, and the panel's "was N" badge had no way to tell them apart: a
HelloWorld record from 2026-09-11 read "was a tangle of 15" for a method
that had 15 ways through. New records carry `measure: "mbcc"`; a record
without the field is read as ways through and worded "was 15 ways
through". The runs file stays at version 1, because the shape only grew,
which is the rule in toolkit-api.md for public records. Pinned in
test/tangle.test.ts (`wasBefore`).
