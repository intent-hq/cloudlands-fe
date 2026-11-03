/**
 * @vitest-environment jsdom
 *
 * No toasts in the notch: the conversation's composer status line shows only
 * failures (error, warning) and notices whose button is the only way to act
 * (e.g. Undo). Plain info and success notices never appear there and are
 * cleared instead of lingering in the store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { toast } from '$lib/components/ui/toast';
import DockConversationNotifications from './DockConversationNotifications.svelte';

afterEach(() => toast.dismiss());

const active = () => toast.getActiveToasts().map((item) => String(item.title));
const register = () => () => {};

describe('DockConversationNotifications', () => {
  it('never shows plain info or success, and clears them', async () => {
    render(DockConversationNotifications, { props: { register } });
    toast.info('Model switched');
    toast.success('Saved');
    await waitFor(() => expect(active()).toEqual([]));
    expect(document.querySelector('[data-dock-notice]')).toBeNull();
  });

  it('shows failures and actionable notices', async () => {
    render(DockConversationNotifications, { props: { register } });
    toast.error('Could not attach the image');
    await waitFor(() => expect(screen.getByText('Could not attach the image')).toBeTruthy());
    toast('Prompt enhanced', { action: { label: 'Undo', onClick: () => {} } });
    await waitFor(() => expect(screen.getByText('Prompt enhanced')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    toast.warning('Running low on context');
    await waitFor(() => expect(screen.getByText('Running low on context')).toBeTruthy());
  });
});
