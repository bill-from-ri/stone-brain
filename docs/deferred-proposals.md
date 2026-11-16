# Deferred ontology proposals

Changes to the vocabulary that were proposed while hand-labelling a document, judged worth
having, and **deferred** by a human ruling — not rejected. Each keeps its evidence and the claims
it would unlock ("parked claims"), so that approving it later means landing the change and
seeding those claims, not re-reading the documents to find them again.

**Before proposing an ontology change, read this file.** A proposal already listed here must not
be made again. If a document you are labelling adds evidence for one, append it to that entry —
a new evidence line, and any new parked claims — rather than raising it as a proposal. The human
can revisit an entry at any time; nothing here is revisited on an agent's initiative.

Two neighbouring lists are **not** this file, and are not proposed either:

- *Deliberately not modelled* in [ontology-design.md](ontology-design.md) — judged out of scope
  (comparatives, purpose, causal links between places, …).
- *Modelling conventions* in the same file — settled rulings.

**No quotes here.** The documents are private, so evidence is cited by document and paragraph
and described in other words. The verbatim quotes, and each parked claim with its quote, are in
the local, gitignored `corpus/docs/deferred-proposals.md` — keep the two in step.

When an entry is approved: land the registry change, seed its parked claims into their
documents' seed modules, move any modelling ruling into *Modelling conventions*, and delete the
entry. When one is rejected outright: move it to *Deliberately not modelled* and delete it here.

---

## D1. Trade between societies — `trades_with` and other economic relationships

- **Proposed:** round 3 (*The Runar*, P1), 2026-09-27. Previously dropped in round 1, when
  *Written Map* named no trading partners.
- **Change:** `trades_with` — symmetric, temporal; `society ↔ society`, `society ↔ settlement`,
  `settlement ↔ settlement`, `faction ↔ faction`, `faction ↔ society`.
- **Deferred because:** trade and the other economic relationships between actors are to be
  modelled together, later (ruling 2026-09-27). See also D2.
- **Evidence:**
  - *The Runar* ¶10 — the Suedi trade regularly with the Eldi.
  - *The Runar* ¶17 — the Kazavs trade, and fight, with the Suedi on and off.
  - *The Runar* ¶17 — the Enuarak and the Eldi have long traded and swapped customs.
- **Parked claims:**

  | Document | ¶ | Claim |
  | --- | --- | --- |
  | The Runar | 10 | `Suedi —trades_with→ Eldi` |
  | The Runar | 17 | `Kazavs —trades_with→ Suedi` |
  | The Runar | 17 | `Enuarak —trades_with→ Eldi` |

## D2. Currency and coinage

- **Proposed:** round 2 (*The Kaldian Empire*), 2026-08-30.
- **Change:** undecided — coin entities, or a currency attribute on societies, plus a way to say
  one society adopted another's currency.
- **Deferred because:** part of the economy, modelled later with D1.
- **Evidence:**
  - *The Kaldian Empire* ¶20 — Kaldia's coinage has several denominations.
  - *The Kaldian Empire* ¶20 — Swadia took up the imperial currency after the Pale War.
- **Parked claims:** none drafted; no predicate shape was chosen.

## D3. Breadth of the `economy` enum

- **Proposed:** round 2 (*The Kaldian Empire*); corroborated in round 3 (*The Runar*).
- **Change:** add values beyond `agrarian · pastoral · mercantile · maritime` — candidates
  *industrial*, *extractive*, *raiding*, *subsistence*, *hunter-gatherer* — or allow more than one
  value per society.
- **Deferred because:** part of the economy, modelled later with D1. Until then a society whose
  economy is mixed or outside the enum gets no `economy` claim.
- **Evidence:**
  - *The Kaldian Empire* ¶16–¶18 — farming, mining and quarrying, and a large smithing industry,
    all at once.
  - *The Runar* ¶7 — an economy of trade, explicitly not raiding or subsistence.
  - *The Runar* ¶17 — hunter-gatherer tribes on the northern tundra.
- **Parked claims:** none — which value to use is the open question.

## D4. Named customs and rites

- **Proposed:** round 3 (*The Runar*, P2), 2026-09-27.
- **Change:** options were (a) widen `culture` to cover a single named custom; (b) a new
  `custom` / `tradition` entity type that societies `practices`; (c) leave unmodelled.
- **Deferred because:** (a) blurs a whole way of life with one rite; (b) is a new type on one
  document's evidence.
- **Evidence:**
  - *The Runar* ¶24 — the Giving Ceremonies are oldest among the Tvars, and the other three
    peoples each practise their own form.
  - *The Runar* ¶25 — per-tribe forms of the Giving Ceremonies.
- **Parked claims** (shape assumes option (a) or (b)):

  | Document | ¶ | Claim |
  | --- | --- | --- |
  | The Runar | 24 | `Tvars —practices→ Giving Ceremonies` |
  | The Runar | 24 | `Suedi —practices→ Giving Ceremonies` |
  | The Runar | 24 | `Atarks —practices→ Giving Ceremonies` |
  | The Runar | 24 | `Eldi —practices→ Giving Ceremonies` |

## D5. `influenced_by` between cultures and societies

- **Proposed:** round 3 (*The Runar*, P4), 2026-09-27.
- **Change:** `influenced_by` — culture/society → culture/society/religion.
- **Deferred because:** vague, and prone to false positives in extraction.
- **Evidence:**
  - *The Runar* ¶7 — contact with the Enu shaped the Eldi materially.
  - *The Runar* ¶7 — and religiously, to a lesser degree.
  - *The Runar* ¶14 — the Atarks took on much of a steppe horse culture (the steppe side is
    unnamed, so not claimable).
- **Parked claims:**

  | Document | ¶ | Claim |
  | --- | --- | --- |
  | The Runar | 7 | `Eldi —influenced_by→ Enu` |

## D6. `descended_from` between peoples and cultures

- **Proposed:** round 3 (*The Runar*, P6), 2026-09-27.
- **Change:** `descended_from` — society/culture → society/culture.
- **Deferred because:** no named pair in the evidence so far; the cross-document chain
  (Kaldians ← Runyar ← Eldi) is not stated anywhere.
- **Evidence:**
  - *The Runar* ¶2 — the settlers came to be called the Runar.
  - *The Runar* ¶3 — the first Elduinian settlers descended from the Eldi.
- **Parked claims:** none — the descendants in ¶3 are unnamed.

## D7. Belief-only places and concepts

- **Proposed:** round 3 (*The Runar*, P5), 2026-09-27.
- **Change:** a way to hold places and beings that exist in belief — likely a unified
  belief-concept type alongside or absorbing `deity`, rather than a flag on `region` (a region
  you cannot travel to would pollute every `located_in` query).
- **Deferred because:** wanted eventually, together with deities, not now (ruling 2026-09-27).
  Until then, cosmology goes in the religion's `summary`.
- **Evidence:**
  - *The Runar* ¶19 — a three-part cosmology: a world above the sky, the lived-in world, and an
    underworld.
- **Parked claims:** none drafted.

---

## Approved, detail pending

Not deferred — landed — but with one detail left open:

- **The name of `incarnation_of` / `deified_as`** (deity ↔ character), round 2. Provisional until
  a document that names a deity exercises it.
