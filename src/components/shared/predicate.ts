/**
 * A predicate as it reads inside a sentence.
 *
 * The ontology stores labels sentence-cased ("Located in", "Founded by")
 * because they head menus and columns. In a claim they are the verb in the
 * middle of a line — "Enua located in Elduin" — and the prototype writes them
 * lowercase there (lines 470-479, 712-718). Only the first character changes;
 * nothing in the vocabulary is a proper noun.
 *
 * Shared by the table and the graph so the same claim reads the same way in
 * both, which is the whole point of their being one screen.
 */
export function predicateText(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1)
}
