import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
const mocks = vi.hoisted(() => ({ search: vi.fn(), destroy: vi.fn() }));
vi.mock('../discussion-reference-search', () => ({
  createDiscussionReferenceSearch: () => ({
    initial: () => [{ value: '[Astra](intent://local/ws/agent/agent-1)', label: 'Astra' }],
    search: mocks.search,
    destroy: mocks.destroy,
  }),
}));
import { m } from '$shared/paraglide/messages.js';
import DiscussionReferencePicker from './DiscussionReferencePicker.svelte';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('discussion reference picker', () => {
  it('opens real reference choices and inserts the selected canonical link', async () => {
    const onSelect = vi.fn();
    render(DiscussionReferencePicker, { workspaceId: 'ws', onSelect });
    await fireEvent.click(
      screen.getByRole('button', { name: m.workspace_discussion_reference_label() }),
    );
    await fireEvent.focus(screen.getByRole('combobox'));
    await fireEvent.pointerUp(await screen.findByRole('option', { name: 'Astra' }), {
      pointerType: 'mouse',
      button: 0,
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('[Astra](intent://local/ws/agent/agent-1)');
  });
  it('searches within the discussion workspace and cancels search on removal', async () => {
    mocks.search.mockResolvedValue([
      { value: '[main.ts](intent://local/ws/file/src/main.ts)', label: 'main.ts' },
    ]);
    const view = render(DiscussionReferencePicker, { workspaceId: 'ws', onSelect: vi.fn() });
    await fireEvent.click(
      screen.getByRole('button', { name: m.workspace_discussion_reference_label() }),
    );
    await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'main' } });
    expect(await screen.findByRole('option', { name: 'main.ts' })).toBeTruthy();
    expect(mocks.search).toHaveBeenCalledWith('main', 'ws');
    const before = mocks.destroy.mock.calls.length;
    view.unmount();
    expect(mocks.destroy.mock.calls.length).toBeGreaterThan(before);
  });
});
