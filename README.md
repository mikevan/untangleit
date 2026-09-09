# RefactorIt

Untangles one method at a time.

RefactorIt counts the ways through every method in your project, shows you the ones that are too tangled to trust, and hands your AI assistant a strict brief to break each one into smaller pieces without changing what it does. Then it runs your tests and measures every piece. You decide at every step. It never edits code itself, never restores anything, and never accepts the assistant's result on your behalf.

Part of MikeVan's AI Development Toolkit, beside [KeepSafe](https://marketplace.visualstudio.com/items?itemName=KeepSafe.keepsafe) (an undo button for everything an AI changes) and [DeepTest](https://github.com/mikevan/deeptest) (does every line have the tests it needs). Each tool does one thing and talks to the others only through their published commands.

## Who it is for

Jeff: an accountant with a CPA who has never written code beyond Excel macros and is vibe-coding his own accounting tool. Every sentence on screen is written for him first. The engineer's numbers sit behind one switch.

## What "tangled" means

A method with 48 ways through it is a spreadsheet formula with 48 nested IFs. Nobody can check it by reading it, and any change can break a path nobody thought to test. RefactorIt counts ways through as one plus one for every decision in the method (each `if`, `else if`, loop, `case`, error handler, ternary, and each half of an `and` or `or`), which engineers call cyclomatic complexity. Your limit defaults to 5. Above it, the method is tangled; every piece produced by an untangling has to fit under it too.

## How it works

1. Press "Find the tangled methods". The side panel lists them, worst first, each with a plain sentence saying what the number means.
2. Press "Untangle it" on one. If KeepSafe is installed, RefactorIt offers to create a checkpoint first; that is the undo. Then one dialog says what is about to happen. Nothing is sent before "Yes, send it".
3. The brief goes to the editor's chat and to your clipboard. It states the target three ways (including "5 or less does not mean reduce by 5", because an assistant once did exactly that), quotes the method, and holds the assistant to rules a contractor would recognise: behaviour unchanged, existing tests untouched, every piece within the limit, run the whole suite before saying done.
4. When the assistant says done, press "Measure again". RefactorIt runs your tests through your own runner and measures every piece. It says one of: untangled into N pieces, every one within your limit; not done, these pieces are still over; or the untangling broke tests.
5. If it is not done, you choose "Send another round" or "Stop here", up to the number of rounds you set (default 3). Then it stops and hands the result back to you.

Every untangling is recorded in `.refactorit/runs.json` in plain JSON, meant to be committed with the code: what was sent, when, by whose decision, and what came back.

## Languages

TypeScript and JavaScript (Jest or Vitest), and Python (pytest), through one language contract so both get the same screens. Java, C#, C++, and then PHP or Go follow the same contract. RefactorIt uses the project's own runtime and test runner; it ships neither.

## Setup

Press "Find the tangled methods" once and the setup screen opens, filled in from what RefactorIt found: language, the folder with the code, the folder with the tests, the runner. If it looks right, press "Save and find the tangled methods". Everything on it is also an ordinary setting under `refactorit.*`.

## Developing

```
npm install
npm test            # engine, parsers, runners, brief, words (Vitest)
npm run build       # bundle to dist/, copy wasm grammars
npm run test:vscode # runs the real extension in an editor against the fixture
npx @vscode/vsce package --no-dependencies
```

Then in the Extensions view choose "Install from VSIX..." from the "..." menu, pick the file, then press Ctrl+Shift+P, "Developer: Reload Window", Enter. The panel header carries the build number; it updates only on a window reload, not on "Restart Extensions".

Design and contracts: `docs/toolkit/`. Engineering reasons: `docs/engineering-notes.md`. Acceptance script: `docs/uat.md`.

## License

RefactorIt is free software under the GNU General Public License, version 3.0 only. See the LICENSE file.
