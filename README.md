# stone-brain

A document-consistency manager and conflict adjudication system that uses an LLM to extract structured claims and entity relationships from a text corpus, uses them to construct a Postgres knowledge graph, and intelligently detects contradictory claims.

## Docs

- [docs/implementation-plan.md](docs/implementation-plan.md) — phased build order
- [docs/ontology-design.md](docs/ontology-design.md) — entities and claim shapes
- [docs/architecture-decisions.md](docs/architecture-decisions.md) — agreed technical decisions and open questions
- [spikes/drive-file-scope/](spikes/drive-file-scope/) — runnable test of the blocking Phase 1 OAuth scope question

## Running the frontend prototype locally

`frontend/` holds the Claude Design export, not a built app. `Stone Brain.dc.html` is a
template interpreted at runtime by `support.js`, which pulls React 18, Babel, and Phosphor
icons from unpkg — so you need to be online, and the files must be served over HTTP
(opening them with `file://` will not work).

From the repo root:

```bash
python3 -m http.server 4173
```

Then open:

- Main prototype — <http://localhost:4173/frontend/Stone%20Brain.dc.html>
- Layout variations — <http://localhost:4173/frontend/Stone%20Brain%20-%20Variations.dc.html>

The design canvas is a fixed 1440×900 frame, so use a wide browser window. Stop the server
with `Ctrl-C`.

`frontend/_ds/nocturne-*/` is the Nocturne design system (one `styles.css` of tokens plus a
`readme.md` of usage rules). Note that the main prototype overrides Nocturne's blurple accent
with a gold palette in its own inline `<style>` block.
