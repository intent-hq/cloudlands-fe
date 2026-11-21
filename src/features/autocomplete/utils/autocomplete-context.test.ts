import { describe, expect, it } from 'vitest';
import {
  AUTOCOMPLETE_CONTEXT_MAX_CHARS,
  AUTOCOMPLETE_CONVERSATION_CHARS,
  autocompleteTurnsFromMessages,
  buildAutocompleteContext,
} from './autocomplete-context';

describe('buildAutocompleteContext', () => {
  it('labels turns and appends the suggested prompts', () => {
    const context = buildAutocompleteContext(
      [
        { role: 'user', text: 'Add the badge' },
        { role: 'assistant', text: 'Done, PR #4846 is open.' },
      ],
      ['Show me screenshots', '  Merge it  '],
    );
    expect(context).toBe(
      'User: Add the badge\n\nAssistant: Done, PR #4846 is open.\n\n' +
        'Suggested prompts:\n- Show me screenshots\n- Merge it',
    );
  });

  it('keeps only the last 2,000 characters of the conversation', () => {
    const long = 'a'.repeat(3000) + 'END';
    const context = buildAutocompleteContext([{ role: 'assistant', text: long }], []);
    expect(context).toHaveLength(AUTOCOMPLETE_CONVERSATION_CHARS);
    expect(context.endsWith('END')).toBe(true);
  });

  it('keeps the suggested prompts whole when the conversation is long', () => {
    const context = buildAutocompleteContext(
      [{ role: 'assistant', text: 'x'.repeat(5000) }],
      ['Ship it'],
    );
    expect(context.endsWith('Suggested prompts:\n- Ship it')).toBe(true);
    expect(context.length).toBeLessThanOrEqual(AUTOCOMPLETE_CONTEXT_MAX_CHARS);
  });

  it('never exceeds the 4,000-character wire cap', () => {
    const prompts = Array.from({ length: 10 }, () => 'p'.repeat(800));
    const context = buildAutocompleteContext(
      [{ role: 'user', text: 'u'.repeat(5000) }],
      prompts,
    );
    expect(context.length).toBeLessThanOrEqual(AUTOCOMPLETE_CONTEXT_MAX_CHARS);
  });

  it('returns only the prompts when there is no conversation, and empty for nothing', () => {
    expect(buildAutocompleteContext([], ['Hi'])).toBe('Suggested prompts:\n- Hi');
    expect(buildAutocompleteContext([], [])).toBe('');
  });
});

describe('autocompleteTurnsFromMessages', () => {
  it('reads user and assistant text, skipping other roles and non-text blocks', () => {
    const turns = autocompleteTurnsFromMessages([
      { role: 'system', contentBlocks: [{ type: 'text', text: 'hidden' }] },
      { role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }] },
      {
        role: 'assistant',
        contentBlocks: [
          { type: 'thinking', text: 'secret reasoning' },
          { type: 'text', text: 'Hi ' },
          { type: 'tool_use', text: 'tool' },
          { type: 'text', content: 'there' },
        ],
      },
      { role: 'assistant', contentBlocks: [] },
    ]);
    expect(turns).toEqual([
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi there' },
    ]);
  });

  it('strips the suggested-prompts block from assistant text', () => {
    const turns = autocompleteTurnsFromMessages([
      {
        role: 'assistant',
        contentBlocks: [
          {
            type: 'text',
            text: 'All done.\n\n<!-- suggested-prompts\nShow me the diff\n-->',
          },
        ],
      },
    ]);
    expect(turns).toEqual([{ role: 'assistant', text: 'All done.' }]);
  });

  it('stops walking back once enough text is collected', () => {
    const turns = autocompleteTurnsFromMessages(
      [
        { role: 'user', contentBlocks: [{ type: 'text', text: 'old' }] },
        { role: 'assistant', contentBlocks: [{ type: 'text', text: 'x'.repeat(30) }] },
        { role: 'user', contentBlocks: [{ type: 'text', text: 'newest' }] },
      ],
      20,
    );
    expect(turns.map((turn) => turn.text)).toEqual(['x'.repeat(30), 'newest']);
  });
});
