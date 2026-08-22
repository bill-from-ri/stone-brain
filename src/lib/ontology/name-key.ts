/**
 * The form stored in `entities.normalized_name`.
 *
 * Diacritics are folded so "Akál" and "Akal" are one key, and every run of
 * punctuation or whitespace becomes a single space — which also means an
 * extractor's "Sera." and "sera" land on the same string.
 *
 * This is the *only* normaliser. Anything else that needs to compare names
 * imports it rather than writing its own, because two normalisers disagreeing
 * is a duplicate entity nobody can explain.
 *
 * It lives in its own file, apart from the matcher that is its main caller, so
 * that "importing it" stays possible from the browser: the entity editor warns
 * about a name that already exists and has to compare on the same key, and
 * matcher.ts reaches for drizzle and the schema the moment it is loaded. A
 * pure string function is the one piece of the matcher a client can hold, and
 * duplicating four lines of it there is exactly the disagreement above.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ARTICLES = /^(the|a|an) /

/**
 * A second key with a leading article dropped, so "the Veche" and "Veche" are
 * one key.
 *
 * This is not a fuzzy guess — it is the same name — which is why the matcher
 * treats a hit on it as a genuine match rather than a suggestion, and why the
 * extraction write path uses it to decide that two names in one document
 * describe one entity rather than two.
 *
 * Lives here beside `normalizeName` for the same reason it does: two callers
 * disagreeing about what counts as the same name is a duplicate entity nobody
 * can explain.
 */
export function looseNameKey(name: string): string {
  return normalizeName(name).replace(ARTICLES, '')
}
