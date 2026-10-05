import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { setGitHubAuthError } from '$store/renderer/slices/github-auth/github-auth-slice';
import { preview } from './github-auth-modal.preview.svelte';

describe('GitHub auth modal previews', () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose = store.init();
  });
  afterEach(() => dispose());

  it.each(Object.keys(preview.states))(
    'restores auth state after %s without starting OAuth',
    (name) => {
      store.dispatch(setGitHubAuthError('Previous error'));
      const previous = store.state.githubAuth;
      const restore = preview.states[name].setup?.();
      expect(typeof restore).toBe('function');
      if (typeof restore === 'function') restore();
      expect(store.state.githubAuth).toEqual(previous);
    },
  );
});
