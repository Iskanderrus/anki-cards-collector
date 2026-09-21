# ACCP-018 real-Anki acceptance

This acceptance is required before ACCP-018 can be marked merge-ready.

Use a real Anki Desktop collection with AnkiConnect enabled. Do not publish private study text in the evidence report. Record only object IDs, note IDs, field names, counts, hashes, and PASS/FAIL observations.

## Preconditions

- checkout the exact ACCP-018 PR head under test;
- build/load that exact extension build;
- record the commit SHA;
- use two existing real decks/routes, preferably Hebrew and Serbian;
- use existing user-owned note types with at least Prompt/Answer-compatible fields;
- choose controlled disposable study items whose text does not need to appear in the report.

Before testing, snapshot for each selected note type:

- live deck name + deck ID;
- live model name + model ID;
- ordered field names;
- card-template JSON hash;
- CSS hash.

The acceptance must not invoke user-model mutation actions such as `modelFieldAdd`, `updateModelTemplates`, or `updateModelStyling`.

## Profile A — Hebrew

1. Open **Settings & Anki** and refresh live Anki metadata.
2. Start **New profile**.
3. Choose **Hebrew — he** from the guided language control.
4. Choose the real Hebrew destination deck from the live deck list.
5. Confirm that sampled note-type counts are presented only as evidence and that no note type is auto-selected.
6. Explicitly select the intended existing user-owned Hebrew note type.
7. Inspect at least one representative front/back preview. If another representative is available, view it too.
8. Map Collector Prompt and Answer to existing model fields. Optionally map other semantic values.
9. Confirm the outgoing payload preview marks every unmapped existing field **Untouched / omitted**.
10. Save the profile and language route.
11. Reopen the saved profile and confirm language, deck/model identity, and mapping are preserved.
12. Run **Revalidate** and require a successful live validation.
13. Make the Hebrew profile active for capture.
14. Capture one controlled item without changing the legacy global language fallback.
15. Mark it Ready and export it.
16. Record the resulting Anki note ID, deck ID, and model ID without recording the study text.
17. Verify the rendered card uses the existing note type's templates/CSS.
18. Verify only mapped fields were written.
19. If the note type has an unmapped field, put a controlled sentinel value in that field directly in Anki, then repeat Collector export and verify the sentinel remains unchanged.
20. Repeat export and verify the same Anki note ID is updated rather than a duplicate note being created.

## Profile B — Serbian

Repeat the same procedure with **Serbian — sr**, a distinct real deck/route where practical, and an existing Serbian user-owned note type.

The second export must prove that changing the active capture profile changes the captured language/routing without requiring maintenance of the legacy global Language code.

## Revalidation safety probes

For each saved mapped profile, verify without accepting any automatic rewrite:

- temporarily rename or otherwise make the saved deck unavailable, then revalidate and confirm a clear missing-deck warning;
- restore it and revalidate successfully;
- if a disposable same-name replacement can be tested safely, confirm a different deck ID is rejected rather than adopted;
- temporarily make the saved model unavailable or test against a disposable same-name replacement and confirm a different model ID is rejected;
- temporarily remove/rename a mapped field only on a disposable test note type, or use another disposable model snapshot, and confirm revalidation reports the missing/changed mapping.

Do not perform destructive changes on a production study model merely for acceptance.

## Used-profile remap safety

After at least one controlled export exists for a profile:

- reopen that mapped profile;
- confirm deck/model identity changes are blocked in place;
- make a field-mapping change and confirm the UI explains that future updates to already-bound notes would use the new mapping;
- confirm Save remains blocked until the explicit remap-consequence acknowledgement is checked;
- cancel unless the remap itself is part of the controlled test.

No existing Anki note content should be silently remapped merely by opening/editing the profile.

## Final invariants

Compare the before/after model snapshots and require:

- ordered field names unchanged;
- template hash unchanged;
- CSS hash unchanged;
- no user-owned model mutation action observed;
- both controlled exports routed to their saved deck/model IDs;
- only mapped fields changed;
- unmapped fields remained untouched;
- repeat export remained idempotent;
- both profiles revalidated successfully after restoring any temporary test condition.

## Evidence report template

```text
ACCP018_REAL_ANKI=PASS|FAIL
TEST_HEAD=
ANKI_VERSION=
ANKICONNECT_VERSION=

HE_PROFILE=PASS|FAIL
HE_DECK_ID=
HE_MODEL_ID=
HE_NOTE_ID=
HE_REPRESENTATIVE_PREVIEW=PASS|FAIL
HE_MAPPED_ONLY_WRITE=PASS|FAIL
HE_UNMAPPED_FIELD_PRESERVED=PASS|FAIL
HE_REPEAT_EXPORT_IDEMPOTENT=PASS|FAIL
HE_REVALIDATION=PASS|FAIL

SR_PROFILE=PASS|FAIL
SR_DECK_ID=
SR_MODEL_ID=
SR_NOTE_ID=
SR_REPRESENTATIVE_PREVIEW=PASS|FAIL
SR_MAPPED_ONLY_WRITE=PASS|FAIL
SR_UNMAPPED_FIELD_PRESERVED=PASS|FAIL
SR_REPEAT_EXPORT_IDEMPOTENT=PASS|FAIL
SR_REVALIDATION=PASS|FAIL

PROFILE_LANGUAGE_ROUTING=PASS|FAIL
LEGACY_GLOBAL_LANGUAGE_NOT_REQUIRED=PASS|FAIL
USED_PROFILE_IDENTITY_CHANGE_BLOCKED=PASS|FAIL
USED_PROFILE_REMAP_WARNING=PASS|FAIL

FIELD_LIST_UNCHANGED=PASS|FAIL
TEMPLATES_HASH_UNCHANGED=PASS|FAIL
CSS_HASH_UNCHANGED=PASS|FAIL
USER_MODEL_MUTATION=NONE|FOUND
PRIVATE_STUDY_TEXT_PUBLISHED=NO|YES
BLOCKING_FINDINGS=NONE|<ids>
```
