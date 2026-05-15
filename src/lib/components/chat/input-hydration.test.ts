import {
  describe,
  expect,
  it,
} from 'vitest';

import { resolveHydratedInputModel } from './input-hydration';

describe('resolveHydratedInputModel', () => {
  it('prefers the restored session model over the fallback agent model', () => {
    expect(resolveHydratedInputModel({ model: 'codex:gpt-5-codex' } as any, 'gpt5.4')).toBe(
      'codex:gpt-5-codex',
    );
  });

  it('does not reuse the fallback agent model before session hydration completes', () => {
    expect(resolveHydratedInputModel(undefined, 'codex:gpt-5-codex')).toBeUndefined();
  });

  it('falls back only after a session exists but has no persisted model', () => {
    expect(resolveHydratedInputModel({ model: undefined } as any, 'gpt5.4')).toBe('gpt5.4');
  });
});