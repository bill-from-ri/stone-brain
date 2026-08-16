# Stone Brain Ontology

The root of this project is an ontology system that lets us store atomic claims about
relationships between entities in our world. This document is the settled design for Phase 2A;
the reasoning behind the constraint layer lives in [architecture-decisions.md §15](architecture-decisions.md).

## Entities

We start with ten entity types:

* Characters
* Factions
* Societies
* Cultures
* Religions
* Settlements
* Regions
* Artifacts — including created phenomena, not only portable objects
* Events
* Commodities — classes of traded or produced good, not particular objects

**These live in one `entities` table with an `entity_type` column, not nine tables.** The note
at the bottom of the original draft was right, and it turns out to be forced rather than merely
tidy: claims need a single foreign-key target, and Postgres has no polymorphic foreign key.

An entity row carries only `name`, `name_variants`, `normalized_name`, its type, canonicity, and
an optional source document. **Every other fact about an entity is a claim.**

`normalized_name` — case-folded and punctuation-stripped — is the entity matcher's lookup key.
It is **deliberately not unique**: two distinct entities of one type may legitimately share a
name, and a unique index would make that unrepresentable rather than merely worth reviewing.

Duplicate suppression is therefore the matcher's job, not the schema's. On an exact normalized
hit it resolves to the existing entity or raises the collision for the user — it never silently
mints a second row. That rule is what stops "Sera", "sera" and "Sera." becoming three characters;
the index only makes the lookup cheap.

## Claims

A claim encodes either (1) a relationship between two entities or (2) an attribute of one
entity. **Both live in one `claims` table**, because everything downstream of a claim —
sourcing, canonicity, temporal bounds, the conflicts view, "show me every claim citing this
document" — is identical for the two shapes. Two tables would mean writing all of that twice
and `UNION`-ing every query.

Relationships are directional, so a symmetric relationship is two claims, and each claim
contains exactly two entities.

| Field | Relationship claim | Attribute claim |
| --- | --- | --- |
| `subject_id`, `subject_type` | required | required |
| `predicate` | required | required |
| `object_id`, `object_type` | required | null |
| `value_int` / `value_float` / `value_string` / `value_time` | null | exactly one |
| `start_time` / `start_order`, `end_time` / `end_order` | nullable | nullable |
| `canonicity` (`canon` \| `draft`) | required | required |
| sources | `claim_sources` rows | `claim_sources` rows |

`subject_type` and `object_type` are stored on the claim even though `entities` already knows
them. This is deliberate redundancy that cannot rot: composite foreign keys
`(user_id, subject_id, subject_type) → entities` make the denormalized type provably honest,
and having it on the row is what lets Postgres check domain and range declaratively. Retyping
an entity cascades into its claims.

### In-world time is text, not a timestamp

`start_date` / `end_date` in the original draft cannot be Postgres dates — Nevlos keeps its own
calendar, counting years **Before Doom (BD)** and **After Doom (AD)**, tracked to year and
usually month rather than day.

Each bound is stored as the **verbatim in-world label** (`start_time`) plus a **numeric sort
key** (`start_order`). Date-valued attributes get the same pair (`value_time` / `value_order`).
The sort key is a float so a partially-known date still orders correctly against a fully-known
one.

**The sort key is derived, never supplied.** The extractor and the user write the label;
[`ordinalFor()`](../src/lib/ontology/calendar.ts) converts "AD 412", "Fourth month, 412 AD",
"BD 50" into the ordinal. Two reasons: an LLM asked for a number will confidently invent one, and
the calendar rules belong in one testable function rather than in a prompt. A label the parser
cannot read is still stored, with a null sort key — unordered but not lost, the same "surface it,
don't drop it" rule as ADR §7a.

Era and month are not schema columns. Making them columns would hardcode one world's calendar
into the table and cost nine columns across the three date pairs; if querying by era or year
becomes common, they can be added later as generated columns over the parsed value without
touching the stored data. It also keeps a second reckoning cheap — Nevlos has several calendars,
and another one needs a parser landing on the same float scale, not new columns.

The calendar itself — eras, month lengths, the ordinal encoding, accepted label forms — is
documented in [calendar.md](calendar.md).

### Sources

`sources` is a `claim_sources` table rather than a column: a claim can rest on several passages,
and [ADR §7a](architecture-decisions.md) requires the quote and its paragraph anchor to be
**denormalized at extraction time** so a flagged claim can still show its evidence after the
source document is gone. The document name is snapshotted for the same reason.

---

# The constraint layer

An ontology this permissive is fine while a human is typing. It is not fine once an LLM is
writing claims, because a free-text `relationship` column lets the same fact arrive as `rules`,
`ruled_by`, `is_ruler_of` and `governs` — producing a graph that cannot answer its own
questions.

So the vocabulary is closed, and enforcement lives in the database rather than in application
code. Three reference tables sit in front of `entities` and `claims`:

| Table | Holds | Stops |
| --- | --- | --- |
| `entity_types` | the ten types, as rows | unknown types |
| `predicates` | the verb vocabulary — `ruled_by`, `population`, … | invented predicates |
| `predicate_signatures` | legal `(predicate, subject type, object type / value type)` triples | nonsense pairings |

`predicates.description` is not documentation: it is the text handed to the extraction model.
**The registry is the LLM's instruction sheet** — see *The extraction contract* below, which is
generated from the same source that seeds these tables.

### Why signatures are a table

`ruled_by` legitimately accepts a settlement, a region or a society as subject. Storing subjects
and objects as two independent lists would permit their cross product, which is wider than the
truth — so the legal *combination* is the row.

### The starting vocabulary

Defined in [`src/lib/ontology/registry.ts`](../src/lib/ontology/registry.ts): **26 relationship
concepts and 22 attributes**, expanding to 70 predicate rows and 254 signatures. Only one
direction of each relationship is written by hand; the inverse predicate and its mirrored
signatures are generated, so the two directions cannot disagree about which types they accept.

This is a starting point, not a complete world model. Too small and every extraction stalls on a
missing verb; too large and the model picks inconsistently between near-synonyms. It grows
through the proposals queue below rather than by being guessed at up front.

### Global, not per-user

The three reference tables are **global** — one curated vocabulary, shared by every user, with no
`user_id` column. Users do not define their own: most worlds want much the same types and
relationships, so per-user vocabularies buy a customisation few would make in exchange for setup
friction everyone pays. And because predicate descriptions *are* the extraction prompt, refining
one shared set raises quality for everyone, where forked copies would each drift somewhere
untested. See ADR §15 for the full reasoning, including what this replaced.

Tenant isolation is unaffected: it comes from `user_id` in the `claims → entities` foreign keys,
which the reference tables were never part of.

[`seedOntology()`](../src/lib/ontology/seed.ts) syncs the registry into those tables. It takes no
user, is idempotent, and is how a registry edit reaches a database:

```
npm run db:migrate && npm run db:seed
```

It also prunes rows the registry no longer declares — but only where nothing points at them. A
predicate with claims hanging off it is retained and reported rather than deleted, since dropping
it would orphan real data. Retiring one for real means migrating its claims first.

## What the database enforces

A single composite foreign key from `claims` into `predicate_signatures` enforces, in the
catalog:

- the predicate exists — no invented relationship names
- the subject's type is legal for it (domain)
- the object's type is legal for it (range)
- relationship-vs-attribute consistency — an attribute predicate has no signature carrying an
  object, so a claim with one cannot match, and vice versa. This falls out for free rather than
  needing its own rule.
- the populated value column matches the predicate's declared value type

Alongside it: exactly one value column on an attribute claim and none on a relationship claim,
no self-relations, `end_order >= start_order`, and a generated `fingerprint` with a unique index,
which is what makes re-extracting a document an idempotent upsert instead of a pile of
duplicates.

Cross-tenant reach is blocked by the same mechanism — `user_id` is part of the entity foreign
keys, so a claim cannot point at another user's entity.

### One wart, stated plainly

Postgres foreign keys use `MATCH SIMPLE`: a NULL in **any** referencing column silently disables
the whole constraint. An attribute claim has no `object_type`, so it would have bypassed the
signature check entirely — the exact case the check exists for. Two `NOT NULL` generated columns
project the nullable reality onto a total key space using the sentinel `'@none'`:

```
object_type_key = coalesce(object_type, '@none')
value_kind      = 'int' | 'float' | 'string' | 'date' | '@none'
```

`'@none'` cannot collide with a real name because `entity_types.name` and `predicates.name` are
both constrained to `^[a-z][a-z0-9_]*$`.

The cost is that a violation surfaces as one generic foreign-key error rather than a specific
message. That is why the Zod layer runs first — it produces the readable diagnosis; the FK is
the backstop that cannot be forgotten or bypassed.

[`src/lib/ontology/constraints.test.ts`](../src/lib/ontology/constraints.test.ts) runs the real
migrations against a real Postgres (PGlite, in-process) and asserts each of these rejections by
constraint name.

## What the database deliberately does not enforce

- **`value_enum` membership** — Zod's job. Enforcing it in Postgres would mean a trigger, and a
  trigger is SQL that Drizzle cannot see or diff (ADR §8 makes Drizzle the sole schema owner).
- **Cardinality and contradiction** — Phase 3's job. `predicates.is_functional` and
  `is_temporal` are carried now, unread, purely so that work needs no migration. A settlement
  having two rulers is only a conflict if their validity windows overlap, and that is exactly
  the gating the implementation plan asks for.

## Renaming

`entity_types.name` and `predicates.name` are primary keys, and the foreign keys depending on
them are `ON UPDATE NO ACTION` — a cascade cannot write a generated column, so a cascading
rename would fail at the FK anyway. Renaming a type or a predicate is therefore a deliberate
data migration, not a casual edit. Retyping an individual **entity** is the common case and is
fully supported: that FK cascades.

---

# The extraction contract

[`src/lib/ontology/extraction.ts`](../src/lib/ontology/extraction.ts) owns the boundary between
the model and the tables: the schema the model is given, the validation its output must survive,
and the translation into rows.

What an LLM emits is **not a claim row** — it writes entity names rather than UUIDs, has no
`user_id`, and gives dates as labels rather than sort keys:

```json
{ "subject": "Ashfall", "subject_type": "settlement",
  "predicate": "ruled_by", "object": "Sera", "object_type": "character",
  "start_time": "AD 412", "quote": "…", "paragraph": 14 }
```

`parseExtraction()` turns that into the shape the entity matcher consumes: value routed into the
column its predicate declares, `start_order` derived by the calendar parser, names left for the
matcher to resolve.

## Why validate when the database already enforces all of this

The catalog can only answer yes or no, one row at a time, after the model has already been paid
for. This layer:

- **rejects per claim** — two bad claims out of thirty cost two claims, not the document
- **produces errors a retry can act on** — `'ruledby' is not in the vocabulary. Did you mean:
  ruled_by?` rather than `claims_signature_fk`
- **checks what the catalog structurally cannot** — `value_enum` membership
- **refuses invented fields** rather than silently dropping them
- **generates the prompt** — the vocabulary listing and the JSON Schema

It is the working surface, not the authority. It may be wrong, improved, or bypassed; the foreign
keys are the thing that cannot be.

## Asking the model to type its entities

`subject_type` and `object_type` are part of the wire format, which looks like extra work for the
model. It is what allows domain and range to be checked *before* any database work — and a type
that later disagrees with the matched entity is itself a signal worth having.

## Suggestions stop where spelling stops

An unknown predicate gets the nearest real names by edit distance, which is the mistake a model
given an enum actually makes (`ruledby`, `member-of`). Below a distance threshold it offers
**nothing**: the nearest strings to `governs` are `owns` and `power`, and naming those would push
the model onto a wrong-but-legal predicate that nothing downstream would ever flag. A genuine gap
in the vocabulary is told to stay a gap.

## One source, three consumers

The seeded reference tables, the validator, and the prompt all derive from the same ontology.
Written separately they drift, and the failure is silent — the prompt offers a predicate the
validator rejects, extraction quietly yields nothing, and it reads as a bad model rather than a
bug. `compileOntology()` takes rows rather than importing the registry, so the runtime can
compile a user's *edited* vocabulary out of the database while tests compile the registry.

A drift suite in `extraction.test.ts` asserts the three agree: every registry predicate compiles,
appears in the rendered vocabulary and in the JSON Schema, and every signature the registry
declares is accepted by the validator.

At present the vocabulary renders to roughly 2,500 tokens and the JSON Schema to about 450.

---

# The entity matcher

[`src/lib/ontology/matcher.ts`](../src/lib/ontology/matcher.ts). Resolves a surface string to an
entity that already exists, and does nothing else.

```
resolve(index, name, { type? })
  → { matched, entity }
  → { ambiguous, candidates }
  → { none, suggestions }
```

**It writes nothing.** Not a limitation — the definition. It never creates, merges, renames, or
promotes. Two consequences carry the design:

- A name it cannot resolve is **not** quietly turned into a draft entity. Minting entities for
  unrecognised names is how a bad extraction fills a world with junk.
- A near miss is **never** returned as a match. `normalized_name` is deliberately not unique, so
  two distinct entities may share a name; silently picking one destroys information nothing
  downstream would surface. Suggestions are returned separately from matches, and never as one.

The asymmetry is deliberate: a duplicate entity is visible and fixable, a wrong merge is neither.

## What counts as a match

- **Exact**, on the normalized key — case, punctuation and diacritics folded, so `Akál`, `Akal`
  and `akal.` are one key.
- **A declared variant** — `Nethros` resolves to Enua, and the result says `via: 'variant'` so a
  UI can show why.
- **A dropped leading article** — `Dragon's Shroud` finds `The Dragon's Shroud`. Not a guess about
  which entity was meant; it is the same name.

Everything else is a suggestion, with a reason: `other_type` when the name exists but under a type
the caller did not ask for (usually the more useful answer), or `near_miss` by edit distance —
thresholded, and silent when nothing is close, on the same reasoning as the extraction layer's
predicate suggestions.

## `type` is optional

Extraction always knows the type; a user typing into a form may not. Without it, a name resolving
to exactly one entity still resolves — only a name shared across types comes back ambiguous
instead of being guessed at.

## The case that proves it

The first seed contains `Frost Gulf` as a region **and** as a variant of `Runara`, because the
source document uses the phrase for both the bay and the forested land around it. Resolving it
returns both, labelled, in either direction and with or without a type. A unique index would have
made that world unrepresentable.

---

# How the vocabulary grows

A closed vocabulary that cannot grow will strangle the project the first time the extractor
correctly identifies a relationship we did not anticipate. So the extraction schema gives it a
structured way to fail: a `proposed_predicate` object (name, description, an example subject and
object) that lands in a proposals queue instead of the graph. Because the vocabulary is global and curated, promotion means **editing the registry and
re-running the seed** — a maintainer decision, not a per-user setting. The queue's job is to
surface where the ontology is actually thin.

Closed at write time, open over the life of the project.

*(Phase 2B. Not built yet.)*

# Deferred to claim generation (Phase 2B)

- **Inverse claims are not materialized yet.** `predicates.inverse_name` records the reverse
  direction of every relationship (`married_to` points at itself), so claim generation can
  auto-write and dedupe the reciprocal claim rather than asking the model for both. Doing it at
  generation time keeps the round trip cheap and keeps the two directions consistent by
  construction.
- **Agent-proposed entities.** The matcher deliberately never creates one (see below), so a name
  it cannot resolve waits for 2B's proposal step, which decides deliberately and records why.
