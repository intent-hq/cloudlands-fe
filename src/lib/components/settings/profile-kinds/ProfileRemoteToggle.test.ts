/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import type { EnvRow } from '$features/settings/profile-env-form';
import ProfileRemoteToggle from './ProfileRemoteToggle.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

const row = (key: string, value: string): EnvRow => ({ rowId: key, key, mode: 'value', value });
const toggle = () =>
  screen.getByRole('switch', { name: m.settings_providerRemote_useOnRemote_label() });

afterEach(() => cleanup());

describe('ProfileRemoteToggle', () => {
  it('reads off while an account folder is set and restores the choice once it is removed', async () => {
    const view = render(ProfileRemoteToggle, {
      props: { rows: [row('CODEX_HOME', '~/.codex-2')], checked: true },
    });
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(toggle().hasAttribute('disabled')).toBe(true);
    await view.rerender({ rows: [row('ANTHROPIC_MODEL', 'opus')], checked: true });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(toggle().hasAttribute('disabled')).toBe(false);
  });

  it('turning it off hides the warnings', async () => {
    render(ProfileRemoteToggle, { props: { rows: [row('AWS_PROFILE', 'work')], checked: true } });
    expect(screen.getByTestId('provider-profile-remote-warnings')).toBeTruthy();
    await fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByTestId('provider-profile-remote-warnings')).toBeNull();
  });
});
