# Contributing

This is a small project on purpose. A contribution is most useful when it makes the existing capture → review → export path clearer or safer.

## Before opening a change

Please keep these boundaries in mind:

- generic web capture must remain a first-class path;
- source adapters must not depend on private APIs, credentials, cookies, or network interception;
- captured study data stays local;
- new browser permissions need a concrete reason;
- duplicate capture must not silently become duplicate study material.

## Local check

```bash
npm install
npm run check
```

A PR should explain the user-visible problem, the trade-off made, and how it was tested. An ADR is appropriate when the change creates a durable architectural constraint; it is not required for ordinary refactoring or UI polish.
