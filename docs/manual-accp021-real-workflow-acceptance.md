# Manual acceptance: ACCP-021 staged Duolingo review -> existing Anki profile

Run this acceptance against the exact reviewed ACCP-021 branch head with a real Duolingo account, real Anki Desktop, and AnkiConnect.

This closes the original motivating workflow:

```text
visible Duolingo study material
  -> explicit staged capture
  -> dedicated Staged review
  -> selected commit to normal Inbox
  -> ordinary lexical/card review
  -> ACCP-018 language export profile
  -> existing user Anki deck + existing user note type
```

## Preconditions

- load the unpacked extension built from the exact ACCP-021 head being accepted;
- Anki Desktop is open and AnkiConnect is reachable;
- an ACCP-018 profile already exists for the target language and points to the intended **existing** Anki deck and **existing user-owned** note type;
- that profile has already passed live deck/model identity revalidation;
- use a real Duolingo completed lesson/review/practice page where target-language material is visibly rendered;
- record the current Collector corpus count;
- record the current Anki note count for the destination deck;
- record the destination note type's field list, templates, and CSS before the run.

Do not create or alter a note type merely for this acceptance.

## 1. Stage real visible Duolingo evidence

1. Open a supported Duolingo lesson/review/practice screen.
2. Open Collector.
3. Use **Scan visible Duolingo** or explicitly start and stop a backfill session.
4. Confirm the candidate is visible in **Staged** / **Backfill review**.
5. Confirm the row shows:
   - observed text;
   - target language;
   - clean target-language context when available;
   - Duolingo/source provenance;
   - a disposition.
6. Confirm the normal Collector corpus count has not changed yet.
7. Confirm the destination Anki deck has not changed yet.
8. Confirm Collector did not answer, submit, or advance the Duolingo exercise automatically.
9. Confirm no private Duolingo API, cookie/token extraction, or network interception is required.

Record one concrete staged target and its visible context.

## 2. Review and import only selected evidence

1. Open **Staged**.
2. Search/filter until the chosen real candidate is visible.
3. If extraction text/language/context is noisy, correct only that staged evidence and confirm the candidate remains staged.
4. Select the chosen candidate.
5. If it is **Needs review**, explicitly choose the intended existing lexical-unit owner before import.
6. Click **Import selected to Inbox**.
7. Confirm the result summary reports the correct domain outcome:
   - new lexical unit; or
   - occurrence added to an existing unit; or
   - already represented / no-op.
8. Confirm the chosen material is no longer pending as an uncommitted selected candidate.
9. Confirm unselected staged candidates remain staged.
10. Confirm no Anki note was created or updated by this import action.

For a newly created or evidence-mutated corpus unit, confirm its Collector status is **Inbox**, not Ready or Archived.

## 3. Normal review remains separate

1. Return to **Queue**.
2. Open the imported item in normal focused detail.
3. Confirm its canonical/observed evidence and selected context are available through the ordinary corpus workflow.
4. Confirm the item is still **Inbox**.
5. Review it using the existing normal workflow.
6. Only now explicitly mark it **Ready**.
7. Confirm the displayed Anki destination resolves through the existing ACCP-018 target-language profile.

## 4. Export through the existing user note type

Before pressing **Send ready to Anki**, capture the live destination note type again:

- field names;
- templates;
- CSS.

Then:

1. Click **Send ready to Anki**.
2. Confirm exactly one intended note is created or the correct previously bound note is updated.
3. Confirm the note is in the intended existing language deck.
4. Confirm the note uses the intended existing user-owned note type.
5. Confirm only explicitly mapped fields were written.
6. Confirm the note type's field list is unchanged.
7. Confirm templates are byte-for-byte / structurally unchanged.
8. Confirm CSS is byte-for-byte unchanged.
9. Confirm no `createModel`, `modelFieldAdd`, template rewrite, or styling rewrite occurred.
10. Record the resulting Anki note ID.

## 5. Idempotent repeat

1. Without changing the Collector item, run **Send ready to Anki** again.
2. Confirm no second note is created for the same Collector identity.
3. Confirm the same Anki note ID is retained/updated.
4. Confirm the note remains in the same deck and note type.
5. Recheck note-type fields/templates/CSS: still unchanged.

## 6. Duplicate/no-op spot check

If the same real Duolingo evidence can be staged again safely:

1. Stage the same visible evidence again.
2. Confirm it classifies as already represented where the persisted evidence identity matches, or as additional evidence when the context/source evidence is genuinely different.
3. Import an exact already-represented candidate.
4. Confirm the result reports a no-op and does not duplicate the occurrence/note.

This step is optional if the real page cannot reproduce the exact same evidence reliably; automated coverage remains authoritative for the exact identity case.

## 7. Regression spot check

- normal manual **Collect selection** still works on an ordinary web page;
- Staged review contains no direct **Send ready to Anki** action;
- unselected staged evidence remains transient and outside normal backup/corpus state;
- no accepted batch mutation can silently leave the affected lexical unit Ready/Archived: changed material re-enters Inbox.

## Record

Return a result block in this exact shape:

```text
ACCP021_REAL_WORKFLOW_ACCEPTANCE=PASS|FAIL
HEAD_SHA=<exact branch head>
WORKTREE_CLEAN=YES|NO

ANKI_CONNECTION=PASS|FAIL
ANKI_DESKTOP_VERSION=<version>
ANKICONNECT_VERSION=<version>

DUOLINGO_REAL_VISIBLE_CAPTURE=PASS|FAIL
DUOLINGO_NO_AUTOMATION=PASS|FAIL
DUOLINGO_NO_PRIVATE_API_OR_TOKEN_USE=PASS|FAIL

STAGED_REVIEW_VISIBLE=PASS|FAIL
STAGED_EDIT_IF_USED=PASS|NOT_USED|FAIL
SELECTED_ONLY_IMPORT=PASS|FAIL
UNSELECTED_REMAINS_STAGED=PASS|FAIL
IMPORT_TO_INBOX=PASS|FAIL
NO_ANKI_WRITE_DURING_STAGED_IMPORT=PASS|FAIL

NORMAL_REVIEW_SEPARATE=PASS|FAIL
EXPLICIT_READY_REQUIRED=PASS|FAIL
PROFILE_DESTINATION=<deck> / <note type>

REAL_ANKI_EXPORT=PASS|FAIL
ANKI_NOTE_ID=<id>
MAPPED_FIELDS_ONLY=PASS|FAIL
FIELD_SCHEMA_UNCHANGED=PASS|FAIL
TEMPLATES_UNCHANGED=PASS|FAIL
CSS_UNCHANGED=PASS|FAIL
USER_MODEL_MUTATION=NONE|<details>

REPEAT_EXPORT_IDEMPOTENT=PASS|FAIL
REPEAT_NOTE_ID=<id>
DUPLICATE_NOOP_SPOTCHECK=PASS|NOT_RUN|FAIL

OBSERVED_TARGET=<target text>
OBSERVED_CONTEXT=<short context>
NOTES=<anything unexpected>
```

If any line is FAIL, stop and preserve the exact observed state before remediation.
