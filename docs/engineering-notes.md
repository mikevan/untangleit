# RefactorIt engineering notes

What was built, what was tried, what failed, and why it is shaped this way. Companion to docs/build-status.md (where things stand) and docs/toolkit/ (the toolkit's common language, the inter-tool API, and this tool's spec).

## Where it came from

RefactorIt began as a branch inside DeepTest. DeepTest's "Hardest to test" row got a "Fix this" button on 2026-09-06 with two choices, test every way through the function or break it into smaller pieces, and the second choice was a refactoring brief handed to the assistant. Michael's review: that is an early version of a different tool, and by the toolkit's own rule (one verb per tool) it belongs in its own extension. The first field run settled it: against DeepTest's `visitStatement()` (48 ways through, limit 10), the assistant reduced the count by 10 instead of down to 10. A brief is not a loop. The code was pulled out here and fixed here, not patched in DeepTest.

What moved: the refactor brief (now `src/report/brief.ts`, rewritten to state the target three ways and to carry the pieces still over the limit into later rounds), the gates (checkpoint offer, then modal), and the hand-off. What was written new: the loop with "Measure again", the before-and-after comparison, the run record, and the side panel.

What was copied, not shared: the tree-sitter structure parsers for TypeScript and Python (`src/languages/*/structure.ts`) are byte-for-byte DeepTest's, with the runtime, process, and tree-sitter helpers. The toolkit rule is no shared code between tools, so they are copies, and each tool updates its own. `src/engine/types.ts` came with them and still carries DeepTest's line-level types (depth, routes); RefactorIt uses only `FunctionComplexity`. Trimming that file means editing the parsers, which is deferred until the parsers diverge for a real reason.

## The loop is enforced, not described

The lesson from the field run is the design. RefactorIt does not ask the assistant to tell it what happened; it measures. "Measure again" runs the project's tests through the project's own runner, parses the file again, and compares with a snapshot taken when the untangling was sent. The comparison (`src/engine/tangle.ts`, `compare`) treats as pieces: the original method by name, every method that did not exist at the snapshot, and every existing method whose ways through changed. Unrelated neighbours that did not move are left out so they are neither credited nor blamed. Every piece is reported with its count; the run is done only when the sum over the limit is zero and no test fails.

Rounds: the snapshot from before round 1 is kept across rounds, so a piece created in round 1 is still a piece in round 3. The round brief lists the pieces still over. `refactorit.rounds` (default 3) bounds it; when the bound is hit the run is marked stopped and the person gets the numbers.

## What "gone" means

If the original method's name disappears and no new methods appear in its file, the comparison has nothing to report. That happens when the assistant renamed the method or moved it to another file. RefactorIt says so and asks the person to open that file and measure it there, rather than guessing. A cross-file follow would need the assistant's cooperation, which the tool does not rely on.

## Verification without tests

A project with no tests folder can still be measured, and the setup screen says plainly that without tests RefactorIt cannot verify that an untangling kept the behaviour. "Measure again" then reports the numbers with no test sentence. Generating characterization tests before an untangling is an open question in the spec.

## Sibling tools

KeepSafe is called through its public command only, from `src/keepsafe.ts`, the one file that names it. DeepTest is named in `src/deeptest.ts` only; RefactorIt never calls it, and after a successful untangling it tells the person to press "Check my code again" in DeepTest when DeepTest is installed. DeepTest's own "Break it into smaller pieces" door calls `refactorit.method` with `{ path, startLine }`; that command measures first if nothing has been measured yet, then runs the loop.

The silent command `refactorit.api.measure` returns the toolkit envelope (`protocol`, `tool`, `version`, `ok`, `result` or `error`). Errors are complete sentences a caller may show as they are.

## Words

Every sentence lives in `src/ui/words.ts`. "Ways through" is the term for cyclomatic complexity; "limit" never appears as "threshold"; every instruction names a control by its label ("Untangle it", "Measure again", "Send another round", "Stop here"). Unit tests pin the exact strings.

## Versions

Every build increments the version and the build stamps it into the panel header (`esbuild.mjs`), for the same reason DeepTest does: two builds under one number once cost an hour.

## The integration harness and the modal

The suite cannot press a modal button. The harness sets `REFACTORIT_TEST_HOST=1` in the extension host's environment and the gate treats that as "Yes, send it". It is read from the process environment, never from a setting.

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

The product is spelled RefactorIt, one word, like its folder and its id;
every "Refactor It" is gone.

The panel header showed the previous build's number after installing a new
VSIX and pressing "Restart Extensions". That button restarts the extension
host only. The header is the view container's title, a static contribution
the workbench reads from the manifest when the window loads, so it keeps
the old title until "Developer: Reload Window". The footer line inside the
panel is rendered by the running extension and is always right. The
instructions now say reload the window, and the same correction applies to
DeepTest's docs.
