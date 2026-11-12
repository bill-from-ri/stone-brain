import { looseNameKey, normalizeName } from '@/lib/ontology/name-key'

/**
 * The name rules behind the duplicate check, as pure string functions.
 *
 * Every rule starts from `looseNameKey` — the one normaliser — split into
 * words, so "Akál" and "akal", "the Veche" and "Veche", already agree before
 * any rule here runs. What this module adds is a handful of *specific*
 * differences a person would read as one name: a plural, a title, a word
 * order, a generic place word. Each rule comes as a pair:
 *
 *   - a **key**, which two names share whenever the rule might hold, so
 *     detection can bucket entities rather than compare every pair; and
 *   - a **check**, which says whether the rule actually holds for two names,
 *     and in which words.
 *
 * The key is deliberately loose (it only gathers candidates) and the check
 * deliberately exact, so a bucketing shortcut can never be the reason a pair
 * is reported.
 *
 * Nothing here is fuzzy matching. Edit distance would call `1st Legion` and
 * `11th Legion` one name; every rule below names the words that differ, which
 * is also what lets the screen explain itself.
 */

/** A name as the rules see it: the loose key, in words. */
export function nameWords(name: string): string[] {
  const key = looseNameKey(name)
  return key === '' ? [] : key.split(' ')
}

/** Words that join a name without changing what it names: `Province of Innenbeck`. */
const CONNECTIVES = new Set(['of', 'the'])

function content(words: readonly string[]): string[] {
  return words.filter((w) => !CONNECTIVES.has(w))
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/* ------------------------------------------------------------------ variant */

/**
 * Whether `name` is one of `variants`, on the loose key — the matcher's own
 * test for "this is the same name".
 */
export function isVariantOf(name: string, variants: readonly string[]): boolean {
  const key = looseNameKey(name)
  return key !== '' && variants.some((v) => looseNameKey(v) === key)
}

/* ------------------------------------------------------------------- plural */

/**
 * Words of three letters or fewer are never read as plurals: `gas`, `ess`,
 * `Ros` end in an `s` that is part of the word, and at that length almost
 * every one does.
 */
const SHORTEST_PLURAL = 4

/**
 * A word's bucketing form: `giants` → `giant`, `cities` → `city`, `houses`
 * and `house` both → `hous`. Not a singular — the trailing `e` is dropped so
 * that `-es` and `-s` plurals land together — only a key; `pluralPair` is the
 * test.
 */
function singularKey(word: string): string {
  if (word.length < SHORTEST_PLURAL) return word
  let w = word
  if (w.endsWith('ies')) w = w.slice(0, -3) + 'y'
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length >= SHORTEST_PLURAL && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** Shared by any two names that might differ only by plurals. */
export function pluralKey(name: string): string {
  return nameWords(name).map(singularKey).join(' ')
}

/** Whether `plural` is `singular` with an `-s`, `-es` or `-ies` ending. */
function isPluralOf(plural: string, singular: string): boolean {
  if (plural.length < SHORTEST_PLURAL) return false
  return (
    plural === `${singular}s` ||
    plural === `${singular}es` ||
    (singular.endsWith('y') && plural === `${singular.slice(0, -1)}ies`)
  )
}

/**
 * The words in which two names differ by a plural and nothing else, as
 * `[a's word, b's word]` pairs — or null when they differ in any other way,
 * or not at all.
 */
export function pluralPair(a: string, b: string): [string, string][] | null {
  const wa = nameWords(a)
  const wb = nameWords(b)
  if (wa.length === 0 || wa.length !== wb.length) return null

  const differing: [string, string][] = []
  for (let i = 0; i < wa.length; i++) {
    const x = wa[i]!
    const y = wb[i]!
    if (x === y) continue
    if (!isPluralOf(x, y) && !isPluralOf(y, x)) return null
    differing.push([x, y])
  }
  return differing.length > 0 ? differing : null
}

/* -------------------------------------------------------------------- title */

/**
 * Titles and honorifics that sit in front of a person's name. Not `St` or
 * `Saint`: St Leir is a place, and a saint's name is the saint's name.
 */
const TITLES = new Set([
  'count', 'countess', 'sir', 'dame', 'lady', 'lord', 'king', 'queen', 'prince', 'princess',
  'duke', 'duchess', 'archduke', 'archduchess', 'margrave', 'margravine', 'baron', 'baroness',
  'earl', 'viscount', 'viscountess', 'marquis', 'marquess', 'marchioness', 'emperor', 'empress',
  'tsar', 'tsarina', 'archbishop', 'bishop', 'cardinal', 'abbot', 'abbess', 'captain', 'general',
  'commander', 'admiral', 'marshal', 'chancellor', 'regent',
])

/** A name with its leading titles taken off: `Count Aldo Demard` → `{ titles: ['count'], rest: ['aldo', 'demard'] }`. */
export function splitTitles(name: string): { titles: string[]; rest: string[] } {
  const words = nameWords(name)
  let i = 0
  while (i < words.length - 1 && TITLES.has(words[i]!)) i++
  return { titles: words.slice(0, i), rest: words.slice(i) }
}

/** Shared by any two names that might differ only by a title. */
export function titleKey(name: string): string {
  return splitTitles(name).rest.join(' ')
}

/**
 * When one name is the other with titles in front, those titles, display-cased
 * (`['Count']`) and which side carried them; else null.
 *
 * Exactly one side may carry titles. `King Albert` and `Prince Albert` share
 * the bare name, but two different titles are as likely a father and son as
 * one man.
 */
export function titleDifference(a: string, b: string): { titled: 'a' | 'b'; titles: string[] } | null {
  const sa = splitTitles(a)
  const sb = splitTitles(b)
  if (sa.rest.join(' ') !== sb.rest.join(' ')) return null
  if (sa.titles.length > 0 && sb.titles.length === 0) return { titled: 'a', titles: sa.titles.map(capitalise) }
  if (sb.titles.length > 0 && sa.titles.length === 0) return { titled: 'b', titles: sb.titles.map(capitalise) }
  return null
}

/* --------------------------------------------------------------- word order */

/** The same multiset of words, `of` and `the` ignored. */
export function wordSetKey(name: string): string {
  return content(nameWords(name)).sort().join(' ')
}

/**
 * The same words in a different order: `Innenbeck Province` / `Province of
 * Innenbeck`. Two names that read the same once `of`/`the` are dropped are
 * not a different *order* — that is the matcher's ground, not this rule's —
 * and a one-word name has no order to differ in.
 */
export function sameWordsReordered(a: string, b: string): boolean {
  const ca = content(nameWords(a))
  const cb = content(nameWords(b))
  if (ca.length < 2 || ca.length !== cb.length) return false
  if (ca.join(' ') === cb.join(' ')) return false
  return wordSetKey(a) === wordSetKey(b)
}

/* ------------------------------------------------------------- generic word */

/**
 * Words that say what kind of place or polity a name is rather than which one.
 * `Interior Basin` and `Interior` are one region; `Kingdom of Ashfall` and
 * `Ashfall` one society.
 *
 * Not `house`: `House Lanzhelm` is a family, not the town it is named for.
 */
const GENERIC_WORDS = new Set([
  'basin', 'province', 'city', 'town', 'village', 'hamlet', 'county', 'region', 'kingdom',
  'duchy', 'principality', 'barony', 'march', 'marches', 'territory', 'realm', 'empire',
  'republic', 'shire', 'district', 'valley', 'vale', 'plain', 'plains', 'forest', 'wood',
  'woods', 'isle', 'island', 'islands', 'mountains', 'hills', 'lake', 'river', 'bay',
  'land', 'lands', 'fortress', 'castle', 'keep', 'port',
])

/** A name with its generic words (and `of`/`the`) taken out. */
function core(words: readonly string[]): string[] {
  return content(words).filter((w) => !GENERIC_WORDS.has(w))
}

/** Shared by any two names that might differ only by generic words. */
export function genericKey(name: string): string {
  return core(nameWords(name)).join(' ')
}

/**
 * When one name is the other plus generic words, those words, display-cased,
 * and which side carried them; else null.
 *
 * The bare side must have no generic word of its own. Without that, `Kaldian
 * Vale` and `Kaldian Empire` would both strip to `kaldian` — two different
 * things that happen to share an adjective.
 */
export function genericDifference(
  a: string,
  b: string,
): { extended: 'a' | 'b'; words: string[] } | null {
  const wa = nameWords(a)
  const wb = nameWords(b)
  const ca = core(wa)
  const cb = core(wb)
  if (ca.length === 0 || ca.join(' ') !== cb.join(' ')) return null

  const extra = (words: string[]) => content(words).filter((w) => GENERIC_WORDS.has(w))
  const xa = extra(wa)
  const xb = extra(wb)
  if (xa.length > 0 && xb.length === 0) return { extended: 'a', words: xa.map(capitalise) }
  if (xb.length > 0 && xa.length === 0) {
    return { extended: 'b', words: xb.map(capitalise) }
  }
  return null
}

/* ----------------------------------------------------------------- variants */

/**
 * The names a merge adds to the survivor's `name_variants`: the dropped
 * entity's name, then its own variants, less anything the survivor already
 * answers to — its name or a variant, on `normalizeName` — and less repeats.
 */
export function variantsToAdd(
  keep: { name: string; nameVariants: readonly string[] },
  drop: { name: string; nameVariants: readonly string[] },
): string[] {
  const known = new Set([keep.name, ...keep.nameVariants].map(normalizeName))
  const added: string[] = []
  for (const candidate of [drop.name, ...drop.nameVariants]) {
    const key = normalizeName(candidate)
    if (key === '' || known.has(key)) continue
    known.add(key)
    added.push(candidate)
  }
  return added
}
