import { describe, expect, it } from 'vitest';
import { extractReasoningHeading } from './reasoning-heading';

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
