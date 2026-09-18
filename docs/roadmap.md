# Maintenance roadmap

This public roadmap tracks maintenance and hardening of the current extension.

- restore a JSON backup, not only create one;
- sanitise source URLs by default;
- add browser-level integration tests for capture and side-panel messaging;
- improve keyboard-first review;
- run an accessibility audit;
- improve export progress and per-item error reporting;
- add extension icons, screenshots, release packaging, and a signed browser-store build;
- add migration tests as the IndexedDB schema evolves.

## Explicit non-goals for this repository

- background scraping of browsing activity;
- private API reverse engineering;
- credential or token collection;
- automated completion of learning-platform exercises;
- making the extension depend on Duolingo-specific markup.

These constraints describe the public implementation and its security boundary.
