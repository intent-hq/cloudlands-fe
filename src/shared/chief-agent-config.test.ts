import { describe, expect, it } from 'vitest';
import { buildChiefBehaviorPrompt, CHIEF_RUNTIME_IDENTITY } from './chief-agent-config';

describe('Chief agent configuration', () => {
  it('places the non-customizable app-level identity before configured instructions', () => {
    const prompt = buildChiefBehaviorPrompt('## Custom Instructions\n\nBe concise.');

    expect(prompt.startsWith(CHIEF_RUNTIME_IDENTITY)).toBe(true);
    expect(prompt).toContain('You are not a repository coding agent.');
    expect(prompt).toContain('## Custom Instructions\n\nBe concise.');
  });

  it('keeps the Chief identity when configured instructions are unavailable', () => {
    expect(buildChiefBehaviorPrompt()).toBe(CHIEF_RUNTIME_IDENTITY);
  });
});
