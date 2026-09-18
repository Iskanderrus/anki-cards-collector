# ADR 0001: Keep the extension local-first

**Status:** Accepted

## Context

The current workflow is single-user and single-browser: capture language, review it, and export it to a local Anki installation.

An application server would add deployment, authentication, remote data retention, and operational complexity without being required for this repository's scope.

## Decision

The extension has no application backend.

It stores its corpus in IndexedDB and settings in browser-local storage. Direct Anki export talks only to AnkiConnect on localhost.

## Consequences

Good:

- the privacy story is easy to inspect;
- the extension works offline apart from page access itself;
- there is no service to deploy or keep alive;
- failure of Anki does not threaten captured data.

Costs:

- data is tied to the browser profile unless it is exported or backed up;
- backup/restore needs to be reliable;
- remote processing is outside this repository's scope.
