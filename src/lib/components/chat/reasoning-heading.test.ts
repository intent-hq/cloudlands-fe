import { describe, expect, it } from 'vitest';
import {
  extractReasoningDisclosureHeading,
  extractReasoningHeading,
  extractReasoningHistory,
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

describe('extractReasoningDisclosureHeading', () => {
  it('promotes a specific formatted title after a generic provider heading', () => {
    expect(
      extractReasoningDisclosureHeading(
        'Reasoning\n\n**Invoking workspace API to set title**\n\nCall the matching method.',
      ),
    ).toEqual({
      heading: 'Invoking workspace API to set title',
      body: 'Call the matching method.',
    });
  });

  it('promotes only the first specific title and preserves later titles and body', () => {
    expect(
      extractReasoningDisclosureHeading(
        'Thinking...\n\n**Inspecting state**\n\n**Calling the API**\n\nApply the result.',
      ),
    ).toEqual({
      heading: 'Inspecting state',
      body: '**Calling the API**\n\nApply the result.',
    });
  });

  it('keeps a generic heading when only ordinary body prose follows', () => {
    expect(extractReasoningDisclosureHeading('Reasoning\n\nInspect the current state.')).toEqual({
      heading: 'Reasoning',
      body: 'Inspect the current state.',
    });
  });

  it('strips inline Markdown from the promoted title', () => {
    expect(
      extractReasoningDisclosureHeading(
        'Reasoning\n\n**Invoking [workspace API](https://example.test) to set `title`**',
      ),
    ).toEqual({ heading: 'Invoking workspace API to set title', body: '' });
  });

  it.each([`**${'Detailed '.repeat(11).trim()}**`, `**${'x'.repeat(81)}**`])(
    'does not promote a title outside the existing limits: %s',
    (candidate) => {
      const content = `Reasoning\n\n${candidate}`;
      expect(extractReasoningDisclosureHeading(content)).toEqual({
        heading: 'Reasoning',
        body: candidate,
      });
    },
  );

  it.each(['reasoning...', 'REASONING…', 'Thinking!', 'thinking —'])(
    'recognizes generic headings without case or punctuation sensitivity: %s',
    (generic) => {
      expect(extractReasoningDisclosureHeading(`${generic}\n\n**Inspecting state**`)).toEqual({
        heading: 'Inspecting state',
        body: '',
      });
    },
  );
});

describe('extractReasoningHistory', () => {
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

  it('extracts an explicit strong-only heading after ordinary body content', () => {
    expect(
      extractReasoningHistory(
        'Assessing delegation and tool availability\n\nBody paragraph.\n\n**Emphasized body text**',
      ),
    ).toEqual([
      {
        title: 'Assessing delegation and tool availability',
        body: 'Body paragraph.',
      },
      { title: 'Emphasized body text', body: '' },
    ]);
  });
});
