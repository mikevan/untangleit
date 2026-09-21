# Changelog

## 1.0.13

A split that only moves the tangle around no longer passes quietly.

After "Measure again", the comparison now carries the total as well as the
pieces: what the pieces come to together in tangle, against what the method
and any piece the untangling disturbed were carrying before. The card says
both. When the total holds or rises while every piece fits, it says the tangle
moved rather than went away, in those words, and the person still decides.

This closes a hole the scorer cannot close. A boolean run that holds a call is
charged per operand, so moving it into a helper costs the caller one call
instead of its operands and the caller's number falls with the reader's work
untouched. An assistant told to get a method under a limit will find that
move. The scorer measures one method at a time and cannot see it; the loop
holds both versions and can. The header comment in src/engine/tangle.ts said
the only extraction that lowers tangle is one that removes nesting. That was
not true, and it now says what is.

## 1.0.10

The 1.x series is named Polyglot, and UntangleIt carries it. The side panel
header and the Marketplace title read `UntangleIt - Polyglot`, with the version
still appended to the header as before. Nothing else changes.

## 1.0.9

Declares `@projectrevivesolutions/witness`, the toolkit's instrumentation library, for the behaviour gate that comes next. Nothing in UntangleIt uses it yet.

## 1.0.0

The core is done. UntangleIt ranks, judges, and briefs by tangle (MBCC), with a default limit of 15; the brief says what lowers tangle and what does not, so a flat switch is never split into a method per case. Run records say which number they hold. Python and TypeScript / JavaScript. Next: Java (1.1), C# (1.2), C++ (1.3); see docs/toolkit/toolkit-roadmap.md.

