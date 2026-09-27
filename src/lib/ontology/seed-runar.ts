import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { loadSeed, type SeedClaim, type SeedEntity, type WorldSeedReport } from './seed-world'

/**
 * Seed round 3 — "The Runar". Its rulings are in docs/ontology-design.md; the
 * working draft, which the decision numbers below cite, is in git history:
 * `git show 4330390:docs/seed-drafts/draft-seed-round-3.md`.
 *
 * Ground truth for scoring Phase 2B extraction, hand-read from the document.
 * Where *Written Map* was geography and *The Kaldian Empire* politics, this is
 * culture and belief — and roughly half of it (cosmology, the Giving
 * Ceremonies, trade, influence, descent) has no home in the vocabulary yet, so
 * it is thin in claims by design; see the draft's "What the vocabulary cannot
 * say" and docs/deferred-proposals.md.
 *
 * Depends on the round-3 registry change (the `species` entity type); run
 * `npm run db:seed` before this. Runara, Elduin, and Enua are reused from
 * round 1. Two claims (`Runara climate`, `Elduin landform`) were already seeded
 * from Written Map; the loader cites them from this document as well.
 */

type Db = NeonDatabase<typeof schema>

export const SEED_DOCUMENT_RUNAR = {
  name: 'The Runar',
  driveFileId: '1pngPgMdvZf7yClZznYTYbbSXq_BeEXYm9B79iDN8Scg',
} as const

/* -------------------------------------------------------------- the entities */

export const RUNAR_ENTITIES: SeedEntity[] = [
  // Cultures. The Runar are one culture across four peoples (decision 1); the
  // Enu are the culture of the society Enuarak (decision 6).
  {
    name: 'Runar',
    type: 'culture',
    variants: ['Runyar'],
    summary:
      'The peoples of the Frost Gulf: four tribes sharing a common root, settled across the Runar ' +
      'Basin since Antiquity. The Runyar of Elduin are the same culture.',
  },
  { name: 'Enu', type: 'culture', summary: 'The culture of Enuarak, whose religious ideas have influenced the Eldi.' },

  // Societies. Tribes with no government are still societies (decision 2).
  { name: 'Eldi', type: 'society', summary: 'Runar people of the Amber Coast; mercantile, in sustained contact with Enuarak, and dominant in the gulf’s maritime trade. They bury their dead at sea.' },
  { name: 'Suedi', type: 'society', summary: 'Runar people of the Blighted Shore; the most militant of the four, shaped by monsters and the Kazavs to the north. Invaded Elduin shortly before the Doom.' },
  { name: 'Tvars', type: 'society', variants: ['Tvar'], summary: 'The most conservative and insular Runar people, of the deep inland forest; prosperous producers of amber, furs, and medicinal goods. They bury their dead in lakes and bogs.' },
  { name: 'Atarks', type: 'society', summary: 'Runar people of the eastern forest-steppe frontier, heavily influenced by steppe horse culture; they believe the dead rise to the Upper World.' },
  { name: 'Kazavs', type: 'society', summary: 'Hunter-gatherer tribes of the monster-infested tundra north of the Suedi.' },
  { name: 'Enuarak', type: 'society', summary: 'The society of the Enu, beyond the mountains south of the Eldi; the main channel of metalwork, luxury goods, and religious ideas into the Runar Basin.' },

  // Regions. Runara, Elduin, and Enua already exist from round 1.
  { name: 'Runara', type: 'region' },
  { name: 'Elduin', type: 'region' },
  { name: 'Enua', type: 'region' },
  { name: 'Runar Basin', type: 'region', summary: 'The river basin inhabited by the Runar.' },
  { name: 'Amber Coast', type: 'region', summary: 'The coast of the Eldi, between the Frost Gulf and the Orosh Mountains.' },
  { name: 'Blighted Shore', type: 'region', summary: 'The northern coast of the Suedi, named for the monsters of the tundra beyond it.' },

  { name: 'Runar Religion', type: 'religion', summary: 'Animist and decentralised: holy groves, river and animal spirits, and the stars, in a three-world cosmology (Upper, Walked, and Underworld) with the Tvarid Spruce as the Sky Posts. No shared pantheon.' },

  // Species (decision 13).
  { name: 'Tvarid Spruce', type: 'species', variants: ['Sky Posts'], summary: 'The tallest and oldest living thing in the Frost Gulf; revered by all four Runar peoples as the Sky Posts that hold up the Upper World. Rarely felled, and only with ritual apology.' },

  // Commodities.
  { name: 'Amber', type: 'commodity', summary: 'Fossil resin; the Tvars produce the finest.' },
  { name: 'Furs', type: 'commodity', summary: 'Animal pelts; a staple of Tvar wealth.' },
  { name: 'Medicinal Goods', type: 'commodity', summary: 'Remedies from the inland forest, produced by the Tvars.' },
  { name: 'Metalwork', type: 'commodity', summary: 'Worked metal; reaches the Runar Basin chiefly from Enuarak, through the Eldi.' },
  { name: 'Luxury Goods', type: 'commodity', summary: 'Fine goods; reach the Runar Basin chiefly from Enuarak, through the Eldi.' },
]

/* ---------------------------------------------------------------- the claims */

const Q = {
  coastland: 'a cold and wet coastland dominated by iconic temperate rainforests',
  basin: 'until they inhabited the entire Runar Basin',
  basinShore: 'until they inhabited the entire Runar Basin, the adjacent shorelands',
  crossed: 'crossed onto the island of Elduin in the 2nd century BD',
  fourPeoples: 'Today, the Runar are divided into four peoples',
  eldiCoast: 'the Eldi of the Amber Coast',
  suediShore: 'the Suedi of the Blighted Shore',
  elsewhere: 'are all more commonplace here than elsewhere in the Runar Basin',
  enuContact: 'Sustained contact with the Enu',
  suediNorth: 'The Suedi occupy the northern edge of the Runar Basin',
  kazavs: 'Their relationship with the northern hunter-gatherers (the Kazavs) includes both trade and open conflict',
  tvarGoods: 'they produce the finest amber, furs, and medicinal goods',
  channel: 'the main channel through which metalwork, luxury goods, and outside religious ideas reach the Runar Basin',
  spruce: 'The Tvarid Spruce is the tallest and oldest living thing in the Frost Gulf',
  mercantile: 'whose mercantile economy runs on trade rather than raiding',
  religion: 'Runar religion is not a unified institution',
} as const

export const RUNAR_CLAIMS: SeedClaim[] = [
  /* ¶1 — the Frost Gulf as land, i.e. Runara (decision 3) */
  { subject: 'Runara', predicate: 'climate', value: 'temperate_rainforest', quote: Q.coastland, paragraph: 1 },
  { subject: 'Runara', predicate: 'landform', value: 'coast', quote: Q.coastland, paragraph: 1, inferred: '"coastland"' },

  /* ¶2 — settlement of the basin and of Elduin. No date on located_in (decision 16). */
  { subject: 'Runar', predicate: 'located_in', object: 'Runar Basin', quote: Q.basin, paragraph: 2 },
  { subject: 'Runar', predicate: 'located_in', object: 'Elduin', quote: Q.crossed, paragraph: 2 },
  { subject: 'Elduin', predicate: 'landform', value: 'island', quote: Q.crossed, paragraph: 2 },
  { subject: 'Runar Basin', predicate: 'landform', value: 'basin', quote: Q.basin, paragraph: 2, inferred: 'from the name' },
  { subject: 'Runar Basin', predicate: 'located_in', object: 'Runara', quote: Q.basinShore, paragraph: 2, inferred: '"this region" is the ¶1 coastland (decision 4)' },

  /* ¶5 — the four peoples */
  { subject: 'Eldi', predicate: 'practices', object: 'Runar', quote: Q.fourPeoples, paragraph: 5, inferred: 'each people is Runar (decision 14)' },
  { subject: 'Suedi', predicate: 'practices', object: 'Runar', quote: Q.fourPeoples, paragraph: 5, inferred: 'each people is Runar (decision 14)' },
  { subject: 'Tvars', predicate: 'practices', object: 'Runar', quote: Q.fourPeoples, paragraph: 5, inferred: 'each people is Runar (decision 14)' },
  { subject: 'Atarks', predicate: 'practices', object: 'Runar', quote: Q.fourPeoples, paragraph: 5, inferred: 'each people is Runar (decision 14)' },
  { subject: 'Eldi', predicate: 'located_in', object: 'Amber Coast', quote: Q.eldiCoast, paragraph: 5 },
  { subject: 'Suedi', predicate: 'located_in', object: 'Blighted Shore', quote: Q.suediShore, paragraph: 5 },
  { subject: 'Amber Coast', predicate: 'landform', value: 'coast', quote: Q.eldiCoast, paragraph: 5, inferred: 'from the name' },
  { subject: 'Blighted Shore', predicate: 'landform', value: 'coast', quote: Q.suediShore, paragraph: 5, inferred: 'from the name' },

  /* ¶7 — the Eldi */
  { subject: 'Amber Coast', predicate: 'located_in', object: 'Runar Basin', quote: Q.elsewhere, paragraph: 7, inferred: '"here" is Eldi land' },
  { subject: 'Enuarak', predicate: 'practices', object: 'Enu', quote: Q.enuContact, paragraph: 7, inferred: 'the Enu are the people of Enuarak, named in the same paragraph (decision 6)' },

  /* ¶10 — the Suedi */
  { subject: 'Blighted Shore', predicate: 'located_in', object: 'Runar Basin', quote: Q.suediNorth, paragraph: 10, inferred: 'the Suedi’s shore is the basin’s northern edge' },
  { subject: 'Suedi', predicate: 'enemy_of', object: 'Kazavs', quote: Q.kazavs, paragraph: 10, inferred: 'intermittent open conflict, alongside trade' },

  /* ¶12 — the Tvars */
  { subject: 'Tvars', predicate: 'produces', object: 'Amber', quote: Q.tvarGoods, paragraph: 12 },
  { subject: 'Tvars', predicate: 'produces', object: 'Furs', quote: Q.tvarGoods, paragraph: 12 },
  { subject: 'Tvars', predicate: 'produces', object: 'Medicinal Goods', quote: Q.tvarGoods, paragraph: 12 },

  /* ¶17 — neighbours */
  { subject: 'Eldi', predicate: 'imports', object: 'Metalwork', quote: Q.channel, paragraph: 17, inferred: 'the channel is Enuarak’s contact with the Eldi' },
  { subject: 'Eldi', predicate: 'imports', object: 'Luxury Goods', quote: Q.channel, paragraph: 17, inferred: 'the channel is Enuarak’s contact with the Eldi' },

  /* ¶22 — the Tvarid Spruce. "Frost Gulf" here is the land (decision 3). */
  { subject: 'Tvarid Spruce', predicate: 'located_in', object: 'Runara', quote: Q.spruce, paragraph: 22, inferred: '"the Frost Gulf" as the land, Runara' },

  /* ¶25 — the Giving Ceremonies */
  { subject: 'Eldi', predicate: 'economy', value: 'mercantile', quote: Q.mercantile, paragraph: 25 },

  /* ¶28 — religion */
  { subject: 'Runar', predicate: 'worships', object: 'Runar Religion', quote: Q.religion, paragraph: 28, inferred: 'the religion of the Runar (decision 11)' },

  /* Hand-entered: no document states it, so it is no part of this document's ground truth. */
  { subject: 'Enuarak', predicate: 'located_in', object: 'Enua', handEntered: 'Enuarak lies beyond the Orosh Mountains, which Written Map places in Enua; ruled 2026-09-27' },
]

/* ---------------------------------------------------------------- the loader */

export async function seedRunar(db: Db, userId: string): Promise<WorldSeedReport> {
  return loadSeed(db, userId, SEED_DOCUMENT_RUNAR, RUNAR_ENTITIES, RUNAR_CLAIMS)
}
