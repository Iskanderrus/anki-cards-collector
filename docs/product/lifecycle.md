# Anki Cards Collector — Product Commercialization Lifecycle adapter

**Status:** Open-source/free canary  
**Date:** 2026-09-21  
**Canonical lifecycle:** proposed Agent Workflows PCL v0.1 (PR #237)  
**Local scheduling authority:** implementation-order.md  
**Product mode:** open_source_free

## 1. Product thesis

The product already has a strong, concrete job:

> Notice useful language while reading, capture it with context, review it later, and send approved material to the correct Anki destination without breaking reading flow.

The normal loop is already explicit:

capture now → review later → export confidently → update safely.

This is the strongest evidence that PCL can work without a subscription or revenue assumption.

## 2. Target user / ICP

Current primary candidate:
- language learners who already use Anki or intend to use Anki seriously;
- learners who encounter useful language on arbitrary web pages and want to preserve context;
- multilingual learners who need safe routing to different Anki destinations.

Secondary candidate:
- Duolingo users who want to recover only visible learning material into a reviewable local workflow.

The current repository demonstrates the workflow primarily through the operator’s own real use and technical/manual acceptance. Broader segment evidence is still limited.

## 2A. Evidence-before-build / validation mode

- Problem economics: **NOT_APPLICABLE** for the current free/open-source mode.
- Current validation mode: `open_source_pilot` + observed real-user workflow.
- External evidence sources: Chrome Web Store behavior/reviews where available, GitHub issues,
  Anki/language-learning communities, opt-in pilot sessions and support questions.
- Build discipline: new morphology/AI/card-policy complexity should not be treated as validated
  merely because it is implementable; onboarding/export friction and repeat-use evidence come first.
- Monetization remains dormant unless a separate product decision changes the mode.

## 3. SLC

### Simple

Keep the public release narrow:
- explicit user-triggered capture;
- local inbox/review;
- safe card proposal;
- Anki export or portable fallback;
- privacy-preserving source handling.

Do not make these launch requirements:
- background scraping;
- private learning-platform APIs;
- accounts/cloud sync;
- server backend;
- automatic page-wide collection;
- silent AI-generated semantics;
- monetization.

### Lovable

Candidate reasons users may prefer/repeat the workflow:
- capture does not interrupt reading;
- context and observed forms survive;
- repeated encounters do not create uncontrolled duplicates;
- user keeps approval authority before cards become study material;
- existing Anki decks/note types can be reused;
- local-first design avoids a new account/server;
- multilingual routing reduces manual deck switching.

### Complete

A user can explicitly capture a useful expression from the web, review/correct it, approve it, and safely create or update the intended Anki note without silently mutating the user’s existing Anki model or losing context.

External prerequisite:
- direct export requires Anki Desktop + AnkiConnect; TSV remains a fallback.

## 4. First useful outcome / activation

### First useful outcome

One captured expression reaches the intended study destination with the expected content and context.

### Primary activation event

First successful end-to-end:
capture → review → Ready → export/create-or-update in the intended Anki destination.

### Fallback activation

For a user without live AnkiConnect:
capture → review → Ready → successful portable TSV export.

Do not count extension installation or first capture alone as full activation.

### Repeat / retention event

A second distinct capture/review/export session on a later day.

A stronger retained-value signal is repeated use across multiple reading sessions without setup rework.

## 5. Readiness gates

| Gate | Status | Current evidence | Main blocker |
|---|---|---|---|
| Product | PARTIAL | working public release; strong user journey; real Anki acceptance on several integration slices | guided setup/onboarding and existing-note-type flow are still being completed |
| Production | PARTIAL | store ZIP validation, CI packaging, browser E2E/accessibility, release checklist | first Chrome Web Store publication/dashboard validation still external/manual |
| Measurement | BLOCKED/PARTIAL | product events can be observed manually; no need for invasive analytics | no canonical privacy-preserving activation/repeat evidence collection plan yet |
| Commercialization | NOT_APPLICABLE | current public product is free/open-source | only becomes applicable if monetization is deliberately introduced |

## 6. Measurement without violating local-first design

PCL does not require a remote analytics SDK.

For the first bounded release/pilot, useful evidence can come from:
- Chrome Web Store install/uninstall/review data where available;
- GitHub issues/discussions;
- voluntary user interviews;
- opt-in pilot sessions;
- user-reported local counters/screenshots;
- support questions;
- bounded, explicitly consented telemetry only if later justified.

Useful funnel concepts:

Acquisition:
- source: GitHub, Chrome Web Store search, Reddit/community, Anki/language-learning community, creator/demo content.

Activation:
- Anki detected;
- export profile configured;
- first capture;
- first Ready item;
- first successful Anki export/update.

Repeat:
- second session on a later day;
- second successful export batch;
- use across more than one source/page;
- multilingual routing used where relevant.

Friction:
- Anki not detected;
- profile mapping blocked;
- note type mismatch;
- user abandons before Ready;
- export failure;
- unclear canonicalization/card proposal;
- setup/help request.

Do not collect raw study material, page content or URLs remotely merely to measure growth.

## 7. Distribution / research distinction

Likely high-research sources:
- Anki forums/communities;
- language-learning communities;
- Reddit;
- extension reviews;
- GitHub issues;
- competitor extension reviews/support;
- Duolingo learner discussions where policy/access allows.

Likely distribution candidates:
- Chrome Web Store search/listing;
- GitHub README/releases;
- Anki/language-learning community posts where self-promotion is permitted;
- short demo videos;
- focused SEO/documentation around web-to-Anki capture and multilingual routing.

A community can be useful for research even when promotion is inappropriate.

## 8. First bounded evidence experiment

### Hypothesis

A meaningful subset of Anki-using language learners experiences enough friction between “I saw something useful” and “it became a good Anki card” that a local capture→review→export workflow becomes repeat behavior.

### Audience

Users who already use Anki for language study and encounter target-language material in the browser.

### Primary evidence

- can they complete first export without developer help?
- what blocks setup?
- do they use the extension again on another day?
- do they value review/context/deduplication, or mainly want one-click card creation?
- do multilingual users value routing enough to notice it?

### Spend

No meaningful paid acquisition is needed for the first evidence window.

### Decision

KEEP | ADAPT | HOLD | STOP.

SCALE means broader distribution effort, not monetization.

## 9. Stop / adapt signals

ADAPT if:
- users want a simpler one-click capture path but still value review later;
- existing Anki model mapping is the dominant friction;
- onboarding/configuration is too technical;
- direct Anki dependency limits adoption and another export path deserves priority;
- mobile/non-Chromium demand dominates actual use.

STOP broad commercialization/distribution investment if:
- target users already have sufficiently good workflows and repeat use remains weak;
- setup/support burden overwhelms the value of the local-first workflow;
- the key differentiated behaviors (context, review, safe update, routing) are not valued in practice.

Do not stop maintenance/security work merely because distribution evidence is weak.

## 10. Immediate PCL conclusions

1. The current free/open-source mode fits PCL without a revenue gate.
2. The product already has a stronger SLC than many commercial projects.
3. The missing layer is mostly measurement/distribution evidence, not product-definition prose.
4. First Chrome Web Store publication is a production/distribution milestone, not proof of retained value.
5. Guided export-profile setup and onboarding matter directly because they sit between acquisition and full activation.
6. Store/listing/privacy work should remain truthful to the exact implemented release; no growth claim is needed.

## 11. Authority links

- Product journey: docs/product/user-journey.md
- Engineering order: implementation-order.md
- Release/store readiness: docs/release.md
- Store listing: docs/store-listing.md
- Privacy: docs/privacy.md
- Maintenance/product roadmap: docs/roadmap.md
