# Order of Operations

This is going to be a pretty substantial project, so I want to make sure we implement it in the right order. After creating the git repo and wiring the frontend to stubs, we should prioritize the core functionality and build out from there. 

# Phase 1: Library

All of our other functionality is based on the ability for our code to interface with Google Drive files. We need to do the following:

- [x] Build logic for connecting app to Google Drive  
- [x] Set up OAuth so users can securely link their accounts  
- [x] Ensure that frontend accurately reflects structure of user’s Drive folder  
- [x] Ideally we can get live updates to the Library; manually syncing with Drive is friction that I want to avoid

For now, we won’t track stuff like Claims, Last Verified, Conflicts, etc. We’ll have Status set to **Unverified** for all files. Clicking on a file will open a sidebar with some metadata, including a link to the document itself; with nothing selected the sidebar is closed rather than empty.

In terms of scope, we’ll keep things focused on just document files. We’ll ignore slides, images, and spreadsheets for now.

The Library shows what is in the Drive folder *now*. Documents that are deleted, trashed, or moved out are soft-deleted in the database so their claims survive, but they are not listed anywhere in the Library — a vanished document becomes visible as a flag on the claims that cite it, in Phase 2. See decisions §7a.

# Phase 2: Creating Claims

This phase has two parts: building the ontology and AI-powered Claim generation. To stay focused, we’ll defer consistency checking until after the base Claim system is properly established.

## Building the Ontology

For claims to be made, we need to have the ontology in place first. This will include an entity matcher helper that we can use to normalize outputs from the LLM in our Claim Generation step.

- [x] Set up PSQL DB  
- [x] Seed with starting Entities and Claims (link to documents)  
- [x] Create basic entity matcher function  
- [x] Wire up Claims––both table and graph views––on frontend to visualize everything (users should have the ability to define and edit Claims via the frontend). Remember to mark the seed document as Verified

**Phase 2A is complete.** What it left behind, beyond the checklist: a constraint layer that makes an invalid claim unwritable, the Nevlos calendar and its parser, an extraction contract whose validator and prompt are generated from one registry, and 29 entities / 28 claims hand-seeded from *Written Map (1012)* as ground truth for 2B's extraction scoring.

Carried forward deliberately: inverse claims are materialised on hand-entry, and the extraction path will need the same (2B §5); the entity matcher never writes, so agent-proposed entities are 2B's job.

## Claim Generation

To generate claims, we’ll have an LLM read a document and create a structured output we can then parse into our Claims table.

Phase 2A leaves this well set up: the ontology constrains what can be written, `parseExtraction()` already turns a model response into validated rows with structured rejections, and the calendar parser already derives date sort keys. What is missing is everything either side of that — getting the text in, and getting the rows out to Postgres.

Broken into small pieces, roughly in dependency order. Each one is independently testable, so none of them needs the next to exist.

### 1. Provider configuration

Users bring their own inference credentials (decisions §11), so nothing can run until a key can be stored and used.

- [x] Settings UI for base URL + API key + model ID, with the key encrypted at rest like the Google refresh token
- [x] A thin OpenAI-compatible client, server-side only
- [x] Connection-health states: missing key, revoked (401), out of credit (402), rate limited (429)

Done, as a modal off the Settings page. `provider_settings` is a second per-user
secret store in the same shape as `google_accounts`, reading through the same
secretbox with its own AAD purpose; `src/lib/llm/provider.ts` is the only module
that touches it, and it splits the read in two so a display caller structurally
cannot obtain the key.

The health check is one capped chat completion rather than `GET /models`,
because that is the only request that tests all three fields at once — several
OpenAI-compatible servers do not implement `/models`, so a 404 there would be
indistinguishable from a bad URL. Verification is advisory: the row is written
first and stays written when the probe fails, so a provider that is merely down
cannot stop someone saving a key they know is good.

Two things deliberately left for later: the modal is reachable only from
Settings — the document detail pane and the Assistant will open the same
component — and the client has no streaming, which nothing before Phase 4 needs.

### 2. Document text

- [x] `DriveClient.exportMarkdown()` — `files.export` to `text/markdown` (decisions §7)
- [x] Split into paragraphs on blank lines, so a claim can cite `¶ 4`
- [x] Record `head_revision_id` from `revisions.list` at extraction time (decisions §6)
- [x] Decide chunking for documents that will not fit a context window — measure before designing

Done, and the measurements moved two of these. All 47 documents export without
failure; `cleanExport` → `toParagraphs` was run over every one of them, and the
round-trip check (every paragraph is a substring of the cleaned text, so a stored
quote stays findable) passes on all of them.

**Images are dropped entirely**, per scope: non-text input waits until the project
is ready to digest it. Both halves go — the base64 `data:` payload and the
`![][image1]` marker referring to it — so nothing image-shaped reaches the prompt
or the database, and no alt text is kept either. `DocumentText.strippedBytes`
records what each document shed. `cleanExport` is the single place that changes
if images ever come into scope.

**Chunking: not needed, and not built.** 88% of the raw export bytes were base64
image data — 99.1% of the largest document. Stripped, the biggest document is
~20k tokens and the *entire library* is ~94k, so one document per request fits
any usable model with an order of magnitude to spare. `fitsInContext` is the
guard that says when that stops being true; a chunker would split the context a
claim depends on, and this corpus does not ask for that trade.

**A quarter of the library needed unpacking, not just splitting.** Twelve
documents — the claim-dense ones: nations, cities, armies — are Google Docs
wiki-layout tables with the whole article inside a single cell. Left alone they
were *two* paragraphs for 8,700 characters, so every claim would have cited "¶ 1",
meaning the whole document. `splitLayoutTable` recovers them (Andras 2 → 18 ¶,
Kaldian Empire 2 → 24 ¶) using the two-space runs Docs leaves where paragraph
breaks were, behind three guards derived from documents that would otherwise
break: data tables (cells cap at 293 chars vs 692 for layout), many-rowed tables
(`Rough Timeline` is a real 23-row table), and content made of spaces (the ASCII
maps in `Basic City Maps`).

**Also carried forward:** headings, lists and tables each stay one citable unit,
and every paragraph carries its heading trail as section context for §4's prompt.
`renderForPrompt` emits the `[¶n]` markers, since a model cannot cite an anchor it
was never shown. Known limit: ASCII art inside a table cell arrives with its line
breaks already flattened *by Google*, and no export-based approach can recover it.

### 3. The write path

The join between the validated claims Phase 2A produces and the tables. Deferred from 2A because nothing generates claims yet; it is the first thing 2B needs.

- [x] Entity matcher resolves names to entity IDs; **a separate step** creates drafts on a miss —
  the matcher itself never writes, and never did (ADR §15)
- [x] Insert claims keyed on the generated `fingerprint`, so re-extracting a document is idempotent
  rather than duplicative
- [x] Write `claim_sources` rows with the quote, paragraph index and a snapshot of the document name (decisions §7a)
- [x] Stamp `extracted_by_model` on every row, and set `documents.extracted_revision_id`
- [x] Also record the `drive_version` extracted at — §2 found revision ids are checkpoints, not
  per-edit, so they cannot carry staleness (decisions §6, second correction)

Done. `writeExtraction` is one transaction: a half-written run — entities minted,
document stamped, claims missing — is worse than none, because nothing downstream
could tell it from a real one.

**Creation is its own step.** `createDraftEntities` lives in `entity-drafts.ts`
and is called by the write path, never by the matcher. `resolve()` stays a pure
lookup so that "I could not find this" can never quietly become "so I made one" —
otherwise every caller that merely wanted to *check* a name (a search box, a
duplicate warning) could grow the graph. What it mints is `canonicity: 'draft'`,
`created_by: 'llm'`, with the source document and the model on the row.

**Re-extraction is additive**, per the decision: new claims inserted, existing
ones no-ops, nothing removed. A conflict action that provably changes nothing
(`set subject_id = excluded.subject_id`, identical by definition under a
fingerprint collision) returns ids for rows that already existed, so a claim a
person promoted to canon keeps its canonicity and its authorship.

**Two things are refused rather than guessed at**, and come back as `unwritten`
for §6 to surface: a name matching two entities, and a type disagreement between
the model and the graph. Both are real information; picking a side would destroy it.

Not done here, deliberately: inverse claims are §5, and surfacing `unwritten` /
rejections is §6. The result object already carries what §6 needs.

### 4. The extraction call

- [x] Assemble the prompt from `describeVocabulary()` plus the document text
- [x] Request structured output against `extractionJsonSchema()`
- [x] Validate with `parseExtraction()`; feed rejections back for one retry before giving up
- [x] One document per invocation, comfortably inside the 300s function limit (decisions §8)

Done. `prompt.ts` is the string assembly and `extract.ts` is the call, split so
the part a person tunes can be printed without a provider configured.
`npm run extract -- "<name>" [--write] [--model=<id>]` is the harness both were
verified with, and the one §7 will drive.

**Structured output could not be assumed, and the reason was measured, not
guessed.** On Google's OpenAI-compatible endpoint, `gemini-3.7-flash` — the
model currently configured — returns HTTP 503 to *every* `json_schema` request,
7 out of 7, with a one-property schema as reliably as with the real one, while
answering a `json_object` or plain call on the same key in the same minute in
one to three seconds. `gemini-2.5-flash` and `gemini-3-flash-preview` take the
real schema happily. So `negotiateRequest` walks a ladder — schema, then
`json_object`, then free text — and only an *articulated* refusal (a status code)
moves it down: 401, 402 and 429 are true of every rung, so retrying them would
turn one honest error into six. The accepted rung is memoised per endpoint+model.

**Reasoning effort is the difference between fitting in 300s and not.** On
`gemini-3-flash-preview` over an 8-paragraph document, default effort spent
~63,000 thinking tokens and 195 seconds; `reasoning_effort: 'low'` spent none,
took 7 seconds, and returned *more* claims. Extraction is a reading task, so low
is the right default — but OpenAI rejects the parameter outright on a
non-reasoning model, so it is the ladder's other axis, dropped when the provider
names it in its complaint.

**Two things are deliberately not conflated.** `max_tokens` is left unset (ADR
§11: Gemini bills thinking against it), and an empty completion is an
`ExtractionError`, never a document with no claims in it — otherwise a token
budget mistake would stamp a document extracted and record that it says nothing.

Verified end to end against the live corpus and the real provider: *Village of
Nephten* (8 ¶) gave 21 claims and *The Republic of Andras* (18 ¶) gave 25, both
with zero surviving rejections after one repair, in 7–8s. Handing those exact
claims to §3 wrote 25 claims, 25 sources and 21 draft entities with nothing
unwritten, and a second run of the same output created nothing — idempotency
holding on real model output, not just on fixtures.

**Operational note for §9:** the free tier on `gemini-3.7-flash` is **20
requests per day, per model**. A document costs one request, or two when a
repair is spent. The queue drain has to treat that as the binding limit.

**Ground truth, extended (2026-08-30 → 2026-09-27).** Phase 2A's single seeded
document is now three, chosen to cover different halves of the vocabulary:
*Written Map (1012)* (geography), *The Kaldian Empire* (politics, people,
trade) and *The Runar* (peoples, culture, belief) — 90 entities, 114 claims, 115
cited quotes, every document Verified. Each round is hand-labelled with the
`seed-ground-truth` skill (`.claude/skills/seed-ground-truth/SKILL.md`), which
also governs how a document's evidence may change the ontology. Changes that
came out of it:

- **Ontology:** `deity` and `species` entity types; `successor_of` for
  dynasties, `serves` between societies, `language`, and `of_species`
  (replacing a free-text `species` attribute). The `description` attribute is
  gone — an entity's description is `entities.summary`, shown on its detail
  card. Now 12 types, 73 predicates, 255 signatures.
- **Settled rulings** live in `ontology-design.md` (*Modelling conventions*,
  *Deliberately not modelled*); proposals deferred along the way, with their
  evidence and the claims they would unlock, in `deferred-proposals.md`.
- **Export cleaning** strips bold and italic markers, which had split quotes
  across emphasised words. `scripts/check-seed-quotes.ts` re-checks every
  seeded quote against the live documents.
- **`loadSeed`** cites a claim from every document that states it, fills
  missing entity summaries without overwriting, and supports hand-entered
  claims (`created_by = 'user'`, no source).

### 4b. Extraction scoring

The reason the ground truth exists: measure how well the configured model
(Gemini, for now) extracts, against claims a person read out of the same
documents. Independent of §7 — it needs one model, not several.

- [x] Decide what counts as a match: same subject, predicate and object/value, compared in
  the registry's declared direction. A paraphrased quote fails; a verbatim quote that
  overlaps the ground truth's passes
- [x] Run extraction over the three seeded documents without writing, and score
  precision and recall per document and per predicate (`npm run extract:capture`, then
  `npm run extract:score -- <run-label>`)
- [x] Record the baseline before §5 changes what extraction writes
- [ ] Budget: 3–6 requests of the 20/day free tier per full run

**Baseline (2026-11-11).** Captured from Claude Sonnet rather than Gemini, through
`extract:capture`'s `--dump-prompts` / `--from-replies` mode — one attempt, no repair
round: precision 63%, recall 25% over the three seeds, every quote verbatim. The reading,
and the one entity-typing mistake behind most of the Kaldian misses, is in
[extraction-scoring.md](extraction-scoring.md). A Gemini capture has not been scored yet;
the scorer does not care which model a fixture came from.

### 5. Inverse claims

Relationships are directional, and `predicates.inverse_name` is already populated. Rather than asking the model for both directions, we generate the reverse claim ourselves.

- [x] Materialise the inverse of every relationship claim on write — extraction, hand entry
  and the seed loader all go through `inverseOf()`; the inverse carries the same provenance
  and citations as the claim it mirrors
- [x] Dedupe against the fingerprint index so a symmetric pair does not double up
- [x] Decided: editing or deleting one direction always carries the other with it
- [x] Bring the ground truth along: `loadSeed` materialises inverses too, *and* §4b's scoring
  compares one canonical direction. `npm run db:backfill:inverses` repairs existing data

### 6. Surfacing what was rejected

`parseExtraction()` returns structured rejections. If nothing displays them, a document that extracted badly looks identical to one that extracted well.

- [x] Store the rejections from each run: `extraction_runs` records every attempt (succeeded,
  failed or interrupted) and `extraction_issues` every claim that was dropped, whether by
  validation or by entity resolution
- [x] Show them on the document, with the reason — this is also how we find out the vocabulary is too thin
- [x] Predicate proposals queue: the model may file a `proposed_predicates` entry instead of
  forcing a near-synonym; the queue lives in Settings. Promoting records the decision — the
  vocabulary is global, so growing it is still a registry edit and a re-seed (see ontology-design.md)

### 7. Model comparison — deferred

**Deferred (2026-09-27).** Only Gemini is available to run extraction for now, so there is nothing to compare it against. Scoring Gemini's output against the hand-seeded ground truth does not wait on this and continues as its own step; this section resumes when a second model is available.

Since we do not control the model, the goal is not to pick one but to confirm the prompt holds across several and publish a recommended default (decisions §11).

- [ ] Evaluate candidates on long documents: claims per document, rejection rate, hallucinated entities
- [ ] Compare each candidate's §4b score against the hand-seeded ground truth
- [ ] Write up the results as a docs page rather than a hardcoded constant

### 8. Frontend wiring

- [x] Extract button on a document, with progress and result
- [x] Library shows Verified status and the number of claims per document, and a document can be marked verified
- [x] Flag claims whose source document has been removed from the Library, and surface them (decisions §7a). Built with Phase 3 as the vanished-source conflict kind
- [x] Re-extract prompt when `drive_version` has moved past the version last extracted at —
  *not* against `extracted_revision_id`, which is a different scale (decisions §6)

### 9. Unattended runs

- [ ] GitHub Actions cron against a shared-secret endpoint, draining one document per invocation (decisions §8)
- [ ] Back off on 429 rather than burning the user's rate limit

To avoid getting rate-limited, we won’t support a button that lets the user process the entire project all at once.


# Phase 3: Conflict Adjudication

With support for Claims implemented, we can add conflict-detection. Basically, if two Claims involve the same subject and relationship/attribute but different objects/values, we get a collision. Some of these might not be collisions, so we’ll want to gate carefully (e.g. a state might have two different rulers at two different times and a character might have multiple spouses depending on their culture).

- [x] Implement system for finding all conflicts in our Claims table — derived by query, never
  stored. Only single-valued predicates can conflict (the registry now says which *direction*
  of a relationship is single-valued), and claims tied to different periods, or to objects of
  different entity types, do not compete  
- [x] Fold the vanished-source flag from Phase 2 into the Conflicts view as a distinct conflict kind, alongside the contradictory-value kind  
- [x] Wire up logic to surface conflicts to the user  
- [x] Wire up logic to resolve conflicts: keep one side, edit a side by hand, or dismiss as
  not a conflict (undoable). Generative merge is deferred  
- [x] Wire conflicts into Library and Claims frontend components

# Phase 4: Assistant

Here we define the one agentic piece of our project. The Assistant can read the DB, chat with citations to documents, extract Claims from Unverified documents, propose new Claims, and write to Markdown files that can be applied to Google Drive. The user should also be able to tag documents and entities, and provide external files for further context. We may also want to give the Assistant a web-search tool so it can research new topics.

- [ ] Implement basic chatbot  
- [ ] Integrate tools and other connectors  
- [ ] Evaluate different models to determine the best tool for the job

# Phase 5: Polish

After the core functionality is built, I want to release this thing on Vercel so it’s out before we start iterating on additional features. 

- [x] Create a homepage — a public landing page for signed-out visitors at `/`, and the in-app Home rebuilt on real data  
- [ ] Clean up any questionable UI or buggy behaviors  
- [ ] Deploy