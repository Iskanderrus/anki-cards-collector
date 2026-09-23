# User journey

## Primary job

Collector lets someone notice useful language while reading, save it with context, decide later whether it is worth studying, and send explicitly approved material to the correct Anki destination without breaking reading flow.

The shipped daily loop is:

```text
capture now -> review later -> export confidently -> update safely
```

## First run

On a fresh installation, Collector opens a short four-step introduction. It explains:

1. Select useful language on a page and choose **Collect**.
2. Captures are stored locally and enter **Inbox** for later review.
3. **Ready** means the user explicitly approved the study item for export.
4. Different languages can use different Anki profiles, decks, and note types.
5. Direct export requires Anki Desktop with AnkiConnect.
6. Collector remains usable for capture and review while Anki is closed.
7. Visible Duolingo/backfill collection is explicit and goes through **Staged** first.
8. Collector does not continuously watch browsing in the background.

The introduction can be skipped, does not reappear after skip/finish, and can be reopened from **Settings -> View introduction** without changing profiles, routes, corpus state, or review state.

The first-run preference is stored separately from the corpus/settings schema.

## Capture journey

The normal capture path is deliberately small:

```text
select text
  -> Collect
  -> lightweight confirmation
  -> continue reading
```

A new study item confirms that it was collected to Inbox. If the same study item already exists, the confirmation explains that another occurrence was added. Capture does not force detail/edit mode and never silently marks new material Ready.

## Inbox review

Review is an intentional activity separate from capture.

**Review Inbox** starts a sequential session over the Inbox items that existed when the session began:

```text
Inbox
  -> Review Inbox
  -> inspect context + proposed study card
  -> Edit / Ready / Archive
  -> next Inbox item
  -> Inbox reviewed
```

The session is only a presentation over existing item state:

- there is no review-session database state;
- simply viewing an item does not promote it;
- **Ready** and **Archive** keep their existing meanings;
- leaving the session does not discard edits;
- J/K or arrow-key navigation, E, R, I, A, B/Escape reuse the established keyboard behavior;
- shortcuts do not fire while focus is in an input, textarea, select, or editable element.

Ready remains the explicit approval boundary for Anki export.

## Staged material

Staged is separate from Inbox.

The visible progression is:

```text
explicit visible scan/session
  -> Staged
  -> select/accept evidence
  -> Inbox
  -> normal review
  -> Ready
  -> export
```

Importing Staged evidence never sends it to Anki and never marks it Ready. Staged refresh only reclassifies the saved staged snapshot against current corpus state.

## Export confidence

Choosing **Export Ready** opens a preview before any Anki write.

The preview is built from the same routing/profile validation used by export and shows:

- total Ready items;
- how many are exportable now;
- how many are blocked;
- profile and deck grouping for the actual resolved destinations;
- note type for each group;
- actionable reasons for blocked items.

Per-item bindings and language routes remain authoritative; the UI does not infer a second destination model.

During a non-trivial batch, Collector announces completed/total progress and, where available, the current profile and deck.

After export, item-level results distinguish:

- **success** — export/update completed;
- **recoverable warning** — Anki succeeded but the local link could not be persisted;
- **failure** — the item did not complete.

Technical error details remain expandable rather than serving as the primary recovery message.

## Anki unavailable

Anki being closed is a normal recoverable condition.

Collector keeps:

- the local corpus;
- Inbox/review;
- saved profiles and routes;
- Staged material;
- capture behavior.

Connection/export messages instruct the user to open Anki Desktop, make sure AnkiConnect is running, and Retry. A failed export does not erase corpus or profile configuration.

## Multilingual routing

Collector does not require a global destination switch before each batch. Each item resolves through the existing ACCP-013 routing contract:

```text
שלום       -> Hebrew profile  -> Hebrew RU
dolaziti   -> Serbian profile -> Serbian RU
aunque     -> Spanish profile -> Spanish RU — Uruguay
```

Deliberate per-item overrides stay pinned. Existing exported cards are not silently moved when language routing changes.

## Settings and help

Settings is organized around normal tasks before rare implementation controls:

- **Anki connection & profiles**
- **Languages & routing**
- **Privacy, backup & advanced**
- **View introduction**

Guided profile setup, live Anki inspection/revalidation, source URL retention, JSON backup/restore, TSV export, and advanced compatibility controls remain available.

## Local-first/privacy boundary

The normal product copy states only the guarantees the extension architecture supports:

- captures live in Collector local storage;
- Collector does not continuously watch browsing;
- Duolingo/backfill scanning is explicit;
- direct export talks to local AnkiConnect;
- normal use does not require a remote Collector account/service for study material.

## Non-goals

This journey does not include:

- background scraping;
- automatic page-wide collection;
- silent Ready promotion;
- silent Staged-to-Anki export;
- silent movement of existing Anki cards between decks;
- merge/split, card-policy v2, morphology assistance, or learning-value decisions owned by later tickets.
