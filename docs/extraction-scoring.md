# Extraction scoring

How well a model extracts claims, measured against the claims a person read out of the same
documents by hand (implementation plan §4b). The point is to confirm a model is not bad on the
seeded documents, not to rank models finely. The code is
[`src/lib/scoring/`](../src/lib/scoring/) (pure, unit-tested) and
[`scripts/score-extraction.ts`](../scripts/score-extraction.ts).

## The match rule

A **fact** matches when subject, predicate, and object or value all agree:

- **Entities** compare on the matcher's own name key (`looseNameKey`: case, diacritics,
  punctuation and a leading article are ignored), against the seed entity's name *and its
  variants*, resolved across all three seeds, as the matcher would. The **entity type must
  agree**.
- **Relationships** compare in one canonical direction, the one the registry declares. So
  `Syrath created Dragon's Shroud` matches the seed's `Dragon's Shroud created_by Syrath`, and a
  symmetric predicate (`married_to`) matches with its ends either way round. This keeps scores
  stable once §5 writes every inverse claim. The per-predicate table counts both directions of a
  pair under the declared name.
- **Values** compare by meaning: numbers numerically, dates by calendar ordinal where the label
  parses (`918` = `918 AD`), text on the normalised name.

A **claim** matches when its fact matches and its quote is good:

- **Verbatim.** The quote must occur in the document's paragraphs as the model saw them. Only
  whitespace and the shape of quotation marks are forgiven: documents export curly quotes and
  models often straighten them, which does not change the words. Anything else, including an
  ellipsis, counts as a paraphrase.
- **Overlapping.** The quote need not equal the seed's quote. It only has to share at least 10
  characters with it in the same paragraph, or all of the shorter quote if that is under 10.

Each ground-truth claim ends up in one of these outcomes: *matched*; *right fact, quote paraphrased*;
*right fact, verbatim quote from another passage*; *missed*. If a missed claim's fact was extracted
with a different entity type, the report shows it as a **near miss**.

A fact extracted twice counts once, using the copy with the best citation, because the claims table
would collapse the copies into one row anyway. Start and end times are compared on every right fact
and reported separately. They do not affect the match.

**P / R / F1** count full matches. **fP / fR** count right facts whatever their quote. An
*unmatched* extracted claim is not necessarily wrong, because the ground truth may be incomplete.

## Capturing and scoring

```sh
npm run extract:capture -- <run-label>          # spends 3 requests; writes scoring/captures/<run-label>/
npm run extract:score   -- <run-label> [--json] # spends nothing; --json writes scoring/results/<run-label>.json
```

A model outside the configured provider can be captured offline: `--dump-prompts=<dir>` writes the
exact prompts, and `--from-replies=<dir> --model=<name>` builds the fixtures from saved replies (see
the header of `scripts/capture-extraction.ts`).

## Baseline: `sonnet-baseline`

Claude Sonnet (`claude-sonnet-5-5`). Captured offline via `--dump-prompts` / `--from-replies`, one
attempt and no repair round, before §5. No claims were rejected by the validator.

| Document | Truth | Extracted | Matched | P | R | F1 | fP | fR |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| Written Map | 28 | 16 | 14 | 88% | 50% | 64% | 88% | 50% |
| The Kaldian Empire | 60 | 20 | 7 | 35% | 12% | 18% | 35% | 12% |
| The Runar | 27 | 10 | 8 | 80% | 30% | 43% | 90% | 33% |
| **All** | **115** | **46** | **29** | **63%** | **25%** | **36%** | **65%** | **26%** |

What the numbers show:

- **Citations are fine.** All 46 quotes are verbatim. One right fact (Eldi `economy mercantile`)
  cites a different paragraph from the seed. In this run the quote rules almost never decide the
  outcome.
- **Precision is good wherever entity types agree.** Written Map and The Runar score 80–90%. The
  few unmatched claims there are readings that differ from the seed (Central Plain as a `basin`,
  not a `plain`) or facts nobody labelled (Sea of Akál `landform sea`).
- **The Kaldian Empire result is mostly one typing decision.** The model typed the Empire, and
  the Kingdom of Swadia, as a `faction`. The vocabulary says empires and kingdoms are societies,
  so this is a real error under the rule. But it accounts for 11 of the 12 near misses. If those
  had matched, the document's fact recall would be about 30% instead of 12%. The model also
  skipped most of the economy section (¶16–19) and several infobox rows.
- **Recall is low, and mostly on inferred claims.** The seeds label generously: 49 of the 115
  claims carry an `inferred` note ("a bread basket" implies grain; each of the four peoples
  practises Runar culture). Sonnet matched 2 of those 49, against 27 of the 66 stated claims
  (41%). It extracts what the text says and rarely what it implies. That is arguably the right
  bias for a tool that must not invent canon, but it is why recall is low.
- **Times are not extracted.** Only two seed claims have a start date (the 935 marriage and the
  992 margraviate). Both facts were found and both came back undated.

Overall, the model is not bad. When it states a fact, it is usually right and properly cited. It
under-extracts, and the vocabulary's society/faction line needs to be clearer to the model.
