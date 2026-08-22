import { describe, expect, it } from 'vitest'
import { cleanExport, paragraphTexts, renderForPrompt, toParagraphs } from './markdown'

/**
 * Fixtures here are lifted from real `files.export` output over the 47-document
 * Stone Brain corpus, not invented. Every case that looks oddly specific — the
 * bare `# `, the two-space paragraph breaks inside a table cell, the escaped
 * `\.` — is a thing Google actually emitted.
 */

describe('cleanExport', () => {
  it('drops base64 image definitions, which were 88% of the corpus by weight', () => {
    const raw = [
      '# The Lords’ Alliance',
      '',
      'Founded 8 Fenra, 992.',
      '',
      '[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBv>',
    ].join('\n')

    const clean = cleanExport(raw)
    expect(clean).not.toContain('data:image')
    expect(clean).toContain('Founded 8 Fenra, 992.')
  })

  it('drops the image reference at the point of use as well as its definition', () => {
    expect(cleanExport('Coat of arms: ![][image1] and ![alt](http://x/y.png) end')).toBe(
      'Coat of arms:  and  end',
    )
  })

  it('removes Google’s bare empty headings', () => {
    // Real: Renic-Timekeeping line 27, Zhusan-Lorestorming line 1.
    expect(cleanExport('# The Zodiac\n\n# \n\nIn accordance with…')).toBe(
      '# The Zodiac\n\nIn accordance with…',
    )
  })

  it('unescapes the punctuation Google escapes defensively', () => {
    expect(cleanExport('Motto: \\_ founded 8 Fenra\\. See \\#3 \\- the \\*star\\*')).toBe(
      'Motto: _ founded 8 Fenra. See #3 - the *star*',
    )
  })

  it('leaves an escaped pipe alone, so a table row cannot gain a column', () => {
    const row = '| a \\| b | c |'
    expect(cleanExport(row)).toBe(row)
  })

  it('strips the trailing spaces that mark a hard break', () => {
    expect(cleanExport('- One  \n- Two  \n- Three  ')).toBe('- One\n- Two\n- Three')
  })

  it('survives CRLF, which Drive exports sometimes carry', () => {
    expect(cleanExport('One.\r\n\r\nTwo.')).toBe('One.\n\nTwo.')
  })

  it('collapses the blank runs its own removals leave behind', () => {
    expect(cleanExport('A\n\n# \n\n\n\nB')).toBe('A\n\nB')
  })

  it('leaves ordinary prose byte-for-byte alone', () => {
    const prose = 'The **Central Empire** is an absolute monarchy in eastern Zhusan.'
    expect(cleanExport(prose)).toBe(prose)
  })
})

describe('toParagraphs', () => {
  it('splits on blank lines and numbers from zero', () => {
    expect(paragraphTexts('One.\n\nTwo.\n\n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
    expect(toParagraphs('One.\n\nTwo.').map((p) => p.index)).toEqual([0, 1])
  })

  it('keeps a wrapped paragraph whole', () => {
    expect(paragraphTexts('A line\nand its continuation.\n\nNext.')).toEqual([
      'A line\nand its continuation.',
      'Next.',
    ])
  })

  it('returns nothing for an empty document rather than one empty paragraph', () => {
    expect(toParagraphs('')).toEqual([])
    expect(toParagraphs('\n\n   \n')).toEqual([])
  })

  it('keeps a bullet list as one citable unit', () => {
    // Google separates items with hard breaks, not blank lines, so the eight
    // ministries stay one citation rather than becoming eight.
    const list = '- The Ministry of Agriculture\n- The Ministry of Appointments\n- The Ministry of War'
    const paragraphs = toParagraphs(`The Eight Ministries are:\n\n${list}`)
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1]!.kind).toBe('list')
    expect(paragraphs[1]!.text).toBe(list)
  })

  it('classifies numbered lists too', () => {
    expect(toParagraphs('1. First\n2. Second')[0]!.kind).toBe('list')
  })

  describe('heading trails', () => {
    const doc = [
      '# Central Empire',
      '',
      'An absolute monarchy.',
      '',
      '## Government',
      '',
      'Three chambers.',
      '',
      '### The Crimson Sash',
      '',
      'Palace guards.',
      '',
      '## Religion',
      '',
      'The Mandate of Heaven.',
    ].join('\n')

    it('gives each paragraph the section it sits under', () => {
      const paragraphs = toParagraphs(doc)
      expect(paragraphs.map((p) => p.headings)).toEqual([
        [], //                                   # Central Empire
        ['Central Empire'], //                   An absolute monarchy.
        ['Central Empire'], //                   ## Government
        ['Central Empire', 'Government'], //     Three chambers.
        ['Central Empire', 'Government'], //     ### The Crimson Sash
        ['Central Empire', 'Government', 'The Crimson Sash'], // Palace guards.
        ['Central Empire'], //                   ## Religion — a sibling of Government
        ['Central Empire', 'Religion'], //       The Mandate of Heaven.
      ])
    })

    it('closes a deeper section when a shallower heading arrives', () => {
      // '## Religion' is a sibling of '## Government', so text under it must
      // inherit neither Government nor the '### The Crimson Sash' inside it.
      const religion = toParagraphs(doc).at(-1)!
      expect(religion.headings).toEqual(['Central Empire', 'Religion'])
      expect(religion.headings).not.toContain('The Crimson Sash')
      expect(religion.headings).not.toContain('Government')
    })

    it('labels a heading with its ancestors, not with itself', () => {
      expect(toParagraphs(doc)[0]!.headings).toEqual([])
      expect(toParagraphs(doc)[0]!.kind).toBe('heading')
    })
  })
})

describe('layout tables', () => {
  /** The wiki-article shape: infobox cell, then the whole article in one cell. */
  const article = (body: string) =>
    ['| Infobox | ' + body + ' |', '| :---- | ----- |'].join('\n')

  const longBody = [
    'The Republic of Andras is an aristocratic republic consisting of three protectorates, each considered the dominion of one of three parties.',
    'The nobility of Andras came into power due to their innate magical gifts, which set them apart from the common people of the northeast.',
    'Delacia to the south is the most populous of the three domains, holding most of the Republic’s cities and its major towns and ports.',
    'Eszakia to the north belongs to the Church of Syrath, and consists of the holy city of St Leir and the surrounding highlands and moors.',
    'Local governance in the northern domain is the responsibility of bishops and priests appointed directly by the Church rather than the Veche.',
  ].join('  ')

  it('unpacks an article hidden in a table cell into real paragraphs', () => {
    const paragraphs = toParagraphs(article(longBody))
    expect(paragraphs.length).toBeGreaterThan(4)
    expect(paragraphs[0]!.text).toBe('Infobox')
    expect(paragraphs[1]!.text).toBe(
      'The Republic of Andras is an aristocratic republic consisting of three protectorates, each considered the dominion of one of three parties.',
    )
  })

  it('keeps every piece a substring of the document, so a quote stays findable', () => {
    const markdown = article(longBody)
    for (const paragraph of toParagraphs(markdown)) {
      expect(markdown).toContain(paragraph.text)
    }
  })

  it('tolerates one short piece — a section heading inside the table', () => {
    // Judging on the shortest piece rather than the median rejected three real
    // documents over the literal string 'Government & Politics'.
    const paragraphs = toParagraphs(article(`Government & Politics  ${longBody}`))
    expect(paragraphs.map((p) => p.text)).toContain('Government & Politics')
    expect(paragraphs.length).toBeGreaterThan(5)
  })

  it('leaves a real data table alone however long it is', () => {
    // Renic-Timekeeping: 13 rows, no cell over 20 characters.
    const table = [
      '| Month Number | Imperial Name | Literary Name |',
      '| :---: | :---: | :---: |',
      ...Array.from({ length: 13 }, (_, i) => `| ${i + 1} | Moon ${i + 1} | Plum Moon |`),
    ].join('\n')

    const paragraphs = toParagraphs(table)
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]!.kind).toBe('table')
  })

  it('leaves a many-rowed table alone even when one cell is long', () => {
    // Rough-Timeline is a genuine 23-row `| year | event |` table with an
    // 870-character cell. Splitting it would separate every date from its event.
    const rows = Array.from(
      { length: 23 },
      (_, i) => `| ${i} PD | ${'An event of considerable consequence occurred. '.repeat(20)} |`,
    )
    const table = ['| Year | Event |', '| ----: | :---- |', ...rows].join('\n')
    expect(toParagraphs(table)).toHaveLength(1)
  })

  it('refuses to split content that is made of spaces', () => {
    // ASCII maps: splitting on runs of spaces would produce confetti, so the
    // median guard keeps the cell whole.
    const art = '....GT....   .    #   .   .____#___.   /    #   \\   . '.repeat(20)
    const paragraphs = toParagraphs(`| ${art} | x |`)
    expect(paragraphs).toHaveLength(1)
  })
})

describe('renderForPrompt', () => {
  it('shows the model the anchor it is being asked to cite', () => {
    expect(renderForPrompt(toParagraphs('# Andras\n\nAn aristocratic republic.'))).toBe(
      '[¶0] # Andras\n\n[¶1] An aristocratic republic.',
    )
  })

  it('numbers so that every marker indexes straight back into toParagraphs', () => {
    const paragraphs = toParagraphs('A.\n\nB.\n\nC.')
    const rendered = renderForPrompt(paragraphs)
    for (const paragraph of paragraphs) {
      expect(rendered).toContain(`[¶${paragraph.index}] ${paragraph.text}`)
    }
  })
})
