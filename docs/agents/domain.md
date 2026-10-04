# Domain Docs

WT uses a single-context domain documentation layout: `GLOSSARY.md` at the repository root and architecture decision records in `docs/adr/`.

## Before exploring

- Read the root `GLOSSARY.md` when it exists.
- Read ADRs relevant to the area being changed.
- If a domain document does not exist, proceed silently. Do not create a glossary or domain map as part of setup. Domain-modeling workflows create documentation when terms or decisions are resolved.

## Vocabulary and decisions

Use glossary terms consistently in tickets, proposals, tests, and implementation. If a needed concept is missing, reconsider the terminology or record the gap for a later domain-modeling workflow.

Explicitly identify any proposal that contradicts an accepted ADR and explain why the decision should be reconsidered. Do not silently override it.
