# Maintenance roadmap

This public roadmap tracks maintenance and hardening of the current extension.

Repository-side hardening for the current release includes capture/review/export, a deterministic learning-card policy, backup/restore, privacy filtering, browser-level tests, accessibility checks, migration coverage, and validated store packaging.

## External release step

The remaining release work is operational rather than application code:

- upload the validated ZIP and listing assets to the Chrome Web Store Developer Dashboard;
- complete the Store listing and Privacy tabs;
- resolve any store pre-submission validation findings;
- submit the item for review.

See [release checklist](release.md).

## Explicit non-goals for this repository

- background scraping of browsing activity;
- private API reverse engineering;
- credential or token collection;
- automated completion of learning-platform exercises;
- making the extension depend on Duolingo-specific markup.

These constraints describe the public implementation and its security boundary.
