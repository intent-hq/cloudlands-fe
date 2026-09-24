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
  it.each([
    '**Locating collection links**',
    '# Locating collection links',
    'Locating collection links\n---',
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
