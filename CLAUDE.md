@AGENTS.md

# Terminology — phrases to avoid

Unclear or overloaded terms. Don't use them in code, comments, docs, or replies; use the
replacement.

| Avoid | Say instead |
| --- | --- |
| bake-off | **model comparison** — running several models over the same documents to see whether the extraction prompt holds (implementation plan §7, deferred). **Extraction scoring** — checking one model's output against the hand-seeded ground truth. |

Add to this table when a term causes confusion.

# Feature flags

Flags live in `src/lib/flags.ts`, are server-only, and are driven by environment
variables declared in the `src/lib/env.ts` schema. Gate on them in a **server**
component so the markup for a disabled flag is never sent to the browser — do not
hide flagged UI with CSS or a client-side check.

| Flag | Env var | Default | What it gates |
| --- | --- | --- | --- |
| `showDocumentIds` | `SHOW_DOCUMENT_IDS` | off | The Drive file id and Stone Brain row id at the bottom of the Library detail pane (`src/components/library/DetailPane.tsx`). Operator-only debugging detail; ordinary users should never see it. |

Adding a flag: add the var to the `schema` in `src/lib/env.ts` (default it to the
**off** state so a fresh deploy is safe), export it from `flags`, and document it
in the table above and in `.env.example`.
