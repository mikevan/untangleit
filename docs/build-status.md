# UntangleIt: build status and run instructions

Michael Van Geertruy, with Claude. Project Revive Solutions, LLC.

Updated 2026-09-12. Source tree at C:\workspace\UntangleIt. Publisher `prs`, extension id `prs.untangleit`.

## 2026-09-12, 1.0.8: Mocha and Playwright component tests in the test gate

- Runners mocha and playwright-ct, detected like DeepTest's; README
  Languages and Requirements say what shipped in the 1.0 slot; toolkit
  documents level with DeepTest's. One new test; 16 unit tests expected.

## 2026-09-12, 1.0.5: Karma projects run headless through ng test

- Runner ng-karma: `ng test --watch=false --browsers ChromeHeadless`,
  Karma's summary parsed. Angular test extended; 15 unit tests expected.

## 2026-09-12, 1.0.4: Angular tests run through ng test

- Runner ng-vitest for an Angular project with the unit-test builder:
  `ng test --watch=false` through the project's @angular/cli. One new
  test; 15 unit tests expected.

## 2026-09-12, 1.0.3: single-file components

- .vue and .svelte are walked and measured through the library's
  extractScript; method lines are the editor's lines. Template not parsed.
- One new test on test/fixtures/sfc; 14 unit tests expected.
- Verify on HelloWorlds\vue-vitest: "Find the tangled methods" lists
  pickGreeting() in src/components/GreetingPicker.vue first, and "Open"
  lands on line 13.

## 2026-09-12: tangle (MBCC) drives the list, the judge, and the brief (built as 0.1.11, shipped as 1.0.0)

- Ranking, `over`, `compare`, and the brief all read MBCC; the limit is a
  tangle limit, default 15. Parsers are DeepTest's, numbers from
  `@projectrevivesolutions/complexity` (`file:../complexity`; build the
  library first; package with `--no-dependencies`). Reasons and the
  fixture arithmetic in docs/engineering-notes.md, "Tangle drives the
  tool".
- Unit tests: 10 (tangle 7, structure 3), all passing against the library
  as built on 2026-09-12; the runner suite and the integration suite
  still to run on Michael's machine.
- Verify on HelloWorld: "Find the tangled methods" puts `pick_greeting()`
  first with "has a tangle of N. Your limit is 15."; "Untangle it" produces
  a brief with the section "What lowers tangle, and what does not".

## What exists (v1.0.0; the core below dates from 0.1.3 and is unchanged except where the 2026-09-12 section says)

- One language contract (src/languages/types.ts) and a registry; nothing above the contract names a language. TypeScript/JavaScript (Jest, Vitest) and Python (pytest) plugins: detection, measuring through tree-sitter, and running the project's own tests.
- The engine (src/engine/tangle.ts): rank tangled methods by tangle (MBCC), snapshot before an untangling, compare after, pieces with all three numbers, judged by tangle.
- The loop (src/loop.ts): "Untangle it" with the KeepSafe offer and the modal confirmation, the brief to the editor chat and clipboard, "Measure again" running the suite and measuring every piece, "Send another round" or "Stop here" up to the rounds setting.
- The run record: .untangleit/runs.json, meant to be committed.
- Side panel with the verdict, the tangled methods worst first as cards, and the engineer's numbers behind one switch; setup screen pre-filled from detection with a KeepSafe section and a DeepTest section.
- The silent command `untangleit.api.measure` with the toolkit envelope, and the `prsToolkit` block in package.json.
- Unit tests under Vitest (tangle 7, structure 3, runner 3); one integration suite driving the real extension in an editor: measure, send, measure again against an unchanged file (reports "Not done"), and the silent command.

## Run it (PowerShell)

```powershell
cd C:\workspace\UntangleIt
npm install                                     # links ../complexity
npm test                                        # the pytest case skips if no Python
npm run build                                   # dist/extension.js and the wasm grammars
npx @vscode/vsce package --no-dependencies      # required: the complexity link must not be walked
```

Then, in VS Code: Extensions view (Ctrl+Shift+X), the "..." button at the top right, "Install from VSIX...", pick the file, "Install", then Ctrl+Shift+P, "Developer: Reload Window", Enter. ("Restart Extensions" is not enough: the panel header is drawn by the window, not by the extension, and only a window reload reads the new build's title.) The UntangleIt icon is in the activity bar and the panel header reads "UntangleIt 1.0.0".

## Next

1. Run the runner and integration suites on Michael's machine (the 2026-09-12 engine and structure suites ran against the library; the rest did not).
2. Field test on a real nest with the real assistant; confirm the loop reports tangle per piece, refuses credit for a case-per-method split, and the rounds bound holds.
3. `untangleit.api.plan` and the mechanical engine (extract nested block, guard clauses, name the condition) per the spec.
4. Recommendation rules (LCOM4, "Test it first", extension points) per the spec, 0.3.0.
3. The mechanical engine: provable transforms from the syntax tree, measuring stays mechanical either way.
4. Java, C#, C++, then PHP or Go, on the same contract.
5. The `prs.toolkit` extension pack.
