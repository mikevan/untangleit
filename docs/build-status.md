# RefactorIt: build status and run instructions

Updated 2026-09-06. Build 0.1.3. Source tree at C:\workspace\RefactorIt. Publisher `prs`, extension id `prs.refactorit`.

## What exists (v0.1.3)

- One language contract (src/languages/types.ts) and a registry; nothing above the contract names a language. TypeScript/JavaScript (Jest, Vitest) and Python (pytest) plugins: detection, measuring through tree-sitter, and running the project's own tests.
- The engine (src/engine/tangle.ts): rank tangled methods, snapshot before an untangling, compare after, pieces with their ways through.
- The loop (src/loop.ts): "Untangle it" with the KeepSafe offer and the modal confirmation, the brief to the editor chat and clipboard, "Measure again" running the suite and measuring every piece, "Send another round" or "Stop here" up to the rounds setting.
- The run record: .refactorit/runs.json, meant to be committed.
- Side panel with the verdict, the tangled methods worst first as cards, and the engineer's numbers behind one switch; setup screen pre-filled from detection with a KeepSafe section and a DeepTest section.
- The silent command `refactorit.api.measure` with the toolkit envelope, and the `prsToolkit` block in package.json.
- 13 unit tests (Vitest); one integration suite driving the real extension in an editor: measure, send, measure again against an unchanged file (reports "Not done"), and the silent command.

## Run it (PowerShell)

```powershell
cd C:\workspace\RefactorIt
npm install
npm test                                        # 13 tests; the pytest case skips if no Python
npm run build                                   # dist/extension.js and the wasm grammars
npx @vscode/vsce package --no-dependencies      # refactorit-0.1.3.vsix
```

Then, in VS Code: Extensions view (Ctrl+Shift+X), the "..." button at the top right, "Install from VSIX...", pick the file, "Install", then Ctrl+Shift+P, "Developer: Reload Window", Enter. ("Restart Extensions" is not enough: the panel header is drawn by the window, not by the extension, and only a window reload reads the new build's title.) The RefactorIt icon is in the activity bar and the panel header reads "RefactorIt 0.1.3".

## Next

1. Field test on DeepTest's own `visitStatement()` (48 ways through) with the real assistant; confirm the loop reports per piece and the rounds bound holds.
2. DeepTest 0.3.7: route "Break it into smaller pieces" to `refactorit.method` when RefactorIt is installed, and remove the refactor brief from DeepTest.
3. The mechanical engine: provable transforms from the syntax tree, measuring stays mechanical either way.
4. Java, C#, C++, then PHP or Go, on the same contract.
5. The `prs.toolkit` extension pack.
