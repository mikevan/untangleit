# RefactorIt user acceptance test

Run through this as Jeff would: press what he would press, read what he would read, and write down the exact words on screen wherever they do not match. Every case ends with what you should see. If you see something else, that is a finding, and the text you saw is the bug report.

Setup once, in PowerShell:

```powershell
cd C:\workspace\RefactorIt
npm install
npm run build
npx @vscode/vsce package --no-dependencies
```

The last command prints "DONE  Packaged: C:\workspace\RefactorIt\refactorit-0.1.3.vsix". Then, in VS Code, press Ctrl+Shift+X to open the Extensions view. At the top right of that view click the "..." button (its tooltip reads "Views and More Actions..."), choose "Install from VSIX...", pick the file, and click "Install". A notification says "Completed installing RefactorIt extension from VSIX." Do not use its "Restart Extensions" button: that restarts only the part that runs the code, and the panel header comes from the part that draws the window. Instead press Ctrl+Shift+P, type "Developer: Reload Window", and press Enter. The RefactorIt icon appears in the activity bar on the left, and the panel's header reads "RefactorIt" followed by the build number. Repeat these steps after every change to the source.

The fixture project lives at `C:\workspace\RefactorIt\test\fixtures\tsproject-vitest`. It needs the repository's `npm install` to have run, since it borrows the repository's Vitest.

## A. First contact

**A1. Nothing configured.** File, Open Folder, `test\fixtures\tsproject-vitest`. Click the RefactorIt icon in the activity bar.
Expect: "This project has not been measured yet." followed by one sentence saying what RefactorIt does. One button, "Find the tangled methods". One link, "Tell me where the code is".

**A2. First press.** Press "Find the tangled methods".
Expect: the setup screen opens, not a measure. Language: TypeScript / JavaScript. Folder with the code: `src`, "1 source file found." Folder with the tests: `test`. The note says "Found vitest. RefactorIt will run it to check that an untangling kept the behaviour." Under "What counts as tangled", the limit is 5 and the rounds are 3. Under "Before the AI changes your code", either the KeepSafe checkbox (KeepSafe installed) or the recommendation with a link and the button "Show KeepSafe in the Extensions view". Under "After the AI changes your code", the DeepTest sentence or recommendation.

**A3. Save and measure.** Press "Save and find the tangled methods".
Expect, within a few seconds: a red box, "1 method is too tangled." Under it: "Your limit is 5 ways through. The worst is describeNumber() with 8. 4 methods measured in 1 file."

## B. Reading the card as Jeff

**B1. The card.** Under "Untangle these first".
Expect: `src/calc.ts line 28` (the line where describeNumber starts), a badge "8 ways through", the sentence "describeNumber() has 8 ways through. Your limit is 5.", then a grey paragraph beginning "This one method makes 7 decisions, so there are 8 different paths a program can take through it". Two buttons: "Untangle it" and "Open".

**B2. No jargon.** Scan the whole panel.
Expect: none of these words anywhere: cyclomatic, complexity, threshold, refactor. If one appears, that is a finding.

**B3. Show the numbers.** Tick "Show the engineer's numbers next to the plain words." at the bottom.
Expect: the card's sentence gains "(cyclomatic complexity 8, 3 over)". Untick it. It goes.

## C. The loop

**C1. Declined.** Press "Untangle it".
Expect, if KeepSafe is installed: the notification "Create a KeepSafe checkpoint before the AI changes your code? You can restore it if the change goes wrong." with "Create a checkpoint" and "Skip". Press "Skip".
Expect next: a dialog, "Send this to your AI assistant?", with a sentence naming describeNumber() and 5 ways through, and the buttons "Yes, send it" and "Cancel". Press "Cancel".
Expect: nothing happens. No record, nothing on the clipboard.

**C2. Sent.** Press "Untangle it" again, answer the checkpoint offer as you like, press "Yes, send it".
Expect: a message that the brief is in the editor chat and on your clipboard, ending "press "Measure again" on describeNumber()". A new section, "Waiting on your assistance.", appears above "Untangle these first" with a card for describeNumber(): "Sent to your assistant on <date> (round 1). When it says done, press "Measure again"." and the buttons "Measure again" and "Open". This section stays on the panel until the untangling is finished or stopped, even after "Find the tangled methods again" if the method has dropped below the limit. Paste the clipboard into Notepad: it begins "# RefactorIt: bring describeNumber() in src/calc.ts down to at most 5 ways through", states the target three ways including "It does not mean "reduce by 5"", quotes the method with line numbers, and ends "It will not accept the result on your behalf".

**C3. On disk.** Open `test\fixtures\tsproject-vitest\.refactorit\runs.json`.
Expect: one entry, status "sent", before 8, limit 5, your Windows user name, and a snapshot of the file's methods.

**C4. Nothing changed.** Without touching the code, press "Measure again".
Expect: a progress notification "RefactorIt is running your tests (vitest test)." Then a warning: "Not done. 1 piece: describeNumber() 8. 1 piece is still over your limit of 5. All 4 tests pass. Your call." with "Send another round" and "Stop here". Press "Stop here". The card reads "Stopped on <date> after 1 round. Not done. ...".

**C5. A real untangling.** Press "Untangle it" again and hand the brief to your assistant for real. When it says done, press "Measure again".
Expect one of three outcomes, each in plain words: "Untangled into N pieces: ... Every piece is within your limit of 5. All N tests pass." (and, if DeepTest is installed, "Press "Check my code again" in DeepTest ..."); or "Not done. ..." with the pieces and their counts and the two buttons; or "The untangling broke N tests. Behaviour changed, which the brief forbade. Restore the checkpoint, or send it back."
Record: which outcome, and whether the per-piece numbers matched what the assistant claimed.

**C6. Rounds.** On a "Not done", press "Send another round" twice more, pressing "Measure again" after each without changing anything.
Expect: after the third round, a warning ending "That was round 3 of 3, so RefactorIt stops here." and no further offer.

## D. Ways it should refuse

**D1. No code.** Open Folder on a folder with no TypeScript or Python files. Press "Find the tangled methods", save the setup.
Expect: "No code was found to measure." with "Tell me where the code is", "Try again", and "Show the log".

**D2. No folder.** Close all folders and run "RefactorIt: Find the tangled methods" from the command palette.
Expect: "RefactorIt needs an open folder to measure. Open your project folder first."

## E. Your own project

**E1.** Open a real project. Press "Find the tangled methods". Do not touch the setup unless a field is wrong.
Record: was every field right? How many tangled methods, and did the worst one match your gut? Could you say, from the card alone, what is wrong with it and what untangling would do?

**E2.** Untangle the worst one with your assistant. Press "Measure again".
Record: the outcome sentence, verbatim, and whether you believed it.

## What to send back

For each case: pass, or the exact text on screen. C5 and E2 in full. The findings that matter most are any sentence Jeff would have to ask an engineer to explain.
