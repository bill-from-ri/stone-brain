# DRAFT — Seed round 1: "Written Map (1012)"

> **Working document, nothing locked in.** Scratch space for the first hand-seeded entities and
> claims, and for the ontology changes that document argues for. Fold the settled parts into
> `ontology-design.md` and `registry.ts`, then delete this file.

Source: `Written Map (1012)`, Drive id `1mwSY…iv3A`, 20 paragraphs, exported 2026-08-16.
A gazetteer touring Nevlos from the northwest, **counter-clockwise**.

Because it is almost pure geography, it stresses the thinnest part of the vocabulary and says
almost nothing about the 80% built for people and politics. Weigh its evidence accordingly.

---

**Status:** §1–§7 are settled and **already in `registry.ts` and the database** (migrations 0003,
0004; `npm run db:seed`). §8, the world data itself, is not written yet.

## 1. Decisions taken

| # | Decision |
| --- | --- |
| 1 | **`artifact` widens to include created phenomena**, not just portable objects. The Dragon's Shroud is an artifact. Needs only a description change — `created` (character → artifact) and `located_in` (artifact → region) already exist. |
| 2 | **Drop `epithet`.** Descriptive bynames are not titles. "The last of the giants" is prose and belongs in a description, not a claim. `title` stays for actual offices and styles. |
| 3 | **Replace `terrain` with two enumerated attributes**: `climate` and `landform`. See §3. |
| 4 | **`located_in` stops being functional.** Many regions sit inside one region, and a region can reasonably sit in more than one. Its vagueness is accepted for now. |
| 5 | **Akali Archipelago is a name variant of Akál**, not a second entity. |
| 6 | **Merovia and Agyros are regions.** States centred on them are a later document's problem. |
| 7 | **A bare year means AD.** Most of the world's history is post-Doom, so the calendar parser should default the era rather than refuse. |
| 8 | **Purpose and intent are not modelled.** "…with the intention of trapping Vaski" goes in a description. |
| 9 | **Causal relations between places are out of scope** for this round. |
| 10 | **Comparatives are out of scope.** No home for "one of the most densely populated". |
| 11 | **`economy` belongs to societies, not regions.** Land is not agrarian — the state farming it is. Values trimmed to `agrarian · pastoral · mercantile · maritime`. |
| 12 | **No `trades_with`.** Dropped. |
| 13 | **`commodity` becomes an entity type**, with `produces` / `exports` / `imports`. |
| 14 | **Nevlos is a region.** West/central/east subregions arrive later to give the geography a hierarchy; nothing here should presume them. |
| 15 | **The Yeosin Frontier is a region** with no `landform` — it is a political march, not a shape of ground. |
| 16 | **The Frost Gulf splits in two.** The water is `Frost Gulf` (landform `gulf`, no climate); the forested land around it is `Runara`, carrying `Frost Gulf` as a name variant and the `temperate_rainforest` climate. |
| 17 | **Manual entry is first-class.** `created_by = 'user'` on an entity or claim means hand-authored, with no document behind it and no `claim_sources` row required. |

---

## 2. Open questions

**a. `entities.summary` vs the `description` claim.** We have both, and they hold the same thing.
The claim is sourced (`claim_sources`) and can carry a validity window; the column is neither, but
it is cheap to render in a list. Suggest: keep the column as an unsourced editorial blurb the user
writes, and use the `description` claim for anything drawn from a document. If that distinction
feels thin, drop one.

**b. How do Runara and the Frost Gulf relate?** The land wraps the water, which is a *border*, not
containment — and there is no `borders` predicate. Either leave them unrelated, or accept
`Frost Gulf —located_in→ Runara` as a loose reading. Left unclaimed for now.

**c. Does everything sit `located_in` Nevlos?** Technically true and probably not useful. The
planned west/central/east subregions will want to be the real parents, so seeding a flat
world-level link now creates work to undo. Left unclaimed.

**d. Are there commodities in this document?** None are named. "A bread basket that has fed
civilizations" implies grain without saying it, so `Lagetan Basin —produces→ Grain` is an
inference rather than a reading. Flagged below; drop it if that is a step too far.

---

## 3. `climate` and `landform`

Replaces `terrain`, which conflated the two and took free text.

**Both are optional and functional.** A region large enough to span several biomes simply gets no
`climate` claim — Southern Ephria is the worked example. Not knowing yet is also a reason to omit,
as with Kovnia. An absent claim is not a gap to be filled.

### `climate` — enum, region only

Vegetation-and-temperature bands rather than strict Köppen codes, because the source material is
written in these terms.

```
ice_cap · tundra · alpine · boreal_forest · temperate_rainforest · temperate_forest
temperate_grassland · steppe · mediterranean · semi_arid · desert
savanna · tropical_seasonal_forest · tropical_rainforest · wetland
```

### `landform` — enum, region only

Deliberately geomorphological, with no vegetation terms, so it cannot overlap `climate`. This is
what stops every region being just `region`.

```
continent · island · archipelago · peninsula · isthmus · coast
mountain_range · hills · plateau · plain · basin · valley · canyon
sea · gulf · strait · lake · river · marsh
```

The Great Steppe is the case that proves the split: **landform `plateau`, climate `steppe`**.

---

## 4. "3rd century" and the calendar

**Today it does not parse.** `parseWorldDate` needs an era token and understands only years,
months and days, so "the 3rd century" stores as a label with a null ordinal — preserved, but
unorderable. Two extensions would fix it, both small:

1. **Default the era to AD** when none is given (decision 7). Makes bare `412` parse.
2. **Accept century granularity.** "3rd century" → AD 201–300.

For the ordinal, the existing rule already answers the question: an imprecise date resolves to the
earliest point it could mean. So `3rd century` → the start of AD 201 → **ordinal 200.0**, and it
sorts before any specific date inside that century. The label stays verbatim.

Still unresolved: whether the *end* of a century-scale event should be expressible. `occurred_on`
is a point. For a decades-long conquest the honest encoding is `start_time` / `end_time` on the
claim, which the schema already supports.

---

## 5. `successor_of`

**What it means today:** the subject took over an office, title, or role the object previously
held. Accepts character→character, faction→faction, society→society, religion→religion.

**Why it feels niche:** for anything with dates it is derivable. If A rules 400–420 and B rules
420–450, succession is a query, not a fact.

**Why it might earn its place:** succession is often known when dates are not — "Sera's successor
was Kaine" appears constantly in worldbuilding prose with no year attached. That is a fact no
`rules` claim can express.

**Decided:** kept, narrowed to **character → character**. Dynastic succession is common and hard
to derive; "successor state" is vague and this document no longer needs it (decision 6 made
Merovia and Agyros regions).

---

## 6. Trade and economy

Four paragraphs turn on it and nothing in the vocabulary touches it. Three options, increasing in
cost and fidelity.

**A — `economy` attribute (enum, cheap).** Captures what a place lives on.
`agrarian · pastoral · mercantile · maritime · extractive · industrial · subsistence`
Kovnia → `mercantile`. The Great Steppe → `pastoral`. Akál → `maritime`. Lagetan Basin → `agrarian`.

**B — `trades_with` (symmetric relationship, cheap).** Captures the network claims: Kovnia sits
between Ipheria and Akál; the Great Steppe connects East and West.

**C — a `commodity` entity type plus `produces` / `exports` / `imports` (expensive, and the only
one that actually models trade).** "A bread basket that has fed civilizations" is really *produces
grain*. Adding an entity type is the costly kind of change, and one gazetteer is thin evidence.

**Decided: A and C, not B.** `economy` lands on societies with four values. `trades_with` is
dropped. `commodity` becomes the tenth entity type, with `produces` / `exports` / `imports`.

The line between `produces` and the trade verbs is deliberate: **`produces` accepts a region;
`exports` and `imports` do not.** Land grows things, but only an actor sells them.

Consequence worth noting: this document names no goods, so the commodity machinery is seeded
unused. That is fine — it is there for the documents that do.

---

## 7. Proposed registry changes, collected

| Change | Kind | Done |
| --- | --- | --- |
| `artifact` description widened to created phenomena | edit | ✅ |
| `commodity` added as the tenth entity type | add | ✅ |
| `epithet` removed | remove | ✅ |
| `terrain` removed | remove | ✅ |
| `climate` added (enum, region, functional) | add | ✅ |
| `landform` added (enum, region, functional) | add | ✅ |
| `economy` added (enum, **society only**, functional) | add | ✅ |
| `produces` / `produced_by` (society, settlement, region, faction → commodity) | add | ✅ |
| `exports` / `exported_by`, `imports` / `imported_by` (no region) | add | ✅ |
| `located_in` no longer functional | edit | ✅ |
| `successor_of` / `predecessor_of` narrowed to character → character | edit | ✅ |
| `created_by` CHECK on entities and claims, for manual entry | schema | ✅ 0004 |
| Calendar: default era AD; accept centuries | code | ⬜ not yet |

**Vocabulary now:** 10 entity types · 26 relationship concepts + 22 attributes → **70 predicate
rows, 254 signatures**. Seeding pruned `epithet`, `terrain` and three `successor_of` signatures,
none of which anything referenced — the first live exercise of the prune-if-unreferenced path.

---

## 8. The seed itself

**Not written yet.** Revised for decisions 11–17.

### Entities (28)

**Regions (20)** — Nevlos, Elduin, Frost Gulf, Runara *(variant: Frost Gulf)*, Enua *(variant:
Nethros)*, Zada Mountains, Orosh Mountains, Lagetan Basin, Ipherian Sea, Ephria, Southern Ephria,
Kovnia, Ipheria, Akál *(variant: Akali Archipelago)*, Sea of Akál, Yeosin Frontier, Central Plain,
Great Steppe, Merovia, Agyros

**Societies (3)** — Ipherian Empire, Tavilaga, Central Empire

**Characters (2)** — Syrath, Vaski

**Events (2)** — the Doom, the Enu Conquests

**Artifacts (1)** — the Dragon's Shroud

**Commodities (0)** — none named. See open question d.

> **Note for the matcher.** `Frost Gulf` is now both an entity name *and* a variant of `Runara`,
> so resolving that string returns **two** candidates. Deliberate — the document uses the phrase
> for both the water and the land — and the first live case of the ambiguous path. It is exactly
> what the dropped unique index would have forbidden.

### Claims

Each carries a `claim_sources` row with its quote and paragraph index. Inferences are marked ⚠.

| ¶ | Claim |
| --- | --- |
| 3 | `Dragon's Shroud —created_by→ Syrath` |
| 3 | `Dragon's Shroud —located_in→ Elduin` — "centered on"; approximate |
| 3 | `Elduin landform = island` |
| 3 | `Syrath species = dragon` |
| 3 | ⚠ `Syrath vital_status = dead` — inferred from "final moments" |
| 3 | `Vaski species = giant` |
| 5 | `Frost Gulf landform = gulf` — **no climate**, it is water |
| 5 | `Runara climate = temperate_rainforest` |
| 7 | `Enua landform = peninsula` |
| 7 | `Zada Mountains —located_in→ Enua`, `Zada Mountains landform = mountain_range` |
| 7 | `Orosh Mountains —located_in→ Enua`, `Orosh Mountains landform = mountain_range` |
| 7 | `Lagetan Basin —located_in→ Enua`, `Lagetan Basin landform = basin` |
| 7 | ⚠ `Lagetan Basin —produces→ Grain` — "a bread basket"; would add the only commodity |
| 7 | `Enu Conquests` with `start_time = "AD 201"`, `end_time = "AD 300"` — from "3rd century" |
| 9 | `Ipherian Sea landform = sea` |
| 9 | `Ipherian Empire —rules→ Ipherian Sea`, ended — "once united by" |
| 11 | `Ephria landform = continent` |
| 11 | `Southern Ephria —located_in→ Ephria` — **no climate**, spans several biomes |
| 13 | *(Kovnia: no climate yet, and no economy — the state ruling it is undefined)* |
| 15 | `Akál landform = archipelago` |
| 15 | `Tavilaga —rules→ Akál`, ended — "were once united by" |
| 15 | ⚠ `Tavilaga economy = maritime` — from "the mighty seafaring empire" |
| 17 | `Central Plain landform = plain` |
| 17 | `Central Empire —rules→ Central Plain` |
| 19 | `Great Steppe landform = plateau`, `Great Steppe climate = steppe` |
| all | `description` on each entity |

Roughly **30 claims across 28 entities** — thinner than the first pass, because moving `economy`
onto societies removed four claims this document cannot support. That is the decision working
correctly, not a loss.

### Deliberately not claimed

- **"The last of the giants"** — prose, not a title (decision 2).
- **"…with the intention of trapping Vaski"** — no purpose predicate (decision 8).
- **"the mouth of this bay is now closed by the Dragon's Shroud"** — no spatial predicate beyond
  `located_in`.
- **"spanning from the Yeosin Frontier to the Sea of Akál"** — an extent, not a location.
- **"watered by moisture blown off the Dragon's Shroud"** — causal, out of scope (decision 9).
- **"one of the most densely populated places"** — comparative (decision 10).
- **Kovnia's mercantile economy, the Steppe's pastoralism, the Lagetan Basin's agriculture** —
  `economy` is a society's attribute and no society is named for any of them (decision 11).
- **The Great Steppe's nomadic tribes, Akál's seafaring peoples** — unnamed, so not entities.
- **`located_in Nevlos` for everything** — see open question c.
