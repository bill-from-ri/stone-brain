import type { NeonDatabase } from 'drizzle-orm/neon-serverless'
import type * as schema from '@/db/schema'
import { loadSeed, type SeedClaim, type SeedEntity, type WorldSeedReport } from './seed-world'

/**
 * Seed round 2 — "The Kaldian Empire" (docs/seed-drafts/draft-seed-round-2.md).
 *
 * Ground truth for the Phase 2B bake-off, hand-read from the document. Where
 * *Written Map* (`seed-world.ts`) was almost pure geography, this document is
 * people, factions, offices, events, and trade — so the two together exercise
 * both halves of the vocabulary.
 *
 * Depends on the round-2 registry changes (successor_of faction→faction, serves
 * society→society, the `language` attribute); run `npm run db:seed` before this.
 * The loader is shared with round 1: entities dedupe on (user, type, normalized
 * name), so `Elduin` and `Grain` — first seeded from Written Map — are reused
 * here rather than duplicated, which is the first cross-document match.
 */

type Db = NeonDatabase<typeof schema>

export const SEED_DOCUMENT_KALDIA = {
  name: 'The Kaldian Empire',
  driveFileId: '1APto2NJ6o6qjBJ0TkNjgPR-GEtCKFcJrMvL7Pox0d9Y',
} as const

/* -------------------------------------------------------------- the entities */

export const KALDIA_ENTITIES: SeedEntity[] = [
  // Societies. The subdivisions (decision 9) are societies within the Empire,
  // tied to it by `serves`. "Kalduin Dynasty" is a variant of the Empire AND a
  // faction below — resolving it returns two candidates, deliberately (§4).
  {
    name: 'Kaldian Empire',
    type: 'society',
    variants: ['Imperial Kaldia', 'Kaldia', 'the Empire', 'Kalduin Dynasty'],
    summary: 'The largest nation on Elduin, covering the island’s western half.',
  },
  { name: 'Kingdom of Swadia', type: 'society', summary: 'A defeated kingdom, now a vassal under the aegis of the Empire.' },
  { name: 'Duchy of Korsburg', type: 'society', summary: 'A constituent duchy of the Empire; the source of its lumber.' },
  { name: 'Province of Innenbeck', type: 'society', summary: 'A constituent province of the Empire, in the Interior.' },

  // Regions. Elduin already exists from Written Map and is matched, not created.
  { name: 'Elduin', type: 'region' },
  { name: 'Kaldian Vale', type: 'region', summary: 'The Empire’s heartland and breadbasket.' },
  { name: 'Thalgia', type: 'region' },
  { name: 'The Interior', type: 'region', summary: 'A monster-haunted interior region, home to Riftwald Forest.' },
  { name: 'The Pale', type: 'region' },
  { name: 'Hinter Coast', type: 'region' },
  { name: 'Riftwald Forest', type: 'region' },
  { name: 'Breakback Cliffs', type: 'region' },
  { name: 'Farrock Hills', type: 'region' },

  // Settlements.
  { name: 'Hrimfall', type: 'settlement', summary: 'Capital of the Kaldian Empire.' },

  // Characters. Titles (Prince, Emperor, …) are claims, not part of the name.
  { name: 'Ludwig I Kalduin', type: 'character', summary: 'Founder of the Kaldian Empire and the Kalduin Dynasty.' },
  { name: 'Ludwig II Kalduin', type: 'character', summary: 'The reigning Emperor.' },
  { name: 'Lukas Kalduin', type: 'character' },
  { name: 'Edith Akadon', type: 'character' },
  { name: 'Wilhelm Baelestir', type: 'character', summary: 'The Prime Minister, who leads the Imperial Assembly.' },
  { name: 'Aldo Demard', type: 'character', summary: 'Raised from Count to Imperial Margrave during the Pale War.' },

  // Factions. Dynasties are factions (decision 1).
  { name: 'Imperial Assembly', type: 'faction', summary: 'The Empire’s legislature, split into an Upper and Lower House.' },
  { name: 'Conservatives', type: 'faction', summary: 'A noble-dominated political alliance favouring centralisation.' },
  { name: 'Iconoclasts', type: 'faction', summary: 'A political alliance of non-nobles favouring social mobility.' },
  { name: 'Kalduin Dynasty', type: 'faction', summary: 'The ruling house of the Kaldian Vale since 918.' },
  { name: 'Skrimir Dynasty', type: 'faction', summary: 'The house the Kalduin Dynasty succeeded.' },
  { name: 'Elduin Dynasty', type: 'faction', summary: 'An earlier ruling house of the Kaldian Vale.' },

  // Religions.
  { name: 'Western Syrathism', type: 'religion' },
  { name: 'Classical Syrathism', type: 'religion' },

  // Culture.
  { name: 'Kaldian culture', type: 'culture', summary: 'The culture of the Kaldian people — unity, martial valour, and patriotism.' },

  // Events. The Dark Age is an era modelled as an event (decision 14); the
  // document gives it no dates, so it carries only a summary and no claim.
  { name: 'The Pale War', type: 'event', summary: 'The 992 war in which the Empire defeated Swadia.' },
  { name: 'The Dark Age', type: 'event', summary: 'A period the Kaldians regard as the lowest point in human history. No dates are given.' },

  // Commodities. Grain already exists from Written Map and is matched, not created.
  { name: 'Grain', type: 'commodity' },
  { name: 'Hide', type: 'commodity' },
  { name: 'Wool', type: 'commodity' },
  { name: 'Milk', type: 'commodity' },
  { name: 'Lumber', type: 'commodity' },
  { name: 'Ore', type: 'commodity' },
  { name: 'Quarried Stone', type: 'commodity' },
  { name: 'Monster Parts', type: 'commodity' },
  { name: 'Weapons', type: 'commodity' },
  { name: 'Tools', type: 'commodity' },

  // Artifacts.
  { name: 'The Coat of Arms', type: 'artifact', summary: 'The national coat of arms of the Kaldian Empire.' },
  { name: 'The Imperial Charter', type: 'artifact', summary: 'The Empire’s foremost legal document.' },
]

/* ---------------------------------------------------------------- the claims */

const Q = {
  nation: 'the largest nation on Elduin',
  covers: 'including the Kaldian Vale, Thalgia, the Interior, the Pale, and much of the Hinter Coast',
  founded: 'The Kaldian Empire was founded in 918 by Ludwig I Kalduin',
  assembly: 'Ludwig I signed the Imperial Assembly into existence',
  skrimir: 'a period of civil war that ended the Skrimir Dynasty',
  dynastyBegin: 'marked the beginning of the Kalduin Dynasty',
  fourthDynasty: 'the fourth dynasty to rule the Kaldian Vale after the fall of the Elduin Dynasty',
  marriage: 'a marriage alliance between Prince Lukas Kalduin and Princess Edith Akadon',
  addedThalgia: 'added Thalgia to the Empire',
  paleWar: 'In 992, the Empire won the Pale War against the Kingdom of Swadia',
  ceded: 'the Kingdom ceded much of its territory to Kaldia',
  aegis: 'was placed under the aegis of the Empire',
  infobox: 'Emperor Prime Minister Margrave Ludwig II Kalduin Wilhelm Baelestir Aldo Demard',
  motto: 'Motto: Unite the realms.',
  capital: 'Capital Hrimfall',
  relWest: 'Religion Western Syrathism',
  relClassical: 'Classical Syrathism',
  gov: 'Government Federal semi-constitutional monarchy',
  pop: 'Population Approx. 2.9 million',
  lang: 'Official language Common',
  coat: 'Kaldian Empire Nation Coat of Arms',
  charter: 'the laws detailed in the Imperial Charter',
  assemblyLed: 'is led by the Prime Minister',
  alliances: 'political alliances in the Empire are the Conservatives and the Iconoclasts',
  margrave: 'Count Aldo Demard was made Imperial Margrave',
  iconoMil: 'the Iconoclasts have many members within the Kaldian military',
  festivals: 'festivals to celebrate Kaldian culture',
  breadbasket:
    'The Kaldian Vale is a breadbasket, home to a vast swath of farmland that sources enough grain',
  herds: 'a bountiful source of hide, wool, and milk',
  lumber: 'Most imperial lumber is collected from the Duchy of Korsburg',
  ores: 'its ores and quarried stone are primarily harvested from the Breakback Cliffs and Farrock Hills',
  monsters: 'the Interior is home to monsters whose exotic body parts often sell for high prices',
  abroad: 'sell for high prices in markets both within the Empire and abroad',
  smithing: 'provide both tools and weapons to its people',
  riftwald: 'the beasts of Riftwald Forest',
  innenbeck: 'Hundreds of monster hunters work in the Province of Innenbeck',
} as const

export const KALDIA_CLAIMS: SeedClaim[] = [
  /* ¶1 — the Empire and its territories */
  { subject: 'Kaldian Empire', predicate: 'located_in', object: 'Elduin', quote: Q.nation, paragraph: 1 },
  { subject: 'Kaldian Empire', predicate: 'rules', object: 'Kaldian Vale', quote: Q.covers, paragraph: 1, inferred: '"covers … including" read as sovereign control (§1.3)' },
  { subject: 'Kaldian Empire', predicate: 'rules', object: 'The Interior', quote: Q.covers, paragraph: 1, inferred: '"covers … including" read as sovereign control (§1.3)' },
  { subject: 'Kaldian Empire', predicate: 'rules', object: 'The Pale', quote: Q.covers, paragraph: 1, inferred: '"covers … including" read as sovereign control (§1.3)' },
  { subject: 'Kaldian Empire', predicate: 'rules', object: 'Hinter Coast', quote: Q.covers, paragraph: 1, inferred: '"covers … including" read as sovereign control (§1.3)' },

  /* ¶2 — founding */
  { subject: 'Ludwig I Kalduin', predicate: 'founded', object: 'Kaldian Empire', quote: Q.founded, paragraph: 2 },
  { subject: 'Kaldian Empire', predicate: 'founded_on', value: '918', quote: Q.founded, paragraph: 2 },
  { subject: 'Ludwig I Kalduin', predicate: 'founded', object: 'Imperial Assembly', quote: Q.assembly, paragraph: 2 },
  { subject: 'Skrimir Dynasty', predicate: 'dissolved_on', value: '918', quote: Q.skrimir, paragraph: 2, inferred: 'end dated to the founding year the civil war produced' },

  /* ¶3 — the Kalduin Dynasty and its succession */
  { subject: 'Ludwig I Kalduin', predicate: 'founded', object: 'Kalduin Dynasty', quote: Q.dynastyBegin, paragraph: 3 },
  { subject: 'Kalduin Dynasty', predicate: 'rules', object: 'Kaldian Vale', quote: Q.fourthDynasty, paragraph: 3 },
  { subject: 'Kalduin Dynasty', predicate: 'successor_of', object: 'Skrimir Dynasty', quote: Q.fourthDynasty, paragraph: 3, inferred: 'the house that followed the one the civil war ended' },

  /* ¶4 — the Thalgian marriage, 935 */
  { subject: 'Lukas Kalduin', predicate: 'married_to', object: 'Edith Akadon', startTime: '935', quote: Q.marriage, paragraph: 4 },
  { subject: 'Lukas Kalduin', predicate: 'title', value: 'Prince', quote: Q.marriage, paragraph: 4 },
  { subject: 'Edith Akadon', predicate: 'title', value: 'Princess', quote: Q.marriage, paragraph: 4 },
  { subject: 'Kaldian Empire', predicate: 'rules', object: 'Thalgia', startTime: '935', quote: Q.addedThalgia, paragraph: 4 },

  /* ¶5 — the Pale War, 992 */
  { subject: 'The Pale War', predicate: 'occurred_on', value: '992', quote: Q.paleWar, paragraph: 5 },
  { subject: 'Kaldian Empire', predicate: 'participated_in', object: 'The Pale War', quote: Q.paleWar, paragraph: 5 },
  { subject: 'Kingdom of Swadia', predicate: 'participated_in', object: 'The Pale War', quote: Q.paleWar, paragraph: 5 },
  { subject: 'The Pale War', predicate: 'outcome', value: 'The Empire won; Swadia ceded much of its territory to Kaldia.', quote: Q.ceded, paragraph: 5 },
  { subject: 'Kingdom of Swadia', predicate: 'serves', object: 'Kaldian Empire', quote: Q.aegis, paragraph: 5, inferred: '"under the aegis of the Empire" read as vassalage (§5a)' },

  /* ¶7 — the infobox */
  { subject: 'Kaldian Empire', predicate: 'motto', value: 'Unite the realms.', quote: Q.motto, paragraph: 7 },
  { subject: 'Hrimfall', predicate: 'capital_of', object: 'Kaldian Empire', quote: Q.capital, paragraph: 7 },
  { subject: 'Kaldian Empire', predicate: 'worships', object: 'Western Syrathism', quote: Q.relWest, paragraph: 7 },
  { subject: 'Kaldian Empire', predicate: 'worships', object: 'Classical Syrathism', quote: Q.relClassical, paragraph: 7 },
  { subject: 'Kaldian Empire', predicate: 'government_type', value: 'Federal semi-constitutional monarchy', quote: Q.gov, paragraph: 7 },
  { subject: 'Kaldian Empire', predicate: 'population', value: 2_900_000, quote: Q.pop, paragraph: 7, inferred: '"Approx. 2.9 million"' },
  { subject: 'Kaldian Empire', predicate: 'language', value: 'Common', quote: Q.lang, paragraph: 7 },
  { subject: 'Ludwig II Kalduin', predicate: 'title', value: 'Emperor', quote: Q.infobox, paragraph: 7, inferred: 'infobox positional alignment (§1.8)' },
  { subject: 'Ludwig II Kalduin', predicate: 'rules', object: 'Kaldian Empire', quote: Q.infobox, paragraph: 7, inferred: 'Emperor is head of state (§1.8)' },
  { subject: 'Wilhelm Baelestir', predicate: 'title', value: 'Prime Minister', quote: Q.infobox, paragraph: 7, inferred: 'infobox positional alignment (§1.8)' },
  { subject: 'Kaldian Empire', predicate: 'owns', object: 'The Coat of Arms', quote: Q.coat, paragraph: 7, inferred: 'the nation bears its own arms' },

  /* ¶8 — the Charter */
  { subject: 'Kaldian Empire', predicate: 'owns', object: 'The Imperial Charter', quote: Q.charter, paragraph: 8 },

  /* ¶9 — who leads the Assembly */
  { subject: 'Wilhelm Baelestir', predicate: 'leads', object: 'Imperial Assembly', quote: Q.assemblyLed, paragraph: 9, inferred: 'the Prime Minister leads it; the PM is Wilhelm (§1.8)' },

  /* ¶11 — the political alliances */
  { subject: 'Conservatives', predicate: 'member_of', object: 'Kaldian Empire', quote: Q.alliances, paragraph: 11 },
  { subject: 'Iconoclasts', predicate: 'member_of', object: 'Kaldian Empire', quote: Q.alliances, paragraph: 11 },

  /* ¶12 — Aldo Demard */
  { subject: 'Aldo Demard', predicate: 'title', value: 'Count', quote: Q.margrave, paragraph: 12, inferred: 'his title before the Pale War' },
  { subject: 'Aldo Demard', predicate: 'title', value: 'Imperial Margrave', startTime: '992', quote: Q.margrave, paragraph: 12 },
  { subject: 'Aldo Demard', predicate: 'member_of', object: 'Iconoclasts', quote: Q.iconoMil, paragraph: 12, inferred: 'associated with the Iconoclasts, not stated as a member' },

  /* ¶13 — culture */
  { subject: 'Kaldian Empire', predicate: 'practices', object: 'Kaldian culture', quote: Q.festivals, paragraph: 13, inferred: 'the Empire celebrates its own culture' },

  /* ¶16 — the agrarian and extractive economy */
  { subject: 'Kaldian Vale', predicate: 'produces', object: 'Grain', quote: Q.breadbasket, paragraph: 16 },
  { subject: 'Kaldian Vale', predicate: 'produces', object: 'Hide', quote: Q.herds, paragraph: 16 },
  { subject: 'Kaldian Vale', predicate: 'produces', object: 'Wool', quote: Q.herds, paragraph: 16 },
  { subject: 'Kaldian Vale', predicate: 'produces', object: 'Milk', quote: Q.herds, paragraph: 16 },
  { subject: 'Kaldian Vale', predicate: 'landform', value: 'valley', quote: Q.breadbasket, paragraph: 16, inferred: 'a vale is a valley' },
  { subject: 'Duchy of Korsburg', predicate: 'produces', object: 'Lumber', quote: Q.lumber, paragraph: 16 },
  { subject: 'Duchy of Korsburg', predicate: 'serves', object: 'Kaldian Empire', quote: Q.lumber, paragraph: 16, inferred: 'a duchy is a subdivision of the Empire (§5a)' },
  { subject: 'Breakback Cliffs', predicate: 'produces', object: 'Ore', quote: Q.ores, paragraph: 16 },
  { subject: 'Breakback Cliffs', predicate: 'produces', object: 'Quarried Stone', quote: Q.ores, paragraph: 16 },
  { subject: 'Farrock Hills', predicate: 'produces', object: 'Ore', quote: Q.ores, paragraph: 16 },
  { subject: 'Farrock Hills', predicate: 'produces', object: 'Quarried Stone', quote: Q.ores, paragraph: 16 },
  { subject: 'Farrock Hills', predicate: 'landform', value: 'hills', quote: Q.ores, paragraph: 16, inferred: 'named "Hills"' },

  /* ¶17 — the monster-part trade */
  { subject: 'The Interior', predicate: 'produces', object: 'Monster Parts', quote: Q.monsters, paragraph: 17 },
  { subject: 'Kaldian Empire', predicate: 'exports', object: 'Monster Parts', quote: Q.abroad, paragraph: 17, inferred: '"markets … abroad" read as export' },

  /* ¶18 — industry and the Interior */
  { subject: 'Kaldian Empire', predicate: 'produces', object: 'Weapons', quote: Q.smithing, paragraph: 18, inferred: 'the smithing industry produces them' },
  { subject: 'Kaldian Empire', predicate: 'produces', object: 'Tools', quote: Q.smithing, paragraph: 18, inferred: 'the smithing industry produces them' },
  { subject: 'Riftwald Forest', predicate: 'located_in', object: 'The Interior', quote: Q.riftwald, paragraph: 18, inferred: 'named in the Interior context' },
  { subject: 'Riftwald Forest', predicate: 'climate', value: 'temperate_forest', quote: Q.riftwald, paragraph: 18, inferred: 'a named forest' },

  /* ¶19 — Innenbeck */
  { subject: 'Province of Innenbeck', predicate: 'located_in', object: 'The Interior', quote: Q.innenbeck, paragraph: 19, inferred: 'the monster-hunting Interior' },
  { subject: 'Province of Innenbeck', predicate: 'serves', object: 'Kaldian Empire', quote: Q.innenbeck, paragraph: 19, inferred: 'a province is a subdivision of the Empire (§5a)' },
]

/* ---------------------------------------------------------------- the loader */

export async function seedKaldia(db: Db, userId: string): Promise<WorldSeedReport> {
  return loadSeed(db, userId, SEED_DOCUMENT_KALDIA, KALDIA_ENTITIES, KALDIA_CLAIMS)
}
