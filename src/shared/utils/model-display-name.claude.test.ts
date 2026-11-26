import { describe, expect, it } from 'vitest';
import { prettyClaudeModelName } from './model-display-name';

describe('prettyClaudeModelName', () => {
  it.each([
    ['opus', 'Opus'],
    ['sonnet', 'Sonnet'],
    ['haiku', 'Haiku'],
    ['claude-fable-5-1[1m]', 'Fable 5.1 (1M context)'],
    ['claude-sonnet-4-5', 'Sonnet 4.5'],
  ])('%s -> %s', (id, label) => expect(prettyClaudeModelName(id)).toBe(label));

  it.each(['gpt-5', 'some/model', '', 'default', 'claude-opus-4-1-20250805'])('ignores %s', (id) =>
    expect(prettyClaudeModelName(id)).toBeUndefined(),
  );
});
