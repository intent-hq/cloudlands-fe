import { describe, expect, it } from 'vitest';
import { extractReasoningHistory } from '../reasoning-heading';

describe('extractReasoningHistory', () => {
  it('splits meaningful headings throughout a reasoning block in source order', () => {
    expect(
      extractReasoningHistory(
        [
          'Unlabeled opening context.',
          '',
          '## Activating the app',
          '',
          'Activation body.',
          '',
          'Reviewing task status',
          '',
          'Status body.',
          '',
          'Strong section',
          '--------------',
          '',
          'Setext body.',
        ].join('\n'),
      ),
    ).toEqual([
      { title: null, body: 'Unlabeled opening context.' },
      { title: 'Activating the app', body: 'Activation body.' },
      { title: 'Reviewing task status', body: 'Status body.' },
      { title: 'Strong section', body: 'Setext body.' },
    ]);
  });

  it('splits strong-only headings and keeps each title and body once', () => {
    expect(
      extractReasoningHistory(
        '**Reviewing features**\n\nFirst body.\n\n**Checking title paths**\n\nSecond body.',
      ),
    ).toEqual([
      { title: 'Reviewing features', body: 'First body.' },
      { title: 'Checking title paths', body: 'Second body.' },
    ]);
  });

  it('keeps a final safe short heading as a title-only row', () => {
    expect(
      extractReasoningHistory('First section\n\nFirst body.\n\nReviewing task status'),
    ).toEqual([
      { title: 'First section', body: 'First body.' },
      { title: 'Reviewing task status', body: '' },
    ]);
  });

  it('does not promote ordinary paragraph prose or headings inside fences', () => {
    const content =
      'This paragraph explains the work in ordinary prose.\n\n```md\n## Not a section\n```';
    expect(extractReasoningHistory(content)).toEqual([{ title: null, body: content }]);
    expect(extractReasoningHistory('This paragraph explains the work')).toEqual([
      { title: null, body: 'This paragraph explains the work' },
    ]);
  });
});
