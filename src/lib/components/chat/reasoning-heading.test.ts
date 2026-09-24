import { describe, expect, it } from 'vitest';
import {
  extractReasoningHeading,
  extractReasoningHistory,
  extractStandaloneReasoningTitle,
  extractStandaloneReasoningTitles,
} from './reasoning-heading';

describe('extractReasoningHeading', () => {
  it('extracts a formatted Markdown heading after leading blank lines', () => {
    expect(
      extractReasoningHeading('\n \n## **Considering** `task` restoration\n\nBody paragraph.'),
    ).toEqual({
      heading: 'Considering task restoration',
      body: 'Body paragraph.',
    });
  });

  it('extracts a setext heading and removes it once', () => {
    expect(extractReasoningHeading('\r\n**Restore** task\r\n---\r\n\r\nRestore task\r\n')).toEqual({
      heading: 'Restore task',
      body: 'Restore task\r\n',
    });
  });

  it('accepts a short formatted title line separated from its body', () => {
    expect(
      extractReasoningHeading('**Considering task restoration**\n\nCheck the saved state.'),
    ).toEqual({
      heading: 'Considering task restoration',
      body: 'Check the saved state.',
    });
  });

  it('keeps long and paragraph-like headingless content in the body', () => {
    const long = `${'A detailed explanation '.repeat(6).trim()}\n\nMore detail.`;
    expect(extractReasoningHeading(long)).toEqual({ heading: null, body: long });

    const paragraph = 'I will inspect the restored task before I continue.\n\nMore detail.';
    expect(extractReasoningHeading(paragraph)).toEqual({ heading: null, body: paragraph });
  });

  it('does not promote a short line until body content follows the separator', () => {
    const content = 'Considering task restoration\n\n';
    expect(extractReasoningHeading(content)).toEqual({ heading: null, body: content });
  });
});

describe('extractReasoningHistory', () => {
  it('keeps each explicit title when a paragraph arrives on the final heading', () => {
    const titles = '**Preparing task plan**\n\n**Checking duplicate tracker issue**';
    expect(extractReasoningHistory(titles)).toEqual([
      { title: 'Preparing task plan', body: '' },
      { title: 'Checking duplicate tracker issue', body: '' },
    ]);
    const body = 'The supplied paragraph stays readable.\n\nA second paragraph stays in order.';
    expect(extractReasoningHistory(`${titles}\n\n${body}`)).toEqual([
      { title: 'Preparing task plan', body: '' },
      { title: 'Checking duplicate tracker issue', body },
    ]);
  });

  it('extracts every consecutive reasoning title before the body', () => {
    expect(
      extractReasoningHistory(
        [
          'Assessing delegation and tool availability',
          '**Inspecting workspace_api method names**',
          '**Searching workspace.set method descriptions**',
          '**Planning workspace API title setting**',
          'Use the matching workspace method after the inspection.',
        ].join('\n\n'),
      ),
    ).toEqual([
      { title: 'Assessing delegation and tool availability', body: '' },
      { title: 'Inspecting workspace_api method names', body: '' },
      { title: 'Searching workspace.set method descriptions', body: '' },
      {
        title: 'Planning workspace API title setting',
        body: 'Use the matching workspace method after the inspection.',
      },
    ]);
  });

  it('stops title extraction when ordinary body content starts', () => {
    expect(
      extractReasoningHistory(
        'Assessing delegation and tool availability\n\nBody paragraph.\n\n**Emphasized body text**',
      ),
    ).toEqual([
      {
        title: 'Assessing delegation and tool availability',
        body: 'Body paragraph.\n\n**Emphasized body text**',
      },
    ]);
  });

  it('retains the existing history fallback for separate bold fragments', () => {
    const content = '**I** will inspect **schema**';
    expect(extractReasoningHeading(content)).toEqual({ heading: null, body: content });
    expect(extractReasoningHistory(content)).toEqual([
      { title: 'I will inspect schema', body: '' },
    ]);
  });
});

describe('explicit standalone reasoning titles', () => {
  describe.each([
    ['bold-only', (text: string) => `**${text}**`],
    ['ATX', (text: string) => `## ${text}`],
    ['setext', (text: string) => `${text}\n---`],
  ] as const)('readable %s titles', (_style, heading) => {
    it.each([
      ['Checking `src/*.ts` files', 'Checking src/*.ts files'],
      ['Comparing a < b and c > d', 'Comparing a < b and c > d'],
      ['Checking _private field', 'Checking _private field'],
      ['Reading &amp; writing', 'Reading & writing'],
      ['Reading &#35; and &#x1F600; entities', 'Reading # and 😀 entities'],
      ['Reading `&amp;` literally', 'Reading &amp; literally'],
      ['Checking \\*literal\\* marks', 'Checking *literal* marks'],
      ['Checking *active* and ~~old~~ paths', 'Checking active and old paths'],
      ['Reading [docs](https://example.com) links', 'Reading docs links'],
      ['Reading ![diagram](https://example.com/a.png) labels', 'Reading diagram labels'],
      ['Checking ~one~ path', 'Checking ~one~ path'],
      ['Reading `<tag>_x~*` literally', 'Reading <tag>_x~* literally'],
    ])('preserves the readable inline text in %s', (source, expected) => {
      expect(extractStandaloneReasoningTitles(heading(source))).toEqual([expected]);
    });
  });

  it.each([
    '**Checking `src/*.ts` &amp; _private**',
    '## Checking `src/*.ts` &amp; _private',
    'Checking `src/*.ts` &amp; _private\n---',
  ])('can preserve a disclosure title without changing its exact body: %s', (title) => {
    const body = '  Body with `src/*.ts`, _private and &amp;.\n\nAnother paragraph.\n';
    expect(extractReasoningHeading(`${title}\n\n${body}`, { preserveInlineText: true })).toEqual({
      heading: 'Checking src/*.ts & _private',
      body,
    });
    expect(extractReasoningHeading(`${title}\n\n${body}`)).toEqual({
      heading: 'Checking src/.ts &amp; private',
      body,
    });
  });

  it.each([
    ['Checking `src/*.ts` files', 'Checking src/.ts files'],
    ['Comparing a < b and c > d', 'Comparing a d'],
    ['Checking _private field', 'Checking private field'],
    ['Reading &amp; writing', 'Reading &amp; writing'],
  ])('retains the legacy general/history projection for %s', (source, legacyTitle) => {
    const content = `**${source}**\n\nBody paragraph.`;
    expect(extractReasoningHeading(content)).toEqual({
      heading: legacyTitle,
      body: 'Body paragraph.',
    });
    expect(extractReasoningHistory(content)).toEqual([
      { title: legacyTitle, body: 'Body paragraph.' },
    ]);
    expect(extractStandaloneReasoningTitle(`**${source}**`)).toBe(legacyTitle);
  });

  it.each([
    '    code\n---',
    '\tcode\n---',
    '\t# Read source',
    'Read source\n\t---',
    '- Read source\n---',
    '1. Read source\n---',
    '> Read source\n---',
    '```text\n---',
    '<div>Read source</div>\n---',
    '[source]: file.ts\n---',
    '---\n---',
  ])('keeps non-heading Markdown blocks after a title in the body: %s', (body) => {
    const content = `# Plan\n\n${body}`;
    expect(extractStandaloneReasoningTitles(content)).toBeNull();
    expect(extractReasoningHeading(content)).toEqual({ heading: 'Plan', body });
    expect(extractReasoningHistory(content)).toEqual([{ title: 'Plan', body: body.trim() }]);
  });

  it.each([
    '** Read source**',
    '**Read source **',
    '**\tRead source**',
    '**Read source\\**',
    '***Read source**',
    '**Read source***',
  ])('keeps literal strong delimiters as body text: %s', (content) => {
    expect(extractStandaloneReasoningTitles(content)).toBeNull();
    expect(extractReasoningHeading(content)).toEqual({ heading: null, body: content });
  });

  it.each([
    '**Locating collection links**',
    '# Locating collection links',
    'Locating collection links\n---',
    '   ## Locating collection links',
    '   Locating collection links\n   ---',
    '**Locating** `collection` links\n===',
  ])('classifies explicit title-only content: %s', (content) => {
    expect(extractStandaloneReasoningTitles(content)).toEqual(['Locating collection links']);
  });

  it('keeps mixed heading styles in source order, including duplicate titles', () => {
    expect(
      extractStandaloneReasoningTitles(
        '\n**Preparing task plan**\n\n## Checking duplicate tracker issue\n\nPreparing task plan\n===\n',
      ),
    ).toEqual(['Preparing task plan', 'Checking duplicate tracker issue', 'Preparing task plan']);
  });

  it.each([
    '',
    ' \n\t',
    'Let me check the schema',
    '**Locating collection links',
    '**Locating collection links** with more prose.',
    '**I** will inspect **schema**',
    '**Locating collection links**\n\nLet me check the schema',
    '# Locating collection links\n\nLet me check the schema',
    '    # Locating collection links',
    '```\n# Locating collection links\n```',
  ])('retains non-title content in the disclosure path: %s', (content) => {
    expect(extractStandaloneReasoningTitles(content)).toBeNull();
  });

  it('stops classifying a multi-heading summary as title-only when its body arrives', () => {
    const content = '**Preparing task plan**\n\n**Checking duplicate tracker issue**';
    expect(extractStandaloneReasoningTitles(content)).toHaveLength(2);
    expect(extractStandaloneReasoningTitles(`${content}\n\nReadable body.`)).toBeNull();
    expect(
      extractStandaloneReasoningTitles(`${content}\n\n**I** will inspect **schema**`),
    ).toBeNull();
  });

  it('recognizes a complete bold-only summary without inventing a body', () => {
    expect(extractStandaloneReasoningTitle('**Locating collection links**')).toBe(
      'Locating collection links',
    );
    expect(extractReasoningHistory('**Locating collection links**')).toEqual([
      { title: 'Locating collection links', body: '' },
    ]);
  });

  it.each([
    'Let me check the schema',
    '**Locating collection links',
    '**Locating collection links** with more prose.',
    '**Locating collection links**\n\nReadable body.',
  ])('does not call body prose or incomplete markup a standalone title: %s', (content) => {
    expect(extractStandaloneReasoningTitle(content)).toBeNull();
  });

  it('preserves the headingless short-prose disclosure input', () => {
    expect(extractReasoningHeading('Let me check the schema')).toEqual({
      heading: null,
      body: 'Let me check the schema',
    });
  });
});
