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

**Phase 2A is complete.** What it left behind, beyond the checklist: a constraint layer that makes an invalid claim unwritable, the Nevlos calendar and its parser, an extraction contract whose validator and prompt are generated from one registry, and 29 entities / 28 claims hand-seeded from *Written Map (1012)* as ground truth for the 2B bake-off.

Carried forward deliberately: inverse claims are materialised on hand-entry, and the extraction path will need the same (2B §5); the entity matcher never writes, so agent-proposed entities are 2B's job.

## Claim Generation

To generate claims, we’ll have an LLM read a document and create a structured output we can then parse into our Claims table.

Phase 2A leaves this well set up: the ontology constrains what can be written, `parseExtraction()` already turns a model response into validated rows with structured rejections, and the calendar parser already derives date sort keys. What is missing is everything either side of that — getting the text in, and getting the rows out to Postgres.

Broken into small pieces, roughly in dependency order. Each one is independently testable, so none of them needs the next to exist.

### 1. Provider configuration

Users bring their own inference credentials (decisions §11), so nothing can run until a key can be stored and used.

- [ ] Settings UI for base URL + API key + model ID, with the key encrypted at rest like the Google refresh token
- [ ] A thin OpenAI-compatible client, server-side only
- [ ] Connection-health states: missing key, revoked (401), out of credit (402), rate limited (429)

### 2. Document text

- [ ] `DriveClient.exportMarkdown()` — `files.export` to `text/markdown` (decisions §7)
- [ ] Split into paragraphs on blank lines, so a claim can cite `¶ 4`
- [ ] Record `head_revision_id` from `revisions.list` at extraction time (decisions §6)
- [ ] Decide chunking for documents that will not fit a context window — measure before designing

### 3. The write path

The join between the validated claims Phase 2A produces and the tables. Deferred from 2A because nothing generates claims yet; it is the first thing 2B needs.

- [ ] Entity matcher resolves names to entity IDs, creating drafts on a miss
- [ ] Insert claims keyed on the generated `fingerprint` (`onConflictDoNothing`), so re-extracting a document is idempotent rather than duplicative
- [ ] Write `claim_sources` rows with the quote, paragraph index and a snapshot of the document name (decisions §7a)
- [ ] Stamp `extracted_by_model` on every row, and set `documents.extracted_revision_id`

### 4. The extraction call

- [ ] Assemble the prompt from `describeVocabulary()` plus the document text
- [ ] Request structured output against `extractionJsonSchema()`
- [ ] Validate with `parseExtraction()`; feed rejections back for one retry before giving up
- [ ] One document per invocation, comfortably inside the 300s function limit (decisions §8)

### 5. Inverse claims

Relationships are directional, and `predicates.inverse_name` is already populated. Rather than asking the model for both directions, we generate the reverse claim ourselves.

- [ ] Materialise the inverse of every relationship claim on write
- [ ] Dedupe against the fingerprint index so a symmetric pair does not double up
- [ ] Decide whether editing or deleting one direction in the UI carries the other with it

### 6. Surfacing what was rejected

`parseExtraction()` returns structured rejections. If nothing displays them, a document that extracted badly looks identical to one that extracted well.

- [ ] Store or report the rejections from each run
- [ ] Show them on the document, with the reason — this is also how we find out the vocabulary is too thin
- [ ] Predicate proposals queue: let the model propose a missing predicate, and let the user promote or reject it (see ontology-design.md)

### 7. Model bake-off

Since we do not control the model, the goal is not to pick one but to confirm the prompt holds across several and publish a recommended default (decisions §11).

- [ ] Evaluate candidates on long documents: claims per document, rejection rate, hallucinated entities
- [ ] Compare against the hand-seeded claims from Phase 2A as ground truth
- [ ] Write up the results as a docs page rather than a hardcoded constant

### 8. Frontend wiring

- [ ] Extract button on a document, with progress and result
- [ ] Library shows Verified status and the number of claims per document
- [ ] Flag claims whose source document has been removed from the Library, and surface them (decisions §7a). This is the replacement for Phase 1’s All/Removed toggle and needs no contradiction detection, so it lands here rather than in Phase 3
- [ ] Re-extract prompt when `drive_version` has moved past `extracted_revision_id`

### 9. Unattended runs

- [ ] GitHub Actions cron against a shared-secret endpoint, draining one document per invocation (decisions §8)
- [ ] Back off on 429 rather than burning the user's rate limit

To avoid getting rate-limited, we won’t support a button that lets the user process the entire project all at once.


# Phase 3: Conflict Adjudication

With support for Claims implemented, we can add conflict-detection. Basically, if two Claims involve the same subject and relationship/attribute but different objects/values, we get a collision. Some of these might not be collisions, so we’ll want to gate carefully (e.g. a state might have two different rulers at two different times and a character might have multiple spouses depending on their culture).

- [ ] Implement system for finding all conflicts in our Claims table  
- [ ] Fold the vanished-source flag from Phase 2 into the Conflicts view as a distinct conflict kind, alongside the contradictory-value kind  
- [ ] Wire up logic to surface conflicts to the user  
- [ ] Wire up logic to resolve conflicts (either choose one or manually/generatively incorporate one into the other)  
- [ ] Wire conflicts into Library and Claims frontend components

# Phase 4: Assistant

Here we define the one agentic piece of our project. The Assistant can read the DB, chat with citations to documents, extract Claims from Unverified documents, propose new Claims, and write to Markdown files that can be applied to Google Drive. The user should also be able to tag documents and entities, and provide external files for further context. We may also want to give the Assistant a web-search tool so it can research new topics.

- [ ] Implement basic chatbot  
- [ ] Integrate tools and other connectors  
- [ ] Evaluate different models to determine the best tool for the job

# Phase 5: Polish

After the core functionality is built, I want to release this thing on Vercel so it’s out before we start iterating on additional features. 

- [ ] Create a homepage  
- [ ] Clean up any questionable UI or buggy behaviors  
- [ ] Deploy