import {
  describe,
  expect,
  it,
} from 'vitest';

import { resolveHydratedInputModel } from './input-hydration';

describe('resolveHydratedInputModel', () => {
  it('prefers the restored session model over the fallback agent model', () => {
    expect(resolveHydratedInputModel({ model: 'codex:gpt-5-codex' }, 'gpt5.4')).toBe(
      'codex:gpt-5-codex',
    );
  });

  it('does not reuse the fallback agent model before session hydration completes', () => {
    expect(resolveHydratedInputModel(undefined, 'codex:gpt-5-codex')).toBeUndefined();
  });

  it('returns undefined when session has no persisted model (no client-side fallback)', () => {
    expect(resolveHydratedInputModel({ model: undefined }, 'gpt5.4')).toBeUndefined();
  });

  it('returns session.model when it is null (BE persisted null)', () => {
    expect(resolveHydratedInputModel({ model: null }, 'gpt5.4')).toBeNull();
  });
});