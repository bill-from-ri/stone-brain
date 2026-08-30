# DRAFT — Seed round 2: "The Kaldian Empire"

> **Working document, nothing locked in.** Scratch space for the second hand-seeded document —
> proposed entities and claims for ground truth, and the ontology changes this document argues for.
> Fold the settled parts into `ontology-design.md` and `registry.ts`, then delete this file.

Source: `The Kaldian Empire`, 24 paragraphs (¶0–¶23), ~8.3k chars / ~2,070 tokens, exported 2026-08-30.
A wiki-article on the largest nation on Elduin — its history, government, factions, culture, and economy.
Recovered from a single wiki-layout table cell by `splitLayoutTable` (§2); the paragraph split is
clean and citable.

Where *Written Map (1012)* was almost pure geography and said nothing about people or politics, this
is the mirror image: it exercises the **80% of the vocabulary built for people, factions, offices,
events, and trade** that round 1 seeded largely unused. Between the two documents the ground-truth
set now spans both halves of the ontology.

> **Status: written 2026-08-30.** The §6 registry changes are in `registry.ts` and the reference
> tables (`npm run db:seed` → 11 entity types, 73 predicates, 263 signatures). The catalog is loaded —
> **43 entities (41 new + Elduin and Grain reused from round 1), 60 claims, 60 sourced quotes** — via
> `npm run db:seed:kaldia`. The data lives in `src/lib/ontology/seed-kaldia.ts`; re-running is a no-op.
> The claim count is 60 rather than the ~55 sketched below because grouped rows (e.g. "produces
> hide / wool / milk") expand to one claim each. This is the hand-label the extraction agents are scored against.

---

## 1. Decisions (ratified)

| # | Decision |
| --- | --- |
| 1 | **Dynasties are `faction`s.** The Kalduin, Skrimir, and Elduin Dynasties are ruling houses — the registry's `faction` description already names "house". They `rules` a region (¶3) and succeed one another (decision 2). |
| 2 | **`successor_of` regains `faction → faction`.** Round 1 narrowed it to character→character; this document is the counter-evidence that argument anticipated — a dynastic succession chain with no dates. See §3. |
| 3 | **A state controlling a region is `rules`, not `located_in`.** A `society` cannot sit `located_in` a `society`, and a `region` cannot sit `located_in` a `society`. So "the Empire covers the Kaldian Vale, Thalgia, …" (¶1) is `Kaldian Empire —rules→ <region>`. Only `Kaldian Empire —located_in→ Elduin` (society→region) is geographic. |
| 4 | **Aliases are name variants of one entity, not claims.** "Imperial Kaldia", "Kaldia", "the Empire" (¶1) become variants of the Kaldian Empire. One alias — "the Kalduin Dynasty" — is **also** a distinct faction, reproducing the Frost Gulf/Runara ambiguity on purpose. See §4. |
| 5 | **Political alliances are `faction`s inside the society.** The Conservatives and Iconoclasts (¶11–12) are `faction`, joined to the Empire by `member_of` (faction→society). *(May be revisited; fine for now.)* |
| 6 | **The Kaldian people are a `culture`.** "Kaldian culture", "Kaldian heritage" (¶13) → one `culture` entity, `Kaldian Empire —practices→ Kaldian culture`. |
| 7 | **Bare years are AD.** 918, 935, 992 parse as AD via the calendar's default-era rule (`parseWorldDate`, "none … means AD"). No hand-conversion. |
| 8 | **The infobox (¶7) is labelled by positional alignment.** Google flattened the label row and value row into "… Emperor Prime Minister Margrave Ludwig II Kalduin Wilhelm Baelestir Aldo Demard …". Intended pairing: Emperor→Ludwig II, Prime Minister→Wilhelm Baelestir, Margrave→Aldo Demard. The document's hardest extraction case. |
| 9 | **Administrative subdivisions are their own `society`s within the parent society.** The Duchy of Korsburg and Province of Innenbeck become `society`, tied to the Empire by `serves` (decision 11). *(Was open question b.)* |
| 10 | **No `economy` claim from this document.** The value is unspecified — the Empire is agrarian, industrial, and extractive at once, and the enum forces one. Left unset; to be added by hand later if wanted. *(Was open question a.)* |
| 11 | **`serves` widens to `society → society`.** Carries both true vassalage — Swadia "under the aegis of the Empire" (¶5) — and the subdivision-within-state relationship (decision 9). See §5. |
| 12 | **`language` becomes an attribute of `society` and `culture`** (not region). "Official language Common" (¶7) → `Kaldian Empire language = "Common"`. See §5. |
| 13 | **`deity` is added as an entity type**, with a relationship equating a deity to the real character it may be. Not exercised by this document — no deity is named — but ratified here. See §5b. |
| 14 | **The Dark Age is an `event`.** Eras are modelled as events with start/end dates. This document gives none, so it is an `event` with a `description` only. *(Was open question d.)* |

---

## 2. Deferred (acknowledged, out of scope for now)

- **Currency and coinage.** ¶20 names five coins and their denominations, and ¶20 has Swadia
  adopting imperial currency across a border — a real `imports`-shaped relationship. Wanted
  eventually, explicitly **not now**: no coin entities, no currency attribute, and the
  Swadia-adopts-currency claim is dropped rather than forced.
- **`economy` enum breadth.** Whether *industrial* / *extractive* return to the enum is a real
  question this document raises (decision 10) but a later, corroborating document should settle.
- **Final name of the deity↔character predicate** (§5b). Working name only until a document that
  actually names a deity exercises it.

---

## 3. `successor_of`, reopened for factions

Round 1 narrowed `successor_of` to **character → character**, and predicted the case that would
reopen it:

> "succession is often known when dates are not — 'Sera's successor was Kaine' appears constantly in
> worldbuilding prose with no year attached."

This document is that case at the level of houses. ¶2–3 give a succession chain — Elduin → … →
Skrimir → Kalduin — carrying **no regnal dates**, so no set of `rules` windows can recover the
order. The only faithful encoding is `Kalduin Dynasty —successor_of→ Skrimir Dynasty` between two
`faction`s.

**Ratified (decision 2):** add the `faction → faction` signature to `successor_of` / `predecessor_of`.
`society → society` stays out — the vagueness round 1 objected to was "successor *state*", and
dynasties are houses, not states.

---

## 4. Aliases and the alias/faction collision

¶1: "The Kaldian Empire, also referred to as Imperial Kaldia, the Kalduin Dynasty, Kaldia, or simply
the Empire, …"

- **Kaldian Empire** — variants: *Imperial Kaldia*, *Kaldia*, *the Empire*.
- **the Kalduin Dynasty** — a variant of the Empire **and** the name of the ruling house, its own
  `faction` that `rules` the Vale (¶3) and succeeds the Skrimir Dynasty (§3). Resolving "the Kalduin
  Dynasty" should return **two** candidates, deliberately — the second live exercise of the matcher's
  ambiguous path, after round 1's *Frost Gulf / Runara*.

---

## 5. Vocabulary changes

### a. `serves`, `language`, subdivisions

- **`serves` → `society → society`** (decision 11). The current `serves` pairs already include
  `character → character`, `character → faction`, `character → society`, `faction → society`, and
  `faction → character` — so the only missing signature the request named is `society → society`,
  which this adds. It carries Swadia's vassalage (¶5) and the Korsburg/Innenbeck subdivisions (¶8, ¶16, ¶19).
- **`language`** — new string attribute, subjects `society` and `culture` only (decision 12).
- **Subdivisions as societies** (decision 9). The Duchy of Korsburg and Province of Innenbeck are
  typed `society`; `produces` (society→commodity) and `located_in` (society→region) both already
  accept them, so no further change is needed for their claims.

### b. `deity` entity type

Ratified (decision 13): a `deity` type for gods, saints, and other worshipped beings, plus a
relationship equating a deity to the real character it may be — because some deities are real
characters (a hero later worshipped) and others are pure belief.

- **Proposed predicate:** `deity —incarnation_of→ character` (working name), inverse
  `character —deified_as→ deity`. Optional by nature: a purely-believed deity simply has no such
  claim.
- **Not exercised here.** This document names the religions *Western Syrathism* and *Classical
  Syrathism* but not their deity, so no `deity` entity or claim is produced. The type is seeded
  unused, exactly as `commodity` was in round 1 — it is there for the document that names a god.
- **Cross-document consequence to note:** *Written Map* seeded **Syrath** as a `character` (the
  dragon). When a document venerates him, that is where a `deity` "Syrath" and a
  `deified_as` link to the existing character would land. Flagged for the matcher, not claimed now.

---

## 6. Registry changes, collected

| Change | Kind | Status |
| --- | --- | --- |
| `successor_of` / `predecessor_of` gain `faction → faction` (§3) | edit | ✅ approved |
| `serves` gains `society → society` (§5a) | edit | ✅ approved |
| `language` attribute added (string; society, culture) (§5a) | add | ✅ approved |
| `deity` entity type added (§5b) | add | ✅ approved |
| `incarnation_of` / `deified_as` (deity ↔ character), name pending (§5b) | add | ✅ approved, name TBD |
| Subdivisions typed as `society` — labelling convention (§5a) | convention | ✅ approved |
| Currency / coinage | — | ⬜ deferred (§2) |
| `economy` enum breadth (industrial/extractive) | — | ⬜ deferred (§2) |

The `character → {character, faction, society}` `serves` pairs the request also asked about **already
exist** and need no change.

---

## 7. The catalog

Proposed hand-label. Quotes are verbatim substrings of the cited paragraph. Claims marked
*(reading)* are faithful interpretations rather than direct quotes; *(inferred)* goes a step further
and should be dropped if that step is too far. `description` is proposed on every entity and not
listed individually.

### Entities (~43)

**Societies (4)** — Kaldian Empire *(variants: Imperial Kaldia, Kaldia, the Empire; also Kalduin Dynasty — see §4)*, Kingdom of Swadia, Duchy of Korsburg, Province of Innenbeck

**Regions (9)** — Elduin \*, Kaldian Vale, Thalgia, the Interior, the Pale, Hinter Coast, Riftwald Forest, Breakback Cliffs, Farrock Hills

**Settlements (1)** — Hrimfall

**Characters (6)** — Ludwig I Kalduin, Ludwig II Kalduin, Lukas Kalduin, Edith Akadon, Wilhelm Baelestir, Aldo Demard

**Factions (6)** — Imperial Assembly, Conservatives, Iconoclasts, Kalduin Dynasty, Skrimir Dynasty, Elduin Dynasty \*

**Religions (2)** — Western Syrathism, Classical Syrathism

**Cultures (1)** — Kaldian culture

**Events (2)** — the Pale War, the Dark Age *(description only — no dates given; §1.14)*

**Deities (0)** — none named; the type is added for the Syrath link (§5b)

**Commodities (~10)** — grain, hide, wool, milk, lumber, ore, quarried stone, monster parts, weapons, tools

**Artifacts (2)** — the Imperial Charter, the Coat of Arms

> \* **Elduin** (region) and **Syrath** (character behind the two Syrathisms) already exist from
> *Written Map*. `Kaldian Empire —located_in→ Elduin` is a direct cross-document link and the first
> ground-truth test of the matcher resolving an entity across two documents. Note also the near-clash
> between the region **Elduin** and the faction **Elduin Dynasty** — distinct entities, and a matcher
> case in their own right, like *Kaldian Empire / Kalduin Dynasty* (§4).

### Claims

| ¶ | Claim | Quote / note |
| --- | --- | --- |
| 1 | `Kaldian Empire —located_in→ Elduin` | "the largest nation on Elduin" |
| 1 | `Kaldian Empire —rules→ Kaldian Vale` | "It covers most of the island's western half, including the Kaldian Vale" *(reading — §1.3)* |
| 1 | `Kaldian Empire —rules→ the Interior` | "the Kaldian Vale, Thalgia, the Interior" *(reading)* |
| 1 | `Kaldian Empire —rules→ the Pale` | "the Interior, the Pale" *(reading)* |
| 1 | `Kaldian Empire —rules→ Hinter Coast` | "and much of the Hinter Coast" *(reading)* |
| 2 | `Ludwig I Kalduin —founded→ Kaldian Empire` | "The Kaldian Empire was founded in 918 by Ludwig I Kalduin" |
| 2 | `Kaldian Empire founded_on = 918` | "founded in 918" *(AD)* |
| 2 | `Ludwig I Kalduin —founded→ Imperial Assembly` | "Ludwig I signed the Imperial Assembly into existence" |
| 2 | `Skrimir Dynasty dissolved_on = 918` | "a period of civil war that ended the Skrimir Dynasty" *(reading — end dated to the founding year)* |
| 3 | `Ludwig I Kalduin —founded→ Kalduin Dynasty` | "Ludwig I's ascension marked the beginning of the Kalduin Dynasty" |
| 3 | `Kalduin Dynasty —rules→ Kaldian Vale` | "the fourth dynasty to rule the Kaldian Vale" *(faction→region)* |
| 3 | `Kalduin Dynasty —successor_of→ Skrimir Dynasty` | "ended the Skrimir Dynasty" + "the fourth dynasty to rule" *(needs §3 change)* |
| 4 | `Lukas Kalduin —married_to→ Edith Akadon` | "a marriage alliance between Prince Lukas Kalduin and Princess Edith Akadon" *(start_time 935)* |
| 4 | `Lukas Kalduin title = Prince` | "Prince Lukas Kalduin" |
| 4 | `Edith Akadon title = Princess` | "Princess Edith Akadon" |
| 4 | `Kaldian Empire —rules→ Thalgia` | "added Thalgia to the Empire" *(start_time 935; the only Thalgia rule-claim — supersedes the ¶1 territory mention)* |
| 5 | `the Pale War occurred_on = 992` | "In 992, the Empire won the Pale War" |
| 5 | `Kaldian Empire —participated_in→ the Pale War` | "the Empire won the Pale War" |
| 5 | `Kingdom of Swadia —participated_in→ the Pale War` | "the Pale War against the Kingdom of Swadia" |
| 5 | `the Pale War outcome = "the Empire won; Swadia ceded much of its territory to Kaldia"` | "the Kingdom ceded much of its territory to Kaldia" |
| 5 | `Kingdom of Swadia —serves→ Kaldian Empire` | "was placed under the aegis of the Empire" *(society→society, §5a)* |
| 7 | `Kaldian Empire motto = "Unite the realms."` | "Motto: Unite the realms." |
| 7 | `Hrimfall —capital_of→ Kaldian Empire` | "Capital Hrimfall" |
| 7 | `Kaldian Empire —worships→ Western Syrathism` | "Religion Western Syrathism" |
| 7 | `Kaldian Empire —worships→ Classical Syrathism` | "Classical Syrathism" *(worships non-functional; two state religions)* |
| 7 | `Kaldian Empire government_type = "Federal semi-constitutional monarchy"` | "Government Federal semi-constitutional monarchy" |
| 7 | `Kaldian Empire population = 2900000` | "Population Approx. 2.9 million" *(approx)* |
| 7 | `Kaldian Empire language = "Common"` | "Official language Common" *(§5a)* |
| 7 | `Ludwig II Kalduin title = Emperor` | infobox alignment, §1.8 |
| 7 | `Ludwig II Kalduin —rules→ Kaldian Empire` | Emperor = head of state (¶9) *(reading — §1.8)* |
| 7 | `Wilhelm Baelestir title = Prime Minister` | infobox alignment, §1.8 |
| 7 | `Kaldian Empire —owns→ the Coat of Arms` | "Kaldian Empire Nation Coat of Arms" *(reading)* |
| 8 | `Kaldian Empire —owns→ the Imperial Charter` | "the Imperial Charter, Kaldia's foremost legal document" |
| 9 | `Wilhelm Baelestir —leads→ Imperial Assembly` | "led by the Prime Minister" + infobox PM=Wilhelm *(reading, §1.8)* |
| 11 | `Conservatives —member_of→ Kaldian Empire` | "political alliances in the Empire are the Conservatives" |
| 11 | `Iconoclasts —member_of→ Kaldian Empire` | "and the Iconoclasts" |
| 12 | `Aldo Demard title = Count` | "Count Aldo Demard was made Imperial Margrave" *(until ~992)* |
| 12 | `Aldo Demard title = Imperial Margrave` | same quote *(from ~992; the only Margrave title-claim — supersedes the ¶7 infobox mention)* |
| 12 | `Aldo Demard —member_of→ Iconoclasts` | "the Iconoclasts have many members within the Kaldian military … after Count Aldo Demard was made Imperial Margrave" *(inferred)* |
| 13 | `Kaldian Empire —practices→ Kaldian culture` | "festivals to celebrate Kaldian culture" *(reading, §1.6)* |
| 16 | `Kaldian Vale —produces→ grain` | "The Kaldian Vale is a breadbasket … sources enough grain to feed an empire" |
| 16 | `Kaldian Vale —produces→ hide` / `wool` / `milk` | "a bountiful source of hide, wool, and milk" |
| 16 | `Kaldian Vale landform = valley` | "The Kaldian Vale" *(reading — a vale is a valley)* |
| 16 | `Duchy of Korsburg —produces→ lumber` | "Most imperial lumber is collected from the Duchy of Korsburg" *(society→commodity, §5a)* |
| 16 | `Duchy of Korsburg —serves→ Kaldian Empire` | subdivision of the Empire *(reading, §5a)* |
| 16 | `Breakback Cliffs —produces→ ore` / `quarried stone` | "its ores and quarried stone are primarily harvested from the Breakback Cliffs and Farrock Hills" |
| 16 | `Farrock Hills —produces→ ore` / `quarried stone` | same quote |
| 16 | `Farrock Hills landform = hills` | "Farrock Hills" *(reading)* |
| 17 | `the Interior —produces→ monster parts` | "the Interior is home to monsters whose exotic body parts often sell for high prices" |
| 17 | `Kaldian Empire —exports→ monster parts` | "sell for high prices in markets both within the Empire and abroad" *(reading — "abroad" = export)* |
| 18 | `Kaldian Empire —produces→ weapons` / `tools` | "provide both tools and weapons to its people" *(reading — industry → produces)* |
| 18 | `Riftwald Forest —located_in→ the Interior` | "the beasts of Riftwald Forest", in the Interior context *(reading)* |
| 18 | `Riftwald Forest climate = temperate_forest` | "Riftwald Forest" *(reading)* |
| 19 | `Province of Innenbeck —located_in→ the Interior` | "An important institution in the Interior … Hundreds of monster hunters work in the Province of Innenbeck" *(reading, society→region)* |
| 19 | `Province of Innenbeck —serves→ Kaldian Empire` | subdivision of the Empire *(reading, §5a)* |
| all | `description` on each entity | |

**~55 claims across ~43 entities** — roughly double *Written Map*'s density, which is the point: this
is the "stress" document of the pair. That density also means more labeller judgement (the *(reading)*
and *(inferred)* rows especially), and is the argument for pairing it with a smaller, cleaner document
rather than seeding it alone.

### Deliberately not claimed

- **Comparatives** — "the largest nation on Elduin", "the most influential faction", "most valued"
  (¶1, ¶18). No home; round 1 decision 10.
- **Declared enmity with Swadia** — "relations with the lords of Swadia remain tense" (¶5) is too
  weak for `enemy_of`. The subordination *is* captured, as `serves`.
- **The founding civil war** (¶2) — a real event but unnamed; "a period of civil war" is not an
  entity name.
- **The fall of the Elduin Dynasty** (¶3) — captured as the succession in §3, not a separate event.
- **Currency and coinage** (¶7, ¶20) — deferred, out of scope (§2).
- **Cultural values** — "unity, military valor, patriotism, and respect for authority" (¶13); prose.
- **Social classes** — nobility, artisans, merchants, commonfolk (¶9, ¶21–23); strata, not entities.
- **Institutions named but undefined** — the Scales (¶8), the Church (¶9), the Upper and Lower
  Houses (¶9), the smithing and monster-hunting "industries" (¶18–19). Not characterised enough to seed.
- **Abolition of serfdom** (¶21) — an unnamed event; "serfdom was abolished at the start of the
  Kalduin Dynasty".
- **`located_in Elduin` for every region** — technically true, not useful; round 1 open question c.
