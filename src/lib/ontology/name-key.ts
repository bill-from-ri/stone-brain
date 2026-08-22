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
