# ADR 0002: Treat websites as adapters, not product boundaries

**Status:** Accepted

## Context

The Collector started from a language-learning use case, including material encountered on Duolingo. Building directly around one site's DOM or private APIs would make the whole project brittle and difficult to reuse.

## Decision

Manual capture from an arbitrary page is the baseline capability.

Source-specific behaviour implements a small `SourceAdapter` interface. A generic adapter is always available. The Duolingo adapter may improve context extraction from visible DOM, but it must not use private APIs, tokens, cookies, network interception, or exercise automation.

## Consequences

- a broken specialised adapter degrades to generic capture instead of breaking the product;
- testing can focus on the adapter contract;
- adding another source does not change persistence or Anki export;
- specialised “backfill” features must stay opt-in and respect the same privacy boundary.
