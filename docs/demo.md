# Demo script

This is the path I use when showing the project to another engineer.

## 1. Start with an ordinary page

Open any article or documentation page containing a foreign-language expression. Select a phrase and collect it from the side panel.

Point out that no source-specific integration was required.

## 2. Collect the same phrase twice

Find the same expression in another sentence and collect it again.

The list still contains one lexical unit, but the occurrence count increases. This is the quickest way to explain why the storage model is not just “one selected string = one card”.

## 3. Review before export

Mark only one or two items ready. Leave the rest in the inbox or archive one.

This is an intentional friction point: capture should be cheap; adding study workload should not be automatic.

## 4. Export to Anki

With Anki + AnkiConnect running, send ready items.

Export the same item again. The note is updated rather than duplicated because the local lexical unit has a stable Collector ID.

## 5. Pull the plug

Close Anki and try another export. The corpus remains local and usable; download TSV instead.

That failure path is part of the design, not an afterthought.

## Questions the demo should invite

- Why IndexedDB instead of a backend?
- What happens when a source page changes?
- Why separate lexical units from occurrences?
- Where is the idempotency boundary for Anki?
- What would force the introduction of a server?
- Which permissions can be removed or narrowed further before store release?

Those are more interesting engineering conversations than the number of screens in the extension.
