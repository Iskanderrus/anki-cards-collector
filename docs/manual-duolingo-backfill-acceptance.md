# Manual acceptance: Duolingo visible backfill

Run this check with a real Duolingo account after loading the extension build from the ACCP-020 branch.

## Preconditions

- use a completed lesson, review, practice, or other page where previously learned target-language material is visibly rendered;
- set Collector's language code to the target language before scanning;
- keep DevTools Network closed or available only for observation; the extension should not require any Duolingo API request;
- note the current number of normal Collector corpus items before starting.

## One-shot scan

1. Open the Duolingo lesson/review material.
2. Open the Collector side panel.
3. Click **Scan visible Duolingo**.
4. On first use, approve Chrome's Duolingo page-access prompt.
5. Confirm the side panel reports a non-negative visible candidate count.
6. Open **Preview staged evidence** and confirm the actual target-language text and nearby context are visible there.
7. Confirm visible target-language words/phrases/sentences are represented in the staged preview/count.
8. Confirm generic navigation labels such as Home/Shop/Profile/Continue are not being treated as study candidates.
9. Confirm staged context does not contain the English instruction, answer-bank words, or concatenated controls; sentence candidates should show clean target-language context.
10. Confirm the normal corpus count did not increase.
11. Confirm no Anki note was created or updated.

## Explicit session

1. Click **Start backfill session**.
2. Confirm the side panel visibly says **Backfill active**.
3. Manually advance through several review/lesson screens yourself.
4. Confirm the visible candidate count can grow as new target-language material is rendered.
5. Confirm **Live session evidence** grows with the accumulated session buffer rather than showing only the latest screen.
6. Confirm Collector never clicks, answers, submits, or advances an exercise.
7. Click **Stop & stage session**.
8. Confirm the live session preview disappears and the accumulated items are visible under staged evidence.
9. Confirm the normal corpus count still did not increase.

## Navigation and teardown

1. Start another session.
2. Navigate away from the lesson/review page or close/reload the tab.
3. Confirm the old session no longer reports as active.
4. Confirm no persistent observer appears on unrelated pages.

## Privacy / permission check

Confirm the extension manifest still has no persistent content script and no required Duolingo entry in `host_permissions`. Duolingo access should appear only in `optional_host_permissions` and should be requested by Chrome after an explicit scan/session action.

During scan/session use, verify Collector does not:

- read cookies, credentials, or tokens;
- make or intercept Duolingo private API calls;
- capture hidden application state;
- run collection before explicit activation.

Also confirm that granting the optional Duolingo page permission by itself does not start collection.

## Regression

Select a normal word or phrase on an ordinary web page and use **Collect selection**.

Confirm the existing manual capture path still creates the expected normal corpus item.

## Record

Record:

- date;
- browser version;
- Duolingo page type;
- target language;
- one-shot visible/staged counts;
- session visible/staged counts;
- any obvious false-positive UI labels;
- pass/fail for no automation, no private API use, and manual capture regression.


## Matching-pairs acceptance

On a Duolingo **Select the matching pairs** screen:

1. Run **Scan visible Duolingo**.
2. Confirm each target-language word appears only once in staged preview.
3. Confirm keyboard shortcut numbers (for example 6/7/8/9/0) are not attached to the lexical text.
4. Confirm source-language pair labels are not staged when the configured language is the target language.
5. Confirm isolated vocabulary context is the clean target word itself unless a reliable target-language sentence is visible.


## Review-regression acceptance

These cases are primarily automated, but can be spot-checked if a real Duolingo flow exposes them:

1. Start a backfill session in a lesson/review and navigate through Duolingo's SPA to Home/Profile without a full page reload. Confirm **Backfill active** ends and no Home/Profile DOM is collected.
2. If a visible target-language wrapper contains a very large aggregate block, confirm Collector does not truncate it into a lexical candidate.
3. Start a Hebrew session, collect visible evidence, change Collector's language setting before stopping, then stop the session. Confirm the accumulated evidence remains tagged `he`.
4. Confirm source-language prompt text without matching `lang` metadata is not stamped as target-language evidence when the configured language is known.
