# DRAFT — Seed round 3: "The Runar"

> **Working document — all rulings received 2026-09-27; ready to seed.** §5's proposals are ruled
> on: only P3 (`species`) is approved, and it is in `registry.ts` and the reference tables. The
> `description` attribute has since been removed (decision 12), so the tables stand at 12 entity
> types, 72 predicates, 254 signatures. The `loadSeed` fix (open question f) has landed. One
> optional follow-up remains in open question c (a hand-entered Enuarak→Enua link). Not yet in
> the database.

Source: `The Runar`, Drive id `1pngPgMdvZf7yClZznYTYbbSXq_BeEXYm9B79iDN8Scg`
(documents row `f41ff279-1013-4305-84a4-f69c8fb2f18e`), 29 paragraphs (¶0–¶28), ~8.6k chars /
~2,100 tokens, exported 2026-09-27. No existing `claim_sources` for this document.

An ethnographic article on the peoples of the Frost Gulf: their origin and settlement of Elduin,
the four tribes (Eldi, Suedi, Tvars, Atarks), their neighbours, a three-world cosmology, the
sacred Tvarid Spruce, the Giving Ceremonies, and a short note on religion. Paragraph split is
clean and citable (ordinary headings + prose; three multi-bullet paragraphs — ¶17, ¶20, ¶25 —
each hold a whole bulleted list under one `[¶n]`).

Where *Written Map* was geography and *The Kaldian Empire* was politics, this document is
**culture and belief**: no characters, no dates beyond two, no offices, no named events. It
stresses the part of the ontology built for peoples, customs, and religion — and mostly finds it
thin. Roughly half the document's content (cosmology, the Tvarid Spruce, the Giving Ceremonies,
cultural influence, inter-tribal trade) has no home in the current vocabulary; see §3–§5.

---

## 1. Decisions (proposed — none ratified yet)

| # | Decision |
| --- | --- |
| 1 | **The Runar are a `culture`, not a `society`.** ¶5: "The Runar are not one people but four, sharing a common root". There is no polity; the name is an umbrella over four peoples. `culture` ("may span societies") is the fit. |
| 2 | **The four tribes are `society`s**, each joined to the Runar by `practices` (society→culture). ¶3 calls the Eldi "the tribe", and `society`'s description names "tribe". Each tribe's *distinct* culture (¶5 "shaped into distinct cultures") is left to its `summary` rather than minted as four more `culture` entities, because no predicate relates a sub-culture to its parent culture (see open question b). |
| 3 | **"Frost Gulf" in ¶1, ¶19, ¶22 is the land, i.e. `Runara`**; in ¶7 ("between the Frost Gulf and the Orosh Mountains", "maritime trade within the gulf itself") it is the water, `Frost Gulf`. Round-1 decision 16 applied as-is. ¶1's "coastland dominated by iconic temperate rainforests" therefore attaches to `Runara`. |
| 4 | **`Runar Basin` is its own region, located in `Runara`.** *(Ratified — was open question a.)* |
| 5 | **Runyar is a name variant of the Runar culture.** ¶3: "effectively the same culture: Runyar is a cognate of Runar". Aliases are variants, not claims (Kaldia decision 4). |
| 6 | **The Enu are a `culture`; Enuarak is the `society`** that practises it. *(Ratified.)* The text says "Enuarak" for the polity (¶7, ¶17) and "the Enu" for the people and their ideas (¶7 "contact with the Enu", "Enu religious ideas"). `Enuarak —practices→ Enu`. Neither is equated with the round-1 region `Enua` — see open question c. |
| 7 | **No entity name takes a leading "The"; names are title case; peoples are plural.** *(Ratified as a skill convention.)* `Eldi`, `Suedi`, `Tvars`, `Atarks`, `Kazavs`, `Runar Religion`. Existing entities were renamed to match (`Doom`, `Dragon's Shroud`, `Interior`, …). `Tvars` carries `Tvar` as a variant (¶20 "Tvar burial"). |
| 8 | **Habitation is `located_in`, not `rules`.** "the Eldi of the Amber Coast" says where a people lives, not that it holds sovereignty; the text never claims political control of land. `located_in` (society→region) is the Kaldian Empire→Elduin precedent. |
| 9 | **Named geographic descriptors that are not proper names are not entities**: "the deep inland forest" (Tvars), "the eastern forest-steppe frontier" (Atarks), "the monster-infested tundra to the north" (Kazavs), "the southern mountains". Same rule as round 1's unnamed steppe tribes. |
| 10 | **`Steppe peoples` is not an entity.** ¶17 lists them, but it is a description ("Steppe peoples to the east"), not a name. Consequently nothing the Atarks absorbed from them is claimable. |
| 11 | **`Runar Religion` is a `religion`.** ¶28's heading and first sentence name it and characterise it at length (animist, no shared pantheon, three worlds, sacred groves). `Runar —worships→ Runar Religion` (culture→religion). The cosmology itself goes in its `summary`, not in claims (§3). |
| 12 | **Descriptions are entity `summary`s; there is no `description` claim.** *(Ratified — was open question h. The `description` attribute is removed from the registry.)* |
| 13 | **Kinds of living thing are `species`** *(P3, ratified)*. The Tvarid Spruce is a `species` (variant: Sky Posts), `located_in` Runara. |
| 14 | **Each tribe practises the shared Runar culture; no per-tribe cultures.** *(Ratified — was open question b.)* |
| 15 | **A bare year is AD unless context clearly says otherwise.** "The 400s" (¶10) is AD 400s. *(Ratified — was open question d.)* |
| 16 | **`located_in` carries no date.** The 2nd-century-BD crossing stays out of the location claim. *(Ratified — was open question e.)* |
| 17 | **A fact already seeded from another document is kept and cited here too.** `loadSeed` now adds this document as a second source. *(Ratified — was open question f.)* |

---

## 2. Open questions

**a. ✅ Resolved: a region inside Runara (decision 4).** ~~Runar Basin vs Runara.~~ Runara (round 1) is "the forested land around the Frost Gulf"; the
Runar Basin is where the Runar live, and ¶2 treats it as part of "this region" alongside "the
adjacent shorelands". Draft: separate region, `Runar Basin —located_in→ Runara` *(inferred)*.
Alternative: make "Runar Basin" a variant of `Runara` and drop the region. The names share a root,
which argues for the variant; ¶2's basin/shoreland distinction argues against.

**b. ✅ Resolved: shared culture only (decision 14).** ~~How do the four tribes' "distinct cultures" relate to the Runar?~~ The draft uses
`<tribe> —practices→ Runar`. That says "the Eldi are Runar" but loses "the Eldi have their own
culture". Modelling four more cultures would need a culture→culture link (none exists). Accept the
loss, or see proposal P6?

**c. ✅ Identity resolved (decision 6); one optional follow-up.** Enuarak is not Enua — the Enu are
a culture and Enuarak its society. **Remaining:** should `Enuarak —located_in→ Enua` be added as a
hand-entered claim? Background — Is Enuarak the round-1 `Enua` (region, formerly Nethros)? Written Map: the peninsula was
renamed Enua after "the Enu Conquests"; here the Enu of Enuarak lie "beyond the southern
mountains", and round 1 put the Orosh Mountains in Enua. Strongly suggests `Enuarak —located_in→
Enua`, but this document never says "Enua", so it is not claimed. Worth a hand-entered
(`created_by = 'user'`) cross-document link if you agree.

**d. ✅ Resolved: AD (decision 15).** ~~When is "the 400s" in ¶10?~~ "a period of climate warming beginning in the 400s ... triggering
a period of migration and war. These pressures have made the Suedi the most militant ...
exemplified in their invasion of Elduin shortly before the Doom." The causal chain reads as **BD
400s**, but a bare year defaults to AD. Not claimed (the warming is unnamed), but an extractor
may date it; `ordinalFor('400s')` returns **399** (AD 400) silently — the "s" is ignored rather
than treated as a century/decade range.

**e. ✅ Resolved: no date (decision 16).** ~~`startTime` on a non-temporal predicate.~~ `Runar —located_in→ Elduin` carries
`startTime: '2nd century BD'` (¶2 "crossed onto the island of Elduin in the 2nd century BD").
`located_in` is not flagged `temporal`. Nothing forbids the column, and the date is a stated
start — but confirm this is wanted rather than dropping the date.

**f. ✅ Resolved: loader fixed (decision 17).** ~~Cross-document duplicate claims will lose their source.~~ Two
claims here already exist from round 1: `Runara climate = temperate_rainforest` (¶1) and
`Elduin landform = island` (¶2). `loadSeed` inserts with `onConflictDoNothing()` and **skips the
`claim_sources` insert when the claim already exists**, so The Runar would get no source row for
them — the step-9 check "`claim_sources` count equals claim count" would fail by 2, and scoring for
this document would never see them. Step 7 says to "collapse" such duplicates, which drops them
from this document's ground truth. Decide: (i) drop them from this seed (current rules), or (ii)
change `loadSeed` to attach a `claim_sources` row to the existing claim (recommended — the fact is
genuinely stated in both documents and an extractor reading this one should be credited for it).

**h. ✅ Resolved: `summary` only (decision 12).** ~~Entity `summary` vs `description` claims.~~

**g. Internal timing tension (no action, noted for Phase 3).** ¶2 dates the crossing to Elduin to
the 2nd century BD; ¶8 says Eldi shamans drove the crossing "in pre-history ... in anticipation of
the Doom"; ¶10 has the Suedi invading Elduin "shortly before the Doom". Compatible if "pre-history"
means "before records", but an extractor may date the ¶8 migration differently.

---

## 3. What the vocabulary cannot say

The document's second half is cosmology and custom. None of the following is claimed; each is a
logged gap, and §5 proposes changes for the ones with real evidence.

| Content | ¶ | Why unclaimed |
| --- | --- | --- |
| **The Tvarid Spruce / Sky Posts** — the sacred tree, "king of trees", "the one point of shared religious reverence" | 19, 22, 25 | A species of tree. Not a `commodity` (rarely harvested), not an `artifact`, not a `deity` (revered, but not a being). **No type for a natural kind (flora/fauna).** P3. |
| **The Three Worlds** — Upper World, Walked World, Underworld | 19, 20 | Places that exist in belief. `region` is "a geographic area"; forcing them in would put the Underworld on the map. P5. |
| **The Giving Ceremonies** — named custom practised by all four tribes in different forms | 24–26 | A single named custom. `culture` is "a shared body of custom"; `event` is "a bounded happening". Neither fits cleanly. P2. |
| **Trade between named peoples** — Suedi↔Eldi, Suedi↔Kazavs, Eldi↔Enuarak | 7, 10, 17 | `trades_with` was dropped in round 1 (decision 12). P1. |
| **Cultural/religious influence** — Enu ideas on the Eldi; steppe horse culture and religion on the Atarks | 7, 14, 17 | No `influenced_by`. P4. |
| **Descent of peoples** — the Runar from the first settlers; the Elduinian settlers from the Eldi; "Runyar is a cognate of Runar" | 2, 3, 8 | No descent/origin predicate between peoples. P6. |
| **The Suedi invasion of Elduin**; the migration to Elduin; the ¶10 warming and wars; the rising of the Shroud | 3, 8, 10 | Real events, all unnamed — same rule as Kaldia's "a period of civil war". |
| **Burial customs** (sea, lake/bog, sky) per tribe | 20 | Prose; goes in each tribe's `summary`. |
| **Economic character other than mercantile** — Suedi "raiding", Tvars "subsistence stockpiling", Kazavs "hunter-gatherer" | 7, 17, 25 | `economy` enum is `agrarian · pastoral · mercantile · maritime`. Corroborates the deferred *`economy` enum breadth* item — second document now. |
| **Dragon's Shroud severing contact** ("now permanently cut off by the Dragon's Shroud") | 3, 17 | No "separates" predicate. |

---

## 4. The alias/matcher cases this document creates

- **"Frost Gulf"** is used in both senses again (decision 3) — a second document exercising the
  round-1 ambiguity.
- **Eldi / Elduin / Elduin Dynasty.** ¶3: "the name Elduin itself derives from the Eldi". Three
  distinct entities (society, region, faction) with near-identical normalized names — a near-miss
  case, not an ambiguity; the matcher should suggest, never match.
- **Enu / Enua / Enu Conquests / Enuarak.** The culture `Enu` sits one letter from the region
  `Enua`: a near-miss, not an ambiguity — the matcher should suggest, never match.
- **Runar / Runara / Runar Basin / Runyar.** Four strings, three entities, one root.

---

## 5. Proposed registry changes

Each is independent; approve or reject individually. Claims each would unlock are in §7's
*Conditional claims*.

**P1. Reopen `trades_with`** — symmetric, temporal; pairs `society↔society`, `society↔settlement`,
`settlement↔settlement`, `faction↔faction`, `faction↔society`.
Evidence: ¶10 "trading regularly with the Eldi to their south"; ¶10/¶17 "includes both trade and
open conflict" / "in intermittent trade and conflict with the Suedi"; ¶17 "in sustained trade and
cultural contact with the Eldi". Round 1 dropped it because Written Map's trade content was about
regions *sitting between* others, with no named trading partners. This is the counter-case: three
explicit, named, bilateral trade relationships.
**Recommend: approve.** Three clean claims; the round-1 objection does not apply.

**P2. The Giving Ceremonies — a home for a named custom.** Options: (a) widen `culture`'s
description to "a shared body of custom, language, and practice — or a named custom or rite —
which may span societies", then `Tvars/Suedi/Atarks/Eldi —practices→ Giving Ceremonies`;
(b) add a `custom` / `tradition` entity type with `practices` extended to it; (c) leave unmodelled.
Evidence: ¶24 "The practice is oldest and most elaborate among the Tvars, and each of the other
three peoples has reshaped it"; ¶25 per-tribe forms.
**Recommend: (c) defer**, low confidence. (a) blurs `culture` (a whole way of life) with a single
rite, which will make extraction choose inconsistently between the two; (b) is an entity type on
one document's evidence. Log in *Deferred vocabulary*. If you prefer (a), the four `practices`
claims are drafted.

**P3. A natural-kind entity type (flora/fauna)** — e.g. `species` / `organism`: "a kind of living
thing — a plant, animal, or monster — as opposed to an individual". Would take `located_in`
(→region) and be a possible object of reverence.
Evidence: ¶19 "the Sky Posts: towering Tvarid Spruce trees, the largest living things in the Frost
Gulf"; ¶22 "regarded as the king of trees by all four Runar peoples". Also Kaldia's monsters (¶17
there) and the Suedi's monsters (¶10 here), both currently only reachable as the commodity
`Monster Parts`.
**Recommend: defer**, but flag as the strongest gap in this document. It would unlock only one
claim here (`Tvarid Spruce —located_in→ Runara`) because reverence of a non-religion has no
predicate either; worth doing when a document names a creature that acts in its history.

**P4. `influenced_by`** (culture/society → culture/society/religion).
Evidence: ¶7 "Sustained contact with the Enu has made the Eldi the most materially developed ...
Enu religious ideas have had some influence as well"; ¶14/¶17 Atarks and steppe horse culture.
Only one claim is expressible (`Eldi —influenced_by→ Enuarak`) because the steppe side is unnamed.
**Recommend: defer.** One claim; a vague predicate with a high false-positive risk in extraction.

**P5. Belief-only / cosmological places** (the Three Worlds). Either a flag on `region`, or a new
type.
**Recommend: reject for now.** Keep cosmology in `Runar Religion`'s summary. Mythic geography is
a real pattern but one paragraph is thin evidence, and a region you cannot travel to would pollute
every `located_in` query.

**P6. `descended_from`** (society/culture → society/culture) — ethnogenesis.
Evidence: ¶2 "these settlers eventually came to be known as the Runar"; ¶3 "the Eldi, the tribe
from whom the first Elduinian settlers descended"; ¶5 "sharing a common root". Would also answer
open question b.
**Recommend: defer.** The only named pair it would connect here is Eldi → (unnamed Elduinian
settlers); the cross-document payoff (Kaldians ← Runyar ← Eldi) is not stated anywhere.

### Registry changes, collected

| # | Change | Kind | Recommendation | Status |
| --- | --- | --- | --- | --- |
| P1 | `trades_with` reinstated | add | approve | ⬜ deferred — with all economic relationships |
| P2 | Home for named customs | edit or add | defer | ⬜ deferred |
| P3 | `species` entity type (flora/fauna), `located_in` → region | add | defer | ✅ approved, landed |
| P4 | `influenced_by` | add | defer | ⬜ deferred |
| P5 | Cosmological / belief-only places | add | reject | ⬜ deferred (not rejected) — likely a unified belief-concept type with deities later |
| P6 | `descended_from` | add | defer | ⬜ deferred |
| — | `economy` enum breadth (raiding, subsistence, hunter-gatherer) | — | stays deferred; second corroborating document | ⬜ deferred |
| — | `loadSeed` attaches `claim_sources` to an already-existing claim | code, not registry | approve | ✅ approved, landed |

---

## 6. Conventions questions this document raised

(For the skill, not the registry.) Leading articles on names (decision 7); `summary` vs
`description` claims (decision 12); `startTime` on non-temporal predicates (open question e);
cross-document duplicate claims (open question f).

---

## 7. The catalog

Quotes are verbatim substrings of the cited rendered paragraph, and avoid `**` bold markers and
curly apostrophes. *(reading)* = faithful interpretation; *(inferred)* = a further step, drop if
too far. Summaries are proposed for every new entity (decision 12).

### Entities (20 new-or-claimed + 4 referenced)

**Cultures (2)** — Runar *(variant: Runyar)*, Enu

**Societies (6)** — Eldi, Suedi, Tvars *(variant: Tvar)*, Atarks, Kazavs, Enuarak

**Regions (5)** — Runara \*, Elduin \*, Runar Basin, Amber Coast, Blighted Shore

**Religions (1)** — Runar Religion

**Species (1)** — Tvarid Spruce *(variant: Sky Posts)*

**Commodities (5)** — Amber, Furs, Medicinal Goods, Metalwork, Luxury Goods

**Characters, factions, settlements, events, artifacts, deities (0)** — none named.

> \* Reused from round 1 by exact name. **Referenced but unclaimed**, also existing: `Frost Gulf`
> (¶7, water sense), `Orosh Mountains` (¶7), `Doom` (¶2, ¶8, ¶10), `Dragon's Shroud` (¶1,
> ¶3, ¶7, ¶17, ¶20). No new claims attach to them; they need not be in the seed's entity list.

Proposed summaries:

| Entity | Summary |
| --- | --- |
| Runar | The peoples of the Frost Gulf: four tribes sharing a common root, settled across the Runar Basin since Antiquity. The Runyar of Elduin are the same culture. |
| Eldi | Runar people of the Amber Coast; mercantile, in sustained contact with Enuarak, dominant in gulf maritime trade. Buries at sea. |
| Suedi | Runar people of the Blighted Shore; the most militant of the four, shaped by monsters and the Kazavs to the north. Invaded Elduin shortly before the Doom. |
| Tvars | The most conservative and insular Runar people, of the deep inland forest; prosperous producers of amber, furs, and medicinal goods. Bury in lakes and bogs. |
| Atarks | Runar people of the eastern forest-steppe frontier, heavily influenced by steppe horse culture; believe the dead rise to the Upper World. |
| Kazavs | Hunter-gatherer tribes of the monster-infested tundra north of the Suedi. |
| Enuarak | The society of the Enu, beyond the mountains south of the Eldi; the main channel of metalwork, luxury goods, and religious ideas into the Runar Basin. |
| Enu | The culture of Enuarak, whose religious ideas have influenced the Eldi. |
| Runar Basin | The river basin inhabited by the Runar. |
| Amber Coast | Coast of the Eldi, between the Frost Gulf and the Orosh Mountains. |
| Blighted Shore | Northern coast of the Suedi, named for the monsters of the tundra beyond it. |
| Tvarid Spruce | The tallest and oldest living thing in the Frost Gulf; revered by all four Runar peoples as the Sky Posts that hold up the Upper World. Rarely felled, and only with ritual apology. |
| Runar Religion | Animist and decentralised: holy groves, river and animal spirits, the stars; a three-world cosmology (Upper, Walked, Underworld) with the Tvarid Spruce as the Sky Posts. No shared pantheon. |
| Amber, Furs, Medicinal Goods, Metalwork, Luxury Goods | *(none)* |

### Claims (27)

| ¶ | Claim | Quote / note |
| --- | --- | --- |
| 1 | `Runara climate = temperate_rainforest` | "a cold and wet coastland dominated by iconic temperate rainforests" *(decision 3; **duplicate of round-1 claim**, open question f)* |
| 1 | `Runara landform = coast` | "a cold and wet coastland dominated by iconic temperate rainforests" *(reading — "coastland")* |
| 2 | `Runar —located_in→ Runar Basin` | "until they inhabited the entire Runar Basin" *(culture→region)* |
| 2 | `Runar —located_in→ Elduin` | "crossed onto the island of Elduin in the 2nd century BD" *(no date — decision 16)* |
| 2 | `Elduin landform = island` | "crossed onto the island of Elduin in the 2nd century BD" *(also seeded from round 1 — cited here as a second source, decision 17)* |
| 2 | `Runar Basin landform = basin` | "until they inhabited the entire Runar Basin" *(reading — from the name)* |
| 2 | `Runar Basin —located_in→ Runara` | "until they inhabited the entire Runar Basin, the adjacent shorelands" *(reading — "this region" is the ¶1 coastland; ratified, decision 4)* |
| 5 | `Eldi —practices→ Runar` | "Today, the Runar are divided into four peoples" *(reading — decision 2)* |
| 5 | `Suedi —practices→ Runar` | same quote *(reading)* |
| 5 | `Tvars —practices→ Runar` | same quote *(reading)* |
| 5 | `Atarks —practices→ Runar` | same quote *(reading)* |
| 5 | `Eldi —located_in→ Amber Coast` | "of the Amber Coast" *(decision 8)* |
| 5 | `Suedi —located_in→ Blighted Shore` | "of the Blighted Shore" *(decision 8)* |
| 5 | `Amber Coast landform = coast` | "of the Amber Coast" *(reading — from the name)* |
| 5 | `Blighted Shore landform = coast` | "of the Blighted Shore" *(reading — from the name)* |
| 7 | `Amber Coast —located_in→ Runar Basin` | "more commonplace here than elsewhere in the Runar Basin" *(reading — "here" is Eldi land)* |
| 10 | `Blighted Shore —located_in→ Runar Basin` | "The Suedi occupy the northern edge of the Runar Basin" *(reading)* |
| 10 | `Suedi —enemy_of→ Kazavs` | "Their relationship with the northern hunter-gatherers (the Kazavs) includes both trade and open conflict" *(reading — intermittent, alongside trade; ¶17 "in intermittent trade and conflict with the Suedi")* |
| 12 | `Tvars —produces→ Amber` | "they produce the finest amber, furs, and medicinal goods" |
| 12 | `Tvars —produces→ Furs` | same quote |
| 12 | `Tvars —produces→ Medicinal Goods` | same quote |
| 17 | `Eldi —imports→ Metalwork` | "the main channel through which metalwork, luxury goods, and outside religious ideas reach the Runar Basin" *(inferred — the channel is Enuarak's contact with the Eldi; the Eldi as importer is a step)* |
| 17 | `Eldi —imports→ Luxury Goods` | same quote *(inferred)* |
| 25 | `Eldi economy = mercantile` | "whose mercantile economy runs on trade rather than raiding" *(also ¶7 "Eldi society is comparatively mercantile")* |
| 22 | `Tvarid Spruce —located_in→ Runara` | "The Tvarid Spruce is the tallest and oldest living thing in the Frost Gulf" *(decision 13; Frost Gulf = the land, decision 3)* |
| 7 | `Enuarak —practices→ Enu` | "Sustained contact with the Enu" *(reading — decision 6: the people of Enuarak, named in the same paragraph)* |
| 28 | `Runar —worships→ Runar Religion` | "Runar religion is not a unified institution" *(reading — decision 11)* |

**27 claims across 20 entities** — the thinnest document per character so far, by design of the
vocabulary rather than the text: most of it is cosmology and custom (§3).

### Conditional claims (held for deferred proposals — not seeded this round)

Kept so the evidence is not lost when a proposal is revisited. The three `trades_with` claims
(P1: ¶10 Suedi→Eldi, ¶17 Suedi→Kazavs, ¶17 Enuarak→Eldi) are listed in §5 P1.

| Proposal | ¶ | Claim | Quote |
| --- | --- | --- | --- |
| P2(a) | 24 | `Tvars —practices→ Giving Ceremonies` | "The practice is oldest and most elaborate among the Tvars" |
| P2(a) | 24 | `Suedi` / `Atarks` / `Eldi —practices→ Giving Ceremonies` | "each of the other three peoples has reshaped it" |
| P4 | 7 | `Eldi —influenced_by→ Enuarak` | "Sustained contact with the Enu has made the Eldi the most materially developed" |

### Deliberately not claimed

- **Comparatives** — "the most materially developed", "the most militant", "the most conservative
  and insular", "the tallest and oldest living thing", "the finest amber" (¶7, ¶10, ¶12, ¶22).
  Round 1 decision 10.
- **Eldi dominance of gulf maritime trade** (¶7) — no predicate; `economy = maritime` would
  contradict the stated `mercantile` in a functional enum.
- **Eldi located on Elduin / founding a stronghold** (¶8) — the stronghold is unnamed; the
  migrants are "part of their people", not the Eldi as a whole.
- **Tvars / Atarks / Kazavs location** — their lands are described, not named (decision 9).
- **Enuarak location** — "beyond the southern mountains"; no "beyond", and Enua is not named
  (open question c).
- **Everything in §3** — cosmology, the Tvarid Spruce, the Giving Ceremonies, influence, descent,
  unnamed events, burial customs, the Shroud's severing of contact.
- **Eldi "something closer to a true pantheon"** (¶28) and **"spirits and minor deities number in
  the hundreds"** — no deity is named, so the `deity` type stays unexercised.
- **"Runyar is a cognate of Runar" / Elduin's name from the Eldi** (¶3) — etymology; the first
  becomes a variant (decision 5), the second is prose.
- **`located_in Runara` for the Amber Coast and Blighted Shore** — derivable through Runar Basin;
  not re-stated.
