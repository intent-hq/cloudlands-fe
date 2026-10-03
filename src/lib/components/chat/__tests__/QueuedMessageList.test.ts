/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { WORKSPACE_ROUTE_CONTEXT } from '$lib/utils/workspace-route-context';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

import QueuedMessageList from '../QueuedMessageList.svelte';
import QueuedMessageEditMotionHost from './QueuedMessageEditMotionHost.svelte';
import { resolveAttachmentImageUrl } from '../attachment-image-url';

function renderQueue(options: {
  props: ComponentProps<typeof QueuedMessageList>;
  context?: Map<symbol, unknown>;
}) {
  return render(QueuedMessageList, {
    ...options,
    props: { ownPrincipalId: 'self', ...options.props },
  });
}

function queued(overrides: Partial<QueuedMessage>): QueuedMessage {
  return {
    id: 'q-1',
    content: 'hello',
    queuedAt: '2026-01-01T00:00:00.000Z',
    position: 0,
    messageMetadata: { fromPrincipalId: 'self' },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function buttonTooltips(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button[tooltip]')).map(
    (b) => b.getAttribute('tooltip') ?? '',
  );
}

describe('QueuedMessageList', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  it('bulk actions select only messages the admitted principal can mutate', async () => {
    const onsendall = vi.fn().mockResolvedValue('queued');
    const onclearall = vi.fn().mockResolvedValue(undefined);
    renderQueue({
      props: {
        ownPrincipalId: 'self',
        messages: [
          queued({ id: 'own' }),
          queued({ id: 'foreign', messageMetadata: { fromPrincipalId: 'other' } }),
        ],
        onsendall,
        onclearall,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send all ready messages now' }));
    await waitFor(() => expect(onsendall).toHaveBeenCalledWith(['own']));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear all queued messages' }));
    await waitFor(() => expect(onclearall).toHaveBeenCalledWith(['own']));
  });

  it('host-owner bulk send excludes script-monitor wakes', async () => {
    const onsendall = vi.fn().mockResolvedValue('queued');
    renderQueue({
      props: {
        isHostOwner: true,
        messages: [
          queued({ id: 'human' }),
          queued({ id: 'imported', messageMetadata: { humanAuthor: {} } }),
          queued({ id: 'held', holdKind: 'debounce', holdUntil: '2099-01-01T00:00:00Z' }),
          queued({
            id: 'monitor',
            messageMetadata: { type: 'script_monitor_wake', monitorId: 'monitor-1' },
          }),
        ],
        onsendall,
        onsendnow: vi.fn(),
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Send all ready messages now' }));
    await waitFor(() => expect(onsendall).toHaveBeenCalledWith(['human']));
    expect(screen.getAllByRole('button', { name: 'Send immediately' })).toHaveLength(3);
  });

  describe('shared queue permissions', () => {
    it.each(['participant', 'owner', 'host-owner'])(
      'guards foreign edit entry points for a %s',
      async (role) => {
        const onedit = vi.fn();
        const onremove = vi.fn();
        const onsendnow = vi.fn();
        const { component } = renderQueue({
          props: {
            messages: [queued({ messageMetadata: { fromPrincipalId: 'alice' } })],
            ownPrincipalId: 'bob',
            isHostOwner: role === 'host-owner',
            ownerPrincipalId: role === 'owner' ? 'bob' : 'alice',
            onedit,
            onremove,
            onsendnow,
          },
        });
        const row = screen.getByTestId('queued-message-content');
        expect(screen.queryByRole('button', { name: 'Edit', exact: true })).toBeNull();
        await fireEvent.dblClick(row);
        await fireEvent.keyDown(row, { key: 'F2' });
        await fireEvent.keyDown(row, { key: 'Enter' });
        expect(component.editLastMessage()).toBe(false);
        expect(onedit).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox')).toBeNull();
        await fireEvent.keyDown(row, { key: 'Delete' });
        await fireEvent.keyDown(row, { key: 'Enter', ctrlKey: true });
        expect(onremove).toHaveBeenCalledTimes(role !== 'participant' ? 1 : 0);
        expect(onsendnow).toHaveBeenCalledTimes(role === 'host-owner' ? 1 : 0);
      },
    );

    it('up-arrow edits the latest own row, skipping later participants', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { component } = renderQueue({
        props: {
          ownPrincipalId: 'alice',
          messages: [
            queued({ id: 'alice-row', messageMetadata: { fromPrincipalId: 'alice' } }),
            queued({ id: 'bob-row', position: 1, messageMetadata: { fromPrincipalId: 'bob' } }),
          ],
          onedit,
        },
      });
      expect(component.editLastMessage()).toBe(true);
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('alice-row', 'hello', true));
    });

    it('does not infer authorship for unstamped or portable entries', async () => {
      const onedit = vi.fn();
      const { component } = renderQueue({
        props: {
          ownPrincipalId: 'alice',
          ownerPrincipalId: 'alice',
          messages: [
            queued({
              messageMetadata: undefined,
              author: { principalId: null, displayName: null, login: null, avatarUrl: null },
            }),
          ],
          onedit,
        },
      });
      expect(component.editLastMessage()).toBe(false);
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      expect(onedit).not.toHaveBeenCalled();
    });
  });

  it('keeps a member readable while editing and releases its original identity on cancel', async () => {
    const payload = {
      label: 'alice.dev_ops-team',
      principalId: 'gitlab-person',
      workspaceId: 'workspace',
      identity: { provider: 'gitlab', host: 'code.example', externalUserId: '42' },
    };
    const content = `Ask @member[${btoa(JSON.stringify(payload))}] please`;
    const onedit = vi.fn().mockResolvedValue({ success: true });
    renderQueue({ props: { messages: [queued({ content })], onedit } });
    await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
    const editor = await screen.findByRole('textbox');
    expect(editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent).toBe(
      'Ask @alice.dev_ops-team please',
    );
    const chip = editor.querySelector('[data-type="member"]');
    expect(JSON.parse(chip!.getAttribute('data-meta')!)).toEqual({
      principalId: payload.principalId,
      workspaceId: payload.workspaceId,
      identity: payload.identity,
    });
    await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', content, true));
    await fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(onedit).toHaveBeenLastCalledWith('q-1', content, false));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('presents a queued member as a handle while sending the original queued message', async () => {
    const payload = btoa(
      JSON.stringify({
        label: 'alice.dev',
        principalId: 'person',
        workspaceId: 'workspace',
        identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '42' },
      }),
    );
    const onsendnow = vi.fn();
    const message = queued({ content: `Ask @member[${payload}] please` });
    renderQueue({ props: { messages: [message], onsendnow } });
    const row = screen.getByTestId('queued-message-content');
    expect(row.getAttribute('aria-label')).toBe('Ask @alice.dev please');
    expect(screen.getByTestId('queued-message-text').textContent?.trim()).toBe(
      'Ask @alice.dev please',
    );
    await fireEvent.keyDown(row, { key: 'Enter', metaKey: true });
    expect(onsendnow).toHaveBeenCalledWith('q-1');
    expect(message.content).toBe(`Ask @member[${payload}] please`);
  });

  it('renders a regular queued message as raw text with the reference remove affordance', () => {
    const { container } = renderQueue({
      props: { messages: [queued({ content: 'run the tests' })] },
    });

    expect(screen.getByText('run the tests')).toBeTruthy();
    const tooltips = buttonTooltips(container);
    expect(tooltips).toContain('Remove');
  });

  it('supports reference edit, remove, and send-now keyboard interactions', async () => {
    const onedit = vi.fn().mockResolvedValue({ success: true });
    const onremove = vi.fn();
    const onsendnow = vi.fn();
    renderQueue({
      props: {
        messages: [queued({ content: 'A long queued message that stays on one line' })],
        onedit,
        onremove,
        onsendnow,
      },
    });

    const content = screen.getByTestId('queued-message-content');
    await fireEvent.keyDown(content, { key: 'F2' });
    await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', expect.any(String), true));
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    await fireEvent.keyDown(screen.getByTestId('queued-message-content'), {
      key: 'Enter',
      metaKey: true,
    });
    expect(onsendnow).toHaveBeenCalledWith('q-1');
    await fireEvent.keyDown(screen.getByTestId('queued-message-content'), { key: 'Delete' });
    expect(onremove).toHaveBeenCalledWith('q-1');
  });

  describe('edit action', () => {
    it('keeps an active draft stable when the daemon appends to the held entry', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const view = renderQueue({ props: { messages: [queued({ content: 'first' })], onedit } });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
      await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'edited first' } });
      await view.rerender({ messages: [queued({ content: 'first\n\nsecond', editing: true })] });
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('edited first');
      await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      await waitFor(() => expect(onedit).toHaveBeenLastCalledWith('q-1', 'edited first', false));
      // The daemon preserves the append suffix when accepting this held edit.
      await view.rerender({ messages: [queued({ content: 'edited first\n\nsecond' })] });
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
      expect(screen.getByTestId('queued-message-text').textContent).toContain(
        'edited first\n\nsecond',
      );
    });

    it.each(['save', 'cancel'])('preserves a migrated held draft through %s', async (action) => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const view = renderQueue({
        props: { messages: [queued({ id: 'newer', content: 'second' })], onedit },
      });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('newer', 'second', true));
      await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'edited second' } });
      await view.rerender({
        messages: [
          queued({
            id: 'older',
            content: 'first\n\nsecond',
            editing: true,
            editingMessageId: 'newer',
          }),
        ],
      });
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('edited second');
      await view.rerender({
        messages: [
          queued({
            id: 'older',
            content: 'first\n\nsecond\n\nthird',
            editing: true,
            editingMessageId: 'newer',
          }),
        ],
      });
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('edited second');
      await fireEvent.keyDown(screen.getByRole('textbox'), {
        key: action === 'save' ? 'Enter' : 'Escape',
      });
      await waitFor(() =>
        expect(onedit).toHaveBeenLastCalledWith(
          'newer',
          action === 'save' ? 'edited second' : 'second',
          false,
        ),
      );
      await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    });

    it.each([
      ['save', 'released', true],
      ['save', 'empty', true],
      ['cancel', 'released', true],
      ['cancel', 'empty', true],
      ['save', 'released', false],
      ['cancel', 'empty', false],
      ['save', 'empty', 'throw'],
      ['cancel', 'released', 'throw'],
      ['save', 'released', 'conflict'],
    ] as const)(
      'settles %s after an earlier %s snapshot (success: %s)',
      async (action, snapshot, success) => {
        const pending = deferred<{ success: boolean; error?: string }>();
        const onedit = vi
          .fn()
          .mockResolvedValueOnce({ success: true })
          .mockImplementationOnce(() => pending.promise);
        const view = renderQueue({
          props: { messages: [queued({ id: 'newer', content: 'second' })], onedit },
        });
        await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
        await waitFor(() => expect(onedit).toHaveBeenCalledTimes(1));
        await fireEvent.input(screen.getByRole('textbox'), {
          target: { value: 'my unsaved draft' },
        });
        await view.rerender({
          messages: [
            queued({
              id: 'older',
              content: 'first\n\nsecond',
              editing: true,
              editingMessageId: 'newer',
            }),
          ],
        });
        await fireEvent.keyDown(screen.getByRole('textbox'), {
          key: action === 'save' ? 'Enter' : 'Escape',
        });
        await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
        await view.rerender({
          messages:
            snapshot === 'empty'
              ? []
              : [queued({ id: 'older', content: 'first\n\nsecond', editing: false })],
        });
        expect(screen.queryByTestId('queued-draft-conflict')).toBeNull();
        if (success === 'throw') pending.reject(new Error('connection lost'));
        else
          pending.resolve(
            success === true
              ? { success: true }
              : {
                  success: false,
                  error:
                    success === 'conflict'
                      ? 'queued edit conflict: this draft was combined into another queued message; refresh before editing'
                      : 'release failed',
                },
          );
        await tick();
        await tick();
        if (success === true) {
          await waitFor(() => expect(screen.queryByTestId('queued-draft-conflict')).toBeNull());
        } else {
          expect((await screen.findByTestId('queued-draft-conflict')).textContent).toContain(
            'my unsaved draft',
          );
        }
        expect(screen.queryByRole('textbox')).toBeNull();
      },
    );

    it('retains input when a second editor hold is rejected after typing', async () => {
      const pending = deferred<{ success: boolean; error?: string }>();
      const onedit = vi.fn().mockImplementationOnce(() => pending.promise);
      renderQueue({
        props: {
          messages: [
            queued({ content: 'first\n\nsecond', editing: true, editingMessageId: 'q-1' }),
          ],
          onedit,
        },
      });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first\n\nsecond', true));
      await fireEvent.input(screen.getByRole('textbox'), {
        target: { value: 'my second-client unsaved draft' },
      });
      await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      expect(onedit).toHaveBeenCalledTimes(1);
      pending.resolve({
        success: false,
        error:
          'queued edit conflict: this draft was combined into another queued message; refresh before editing',
      });
      const conflict = await screen.findByTestId('queued-draft-conflict');
      expect(conflict.getAttribute('data-conflict-message-id')).toBe('q-1');
      expect(conflict.textContent).toContain('my second-client unsaved draft');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(onedit).toHaveBeenCalledTimes(1);
    });

    it('retains a displaced draft without submitting it to the other held row', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const view = renderQueue({
        props: {
          messages: [
            queued({ id: 'older', content: 'first', editing: true }),
            queued({ id: 'newer', content: 'second', position: 1 }),
          ],
          onedit,
        },
      });
      await fireEvent.dblClick(screen.getAllByTestId('queued-message-content')[1]);
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('newer', 'second', true));
      await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'unsaved second' } });
      await view.rerender({
        messages: [
          queued({
            id: 'older',
            content: 'first\n\nsecond',
            editing: true,
            editingMessageId: 'older',
          }),
        ],
      });
      const conflict = await screen.findByTestId('queued-draft-conflict');
      expect(conflict.getAttribute('data-conflict-message-id')).toBe('newer');
      expect(conflict.textContent).toContain('unsaved second');
      expect(within(conflict).queryByRole('textbox')).toBeNull();
      await fireEvent.keyDown(conflict, { key: 'Enter' });
      expect(onedit).toHaveBeenCalledTimes(1);
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      await fireEvent.click(within(conflict).getByRole('button', { name: 'Copy' }));
      expect(writeText).toHaveBeenCalledWith('unsaved second');
      await view.rerender({ messages: [queued({ id: 'unrelated', content: 'new input' })] });
      expect(screen.getByTestId('queued-draft-conflict').textContent).toContain('unsaved second');
      expect(screen.queryByRole('textbox')).toBeNull();
      await fireEvent.click(within(conflict).getByRole('button', { name: 'Discard draft' }));
      expect(screen.queryByTestId('queued-draft-conflict')).toBeNull();
    });

    it('preserves the draft when a migrated save conflicts after another client releases', async () => {
      const onedit = vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({
        success: false,
        error:
          'queued edit conflict: this draft was combined into another queued message; refresh before editing',
      });
      const view = renderQueue({
        props: { messages: [queued({ id: 'newer', content: 'second' })], onedit },
      });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(1));
      await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'keep me' } });
      await view.rerender({
        messages: [
          queued({
            id: 'older',
            content: 'first\n\nsecond',
            editing: true,
            editingMessageId: 'newer',
          }),
        ],
      });
      await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      expect((await screen.findByTestId('queued-draft-conflict')).textContent).toContain('keep me');
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('edits only the selected row, cancelling drafts or saving without sending or removing', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const onsendnow = vi.fn();
      const onremove = vi.fn();
      renderQueue({
        props: {
          messages: [queued({}), queued({ id: 'q-2', content: 'second', position: 1 })],
          onedit,
          onsendnow,
          onremove,
        },
      });
      const row = within(screen.getAllByTestId('queued-message-row')[1]);
      await fireEvent.click(row.getByRole('button', { name: 'Edit', exact: true }));
      await waitFor(() => expect(onedit.mock.calls).toEqual([['q-2', 'second', true]]));
      const editor = row.getByRole('textbox') as HTMLTextAreaElement;
      await waitFor(() => expect(document.activeElement).toBe(editor));
      expect(editor.value).toBe('second');
      await fireEvent.input(editor, { target: { value: 'discard draft' } });
      await fireEvent.keyDown(editor, { key: 'Escape' });
      await waitFor(() => expect(row.queryByRole('textbox')).toBeNull());
      expect(onedit.mock.calls).toEqual([
        ['q-2', 'second', true],
        ['q-2', 'second', false],
      ]);

      await fireEvent.click(row.getByRole('button', { name: 'Edit', exact: true }));
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(3));
      expect((row.getByRole('textbox') as HTMLTextAreaElement).value).toBe('second');
      await fireEvent.input(row.getByRole('textbox'), { target: { value: 'saved draft' } });
      await fireEvent.keyDown(row.getByRole('textbox'), { key: 'Enter' });
      await waitFor(() => expect(row.queryByRole('textbox')).toBeNull());
      expect(onedit).toHaveBeenLastCalledWith('q-2', 'saved draft', false);
      expect(onsendnow).not.toHaveBeenCalled();
      expect(onremove).not.toHaveBeenCalled();
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(2);
    });

    it('does not expose editing or accept its keyboard shortcut while disabled', async () => {
      const onedit = vi.fn();
      renderQueue({ props: { messages: [queued({})], onedit, disabled: true } });
      expect(screen.queryByRole('button', { name: 'Edit', exact: true })).toBeNull();
      await fireEvent.keyDown(screen.getByTestId('queued-message-content'), { key: 'F2' });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(onedit).not.toHaveBeenCalled();
    });
  });

  describe('send immediately', () => {
    it.each(['single', 'all'] as const)(
      'announces an active %s send and returns to idle when delivery stays queued',
      async (scope) => {
        const pending = deferred<'queued'>();
        const send = vi.fn(() => pending.promise);
        renderQueue({
          props: {
            messages: [queued({})],
            ...(scope === 'single' ? { onsendnow: send } : { onsendall: send }),
          },
        });
        const header = screen.getByTestId('queued-messages-disclosure');
        const label = screen.getByTestId('queued-messages-label');
        const idleText = label.textContent;
        const idleName = header.getAttribute('aria-label');
        await fireEvent.click(
          screen.getByRole('button', {
            name: scope === 'single' ? 'Send immediately' : 'Send all ready messages now',
          }),
        );
        expect(label.textContent).not.toBe(idleText);
        expect(header.getAttribute('aria-label')).not.toBe(idleName);
        await fireEvent.click(header);
        expect(header.getAttribute('aria-expanded')).toBe('false');
        pending.resolve('queued');
        await waitFor(() => expect(label.textContent).toBe(idleText));
        expect(header.getAttribute('aria-label')).toBe(idleName);
      },
    );

    it('targets only the chosen ID and prevents duplicate/edit/remove actions until acknowledgement', async () => {
      const pending = deferred<'delivered'>();
      const onsendnow = vi.fn(() => pending.promise);
      const onremove = vi.fn();
      const onedit = vi.fn();
      const message = queued({
        imageBlocks: [{ type: 'image', data: 'synthetic', mimeType: 'image/png' }],
        fileBlocks: [
          {
            type: 'file',
            attachmentId: 'fixture-file',
            fileName: 'fixture.txt',
            mimeType: 'text/plain',
          },
        ],
      });
      const view = renderQueue({
        props: {
          messages: [message, queued({ id: 'q-2', content: 'second', position: 1 })],
          onsendnow,
          onremove,
          onedit,
        },
      });
      const row = within(screen.getAllByTestId('queued-message-row')[0]);
      await fireEvent.click(row.getByRole('button', { name: 'Send immediately' }));
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), {
        key: 'Enter',
        ctrlKey: true,
      });
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), { key: 'Delete' });
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), { key: 'F2' });
      const edit = row.getByRole('button', { name: 'Edit', exact: true });
      expect(edit.hasAttribute('disabled')).toBe(true);
      await fireEvent.click(edit);
      expect(onsendnow.mock.calls).toEqual([['q-1']]);
      expect(onremove).not.toHaveBeenCalled();
      expect(onedit).not.toHaveBeenCalled();
      expect(screen.getAllByTestId('queued-message-row')[0].getAttribute('aria-busy')).toBe('true');
      expect(row.getByTestId('queued-image-thumbnail')).toBeTruthy();
      expect(row.getByTestId('queued-file-chip')).toBeTruthy();

      await view.rerender({ messages: [queued({ id: 'q-2', content: 'second' }), message] });
      pending.resolve('delivered');
      await waitFor(() =>
        expect(row.getByRole('button', { name: 'Send immediately' }).hasAttribute('disabled')).toBe(
          true,
        ),
      );
      await fireEvent.keyDown(row.getByTestId('queued-message-content'), {
        key: 'Enter',
        metaKey: true,
      });
      expect(onsendnow).toHaveBeenCalledTimes(1);
      await view.rerender({ messages: [queued({ id: 'q-2', content: 'second' })] });
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
      expect(screen.getByText('second')).toBeTruthy();
    });

    it.each(['queued', 'quarantined'] as const)(
      'keeps %s outcomes actionable without removing attachments',
      async (outcome) => {
        const onsendnow = vi.fn().mockResolvedValue(outcome);
        renderQueue({ props: { messages: [queued({})], onsendnow } });
        const send = screen.getByRole('button', { name: 'Send immediately' });
        await fireEvent.click(send);
        await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
        expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
        expect(send.hasAttribute('disabled')).toBe(false);
        await fireEvent.click(send);
        expect(onsendnow).toHaveBeenCalledTimes(2);
      },
    );

    it('shows failure and retries the same ID without invoking remove', async () => {
      const onsendnow = vi
        .fn()
        .mockRejectedValueOnce(new Error('fixture failure'))
        .mockResolvedValue('delivered');
      const onremove = vi.fn();
      renderQueue({ props: { messages: [queued({})], onsendnow, onremove } });
      await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('fixture failure'),
      );
      await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(onsendnow.mock.calls).toEqual([['q-1'], ['q-1']]);
      expect(onremove).not.toHaveBeenCalled();
    });

    it('does not send disabled or edit-held messages through the shortcut', async () => {
      const onsendnow = vi.fn();
      const view = renderQueue({
        props: { messages: [queued({})], onsendnow, disabled: true },
      });
      await fireEvent.keyDown(screen.getByTestId('queued-message-content'), {
        key: 'Enter',
        ctrlKey: true,
      });
      await view.rerender({ messages: [queued({ editing: true })], disabled: false });
      await fireEvent.keyDown(screen.getByTestId('queued-message-content'), {
        key: 'Enter',
        metaKey: true,
      });
      expect(onsendnow).not.toHaveBeenCalled();
    });

    it('ignores an acknowledgement after the selected message disappeared', async () => {
      const pending = deferred<'queued'>();
      const onsendnow = vi.fn(() => pending.promise);
      const view = renderQueue({ props: { messages: [queued({})], onsendnow } });
      await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
      await view.rerender({ messages: [queued({ id: 'q-2', content: 'next' })] });
      pending.resolve('queued');
      await tick();
      expect(screen.queryByRole('status')).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Send immediately' }).hasAttribute('disabled'),
      ).toBe(false);
      expect(onsendnow.mock.calls).toEqual([['q-1']]);
    });
  });

  describe('queue disclosure', () => {
    it('starts expanded and exposes the controlled queue content', () => {
      renderQueue({ props: { messages: [queued({})] } });

      const disclosure = screen.getByTestId('queued-messages-disclosure');
      const content = screen.getByTestId('queued-messages-content');
      const container = screen.getByTestId('queued-messages-container');
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(disclosure.getAttribute('aria-controls')).toBe(content.id);
      expect(disclosure.getAttribute('aria-label')).toMatch(/^1\b/);
      expect(container.className).not.toContain('before:');
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(1);
    });

    it('keeps focus and updates the live count while collapsed', async () => {
      const view = renderQueue({ props: { messages: [queued({})] } });
      const disclosure = screen.getByTestId('queued-messages-disclosure');
      disclosure.focus();

      await fireEvent.click(disclosure);
      await tick();
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('queued-messages-content')).toBeNull();
      expect(screen.queryByTestId('queued-message-row')).toBeNull();
      expect(document.activeElement).toBe(disclosure);

      await view.rerender({
        messages: [queued({}), queued({ id: 'q-2', content: 'second', position: 1 })],
      });
      expect(disclosure.getAttribute('aria-label')).toMatch(/^2\b/);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('queued-message-row')).toBeNull();

      await fireEvent.click(disclosure);
      await tick();
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getAllByTestId('queued-message-row')).toHaveLength(2);
      expect(document.activeElement).toBe(disclosure);
    });
  });

  it('editLastMessage() starts editing the last queued message', async () => {
    const { component, container } = renderQueue({
      props: {
        messages: [
          queued({ id: 'q-1', content: 'first message', position: 0 }),
          queued({ id: 'q-2', content: 'second message', position: 1 }),
        ],
      },
    });

    expect(component.editLastMessage()).toBe(true);
    await tick();

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.value).toBe('second message');
  });

  it('editLastMessage() returns false when the queue is empty', async () => {
    const { component, container } = renderQueue({
      props: { messages: [] },
    });

    expect(component.editLastMessage()).toBe(false);
    await tick();

    expect(container.querySelector('textarea')).toBeNull();
  });

  describe('editing lifecycle', () => {
    async function beginEdit(
      props: Parameters<typeof render<typeof QueuedMessageList>>[1]['props'],
    ) {
      const view = renderQueue({ props });
      const row = view.container.querySelector<HTMLElement>('[data-testid="queued-message-row"]')!;
      await fireEvent.dblClick(
        view.container.querySelector<HTMLElement>('[data-testid="queued-message-content"]')!,
      );
      const textarea = await waitFor(() => view.container.querySelector('textarea'));
      return { ...view, row, textarea: textarea as HTMLTextAreaElement };
    }

    it('saves with Enter once and keeps Shift+Enter for a newline', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { textarea } = await beginEdit({ messages: [queued({})], onedit });
      await fireEvent.input(textarea, { target: { value: 'hello\nagain' } });
      await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(onedit).toHaveBeenCalledTimes(1);
      await fireEvent.keyDown(textarea, { key: 'Enter' });
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
      expect(onedit).toHaveBeenLastCalledWith('q-1', 'hello\nagain', false);
      expect(screen.queryByTestId('queued-message-edit-mode')).toBeNull();
    });

    it('cancels with Escape and releases the daemon hold with original content', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { textarea } = await beginEdit({
        messages: [queued({ content: 'original' })],
        onedit,
      });
      await fireEvent.input(textarea, { target: { value: 'changed' } });
      await fireEvent.keyDown(textarea, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('queued-message-edit-mode')).toBeNull());
      expect(onedit).toHaveBeenLastCalledWith('q-1', 'original', false);
    });

    it('saves on blur without a second save from the save action', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { textarea, container } = await beginEdit({ messages: [queued({})], onedit });
      await fireEvent.input(textarea, { target: { value: 'blurred' } });
      await fireEvent.blur(textarea);
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
      const save = Array.from(container.querySelectorAll('button')).find(
        (button) => button.getAttribute('tooltip') === 'Save',
      );
      if (save) await fireEvent.click(save);
      expect(onedit).toHaveBeenCalledTimes(2);
    });

    it('stays in edit mode when hold, save, or cancel release fails', async () => {
      const holdFailure = vi.fn().mockResolvedValue({ success: false, error: 'gone' });
      const first = await beginEdit({ messages: [queued({})], onedit: holdFailure });
      await waitFor(() => expect(first.container.querySelector('textarea')).toBeNull());
      first.unmount();

      const saveFailure = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValue({ success: false, error: 'offline' });
      const second = await beginEdit({
        messages: [queued({ id: 'q-2' })],
        onedit: saveFailure,
      });
      await fireEvent.keyDown(second.textarea, { key: 'Enter' });
      await waitFor(() => expect(second.container.querySelector('textarea')).toBe(second.textarea));
      const cancel = Array.from(second.container.querySelectorAll('button')).find(
        (button) => button.getAttribute('tooltip') === 'Cancel',
      )!;
      await fireEvent.pointerDown(cancel);
      await fireEvent.click(cancel);
      await waitFor(() => expect(saveFailure).toHaveBeenCalledTimes(3));
      expect(second.container.querySelector('textarea')).toBe(second.textarea);
    });

    it('keeps a new edit focused when a removed row pending cancel settles', async () => {
      const cancel = deferred<{ success: boolean }>();
      const onedit = vi.fn((id: string, _content: string, editing: boolean) => {
        if (id === 'q-1' && !editing) return cancel.promise;
        return Promise.resolve({ success: true });
      });
      const messages = [
        queued({ id: 'q-1', content: 'first', position: 0 }),
        queued({ id: 'q-2', content: 'second', position: 1 }),
      ];
      const view = renderQueue({ props: { messages, onedit } });

      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-1"] button')!);
      const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
      await fireEvent.keyDown(firstTextarea!, { key: 'Escape' });
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', false));

      await view.rerender({ messages: [messages[1]] });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-2"] button')!);
      const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
      expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
      await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

      cancel.resolve({ success: true });
      await tick();
      await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
      expect(document.activeElement).toBe(secondTextarea);
    });

    it.each(['start', 'save'] as const)(
      'ignores a removed row pending %s result after another row starts editing',
      async (pendingAction) => {
        const pending = deferred<{ success: boolean; error?: string }>();
        const onedit = vi.fn((id: string, _content: string, editing: boolean) => {
          const isPendingStart = pendingAction === 'start' && id === 'q-1' && editing;
          const isPendingSave = pendingAction === 'save' && id === 'q-1' && !editing;
          if (isPendingStart || isPendingSave) return pending.promise;
          return Promise.resolve({ success: true });
        });
        const messages = [
          queued({ id: 'q-1', content: 'first', position: 0 }),
          queued({ id: 'q-2', content: 'second', position: 1 }),
        ];
        const view = renderQueue({ props: { messages, onedit } });

        await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-1"] button')!);
        const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
        if (pendingAction === 'save') {
          await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
          await fireEvent.input(firstTextarea!, { target: { value: 'changed' } });
          await fireEvent.keyDown(firstTextarea!, { key: 'Enter' });
          await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'changed', false));
        } else {
          await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'first', true));
        }

        await view.rerender({ messages: [messages[1]] });
        await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
        await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-2"] button')!);
        const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
        expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
        await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

        pending.resolve(
          pendingAction === 'start' ? { success: false, error: 'removed' } : { success: true },
        );
        await tick();
        await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
        expect(document.activeElement).toBe(secondTextarea);
      },
    );

    it('auto-resizes multiline content', async () => {
      const { textarea } = await beginEdit({ messages: [queued({})] });
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 84 });
      await fireEvent.input(textarea, { target: { value: 'one\ntwo\nthree' } });
      expect(textarea.style.height).toBe('84px');
    });

    it('keeps row, textarea, focus, and selection through refresh and reorder', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const messages = [
        queued({ id: 'q-1', content: 'first', position: 0 }),
        queued({ id: 'q-2', content: 'second', position: 1 }),
      ];
      const view = renderQueue({ props: { messages, onedit } });
      const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-message-id]'));
      await fireEvent.dblClick(rows[0].querySelector('[data-testid="queued-message-content"]')!);
      const textarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(1));
      textarea!.setSelectionRange(2, 4);

      const rowList = rows[0].parentElement!;
      let didBlurDuringMove = false;
      const blurDuringMove = new MutationObserver(() => {
        didBlurDuringMove = true;
        textarea!.blur();
      });
      blurDuringMove.observe(rowList, { childList: true });
      await view.rerender({ messages: [messages[1], { ...messages[0], editing: true }] });
      blurDuringMove.disconnect();
      await tick();
      expect(didBlurDuringMove).toBe(true);
      expect(view.container.querySelector('[data-message-id="q-1"]')).toBe(rows[0]);
      expect(view.container.querySelector('textarea')).toBe(textarea);
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      expect([textarea!.selectionStart, textarea!.selectionEnd]).toEqual([2, 4]);
      expect(onedit).toHaveBeenCalledTimes(1);

      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      await waitFor(() => expect(onedit).toHaveBeenCalledTimes(2));
      expect(onedit).toHaveBeenLastCalledWith('q-1', 'first', false);
      outside.remove();
    });

    it('handles rapid reorder and removal before a stale save settles', async () => {
      const save = deferred<{ success: boolean }>();
      const onedit = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockImplementationOnce(() => save.promise)
        .mockResolvedValue({ success: true });
      const messages = [
        queued({ id: 'q-1', content: 'first', position: 0 }),
        queued({ id: 'q-2', content: 'second', position: 1 }),
      ];
      const view = renderQueue({ props: { messages, onedit } });
      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-1"] button')!);
      const firstTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await fireEvent.input(firstTextarea!, { target: { value: 'changed' } });
      await fireEvent.keyDown(firstTextarea!, { key: 'Enter' });
      await waitFor(() => expect(onedit).toHaveBeenCalledWith('q-1', 'changed', false));

      await view.rerender({ messages: [messages[1], messages[0]] });
      await view.rerender({ messages: [messages[1]] });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      await fireEvent.dblClick(view.container.querySelector('[data-message-id="q-2"] button')!);
      const secondTextarea = await waitFor(() => view.container.querySelector('textarea'));
      await waitFor(() => expect(document.activeElement).toBe(secondTextarea));

      save.resolve({ success: true });
      await tick();
      await waitFor(() => expect(view.container.querySelector('textarea')).toBe(secondTextarea));
      expect((secondTextarea as HTMLTextAreaElement).value).toBe('second');
    });

    it('removes an editing row without residual shell state', async () => {
      const view = renderQueue({ props: { messages: [queued({})] } });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeTruthy());
      await view.rerender({ messages: [] });
      await waitFor(() => expect(view.container.querySelector('[data-message-id]')).toBeNull());
      expect(view.container.querySelector('[style*="height"]')).toBeNull();
    });

    it('rapidly reverses on Escape without remounting the row or overlapping modes', async () => {
      const view = renderQueue({ props: { messages: [queued({})] } });
      const row = screen.getByTestId('queued-message-row');
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      const textarea = await waitFor(() => view.container.querySelector('textarea'));
      await fireEvent.keyDown(textarea!, { key: 'Escape' });
      await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
      expect(screen.getByTestId('queued-message-row')).toBe(row);
      expect(row.querySelectorAll('[data-mode="display"]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-testid="queued-message-edit-mode"]')).toHaveLength(0);
    });

    it('completes mode changes immediately for reduced motion', async () => {
      const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });
      const { row } = await beginEdit({ messages: [queued({})] });
      expect(row.style.height).toBe('');
      expect(row.style.overflow).toBe('');
      matchMedia.mockRestore();
    });
  });

  it('lets the canonical follow authority pin bottom and preserve an unlocked viewport', async () => {
    const view = render(QueuedMessageEditMotionHost);
    const transcript = screen.getByTestId('queued-edit-transcript');
    let expandedHeight = 900;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, get: () => expandedHeight },
    });
    transcript.scrollTop = 700;
    expandedHeight = 980;
    await fireEvent.dblClick(
      view.container.querySelector('[data-testid="queued-message-content"]')!,
    );
    await waitFor(() => expect(transcript.scrollTop).toBe(780));

    await fireEvent.wheel(transcript, { deltaY: -20 });
    transcript.scrollTop = 240;
    expandedHeight = 1060;
    await fireEvent.click(screen.getByTestId('queued-edit-refresh'));
    await tick();
    expect(transcript.scrollTop).toBe(240);
    vi.unstubAllGlobals();
  });

  it('shows retry status separately from message content until sending starts', async () => {
    const pending = deferred<'delivered'>();
    renderQueue({
      props: {
        messages: [queued({ content: 'try again', requeuedAfterFailure: true })],
        onsendnow: () => pending.promise,
      },
    });

    expect(screen.getByTestId('queued-message-text').textContent?.trim()).toBe('try again');
    expect(screen.getByTestId('queued-message-retry-status').getAttribute('role')).toBe('status');
    await fireEvent.click(screen.getByRole('button', { name: 'Send immediately' }));
    expect(screen.queryByTestId('queued-message-retry-status')).toBeNull();
    pending.resolve('delivered');
  });

  it('renders portable queue authors without a roster cache and keeps unknown, null and absent distinct', () => {
    const author = {
      principalId: null,
      login: 'same',
      displayName: 'Same Person',
      avatarUrl: null,
      identity: { provider: 'gitlab' as const, host: 'one.example', externalUserId: '42' },
    };
    const messages = [
      queued({
        id: 'p1',
        content: 'first',
        author,
        messageMetadata: { humanAuthor: { sourcePrincipalId: 'self' } },
      }),
      queued({
        id: 'p2',
        content: 'second',
        author: { ...author, identity: { ...author.identity, host: 'two.example' } },
      }),
      queued({
        id: 'unknown',
        content: 'unknown',
        author: { principalId: null, login: null, displayName: null, avatarUrl: null },
      }),
      queued({ id: 'null', content: 'no author', author: null }),
      queued({ id: 'absent', content: 'old host' }),
      queued({
        id: 'automatic',
        content: 'automatic',
        author,
        messageMetadata: { type: 'hook_wake' },
      }),
    ];
    const before = JSON.stringify(messages);
    renderQueue({ props: { messages, authors: null, ownPrincipalId: 'self' } });
    const chips = screen.getAllByTestId('queued-message-author');
    expect(chips).toHaveLength(3);
    expect(chips[0].getAttribute('aria-label')).toContain('Same Person · @same');
    expect(chips[1].getAttribute('aria-label')).toContain('Same Person · @same');
    expect(chips[2].textContent?.trim()).not.toBe('');
    expect(chips.every((chip) => !chip.hasAttribute('data-principal-id'))).toBe(true);
    expect(JSON.stringify(messages)).toBe(before);
  });

  describe('human author identity (multiplayer)', () => {
    // Queue entries carry the daemon's `messageMetadata.fromPrincipalId`
    // stamp (PROTOCOL §5.5, intent-hq/intentd#1869); the author projection is
    // resolved by the panel from the transcript and handed in as `authors`
    // only once the workspace has more than one member.
    const guest = {
      principalId: 'principal-guest',
      login: 'guest',
      displayName: 'Guest User',
      avatarUrl: 'https://avatars.example/guest.png',
    };
    const owner = {
      principalId: 'principal-owner',
      login: 'owner',
      displayName: null,
      avatarUrl: null,
    };
    const authors = new Map([
      [guest.principalId, guest],
      [owner.principalId, owner],
    ]);

    it('renders each stamped entry with its own author once authors are provided', () => {
      renderQueue({
        props: {
          messages: [
            queued({
              id: 'q-guest',
              content: 'queued by guest',
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
            queued({
              id: 'q-owner',
              content: 'queued by owner',
              position: 1,
              messageMetadata: { fromPrincipalId: owner.principalId },
            }),
          ],
          authors,
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers.map((h) => h.getAttribute('data-principal-id'))).toEqual([
        guest.principalId,
        owner.principalId,
      ]);
      expect(headers[0].getAttribute('aria-label')).toContain('Guest User');
      expect(headers[1].getAttribute('aria-label')).toContain('owner');
      const avatar = screen.getByTestId('queued-message-author-avatar') as HTMLImageElement;
      expect(avatar.getAttribute('src')).toBe(guest.avatarUrl);
      expect(screen.getByTestId('queued-message-author-avatar-fallback').textContent).toBe('O');
      expect(screen.getByText('queued by guest')).toBeTruthy();
      expect(screen.getByText('queued by owner')).toBeTruthy();
    });

    it('omits the author when no authors are provided (single-member workspace)', () => {
      renderQueue({
        props: {
          messages: [
            queued({ content: 'solo', messageMetadata: { fromPrincipalId: guest.principalId } }),
          ],
        },
      });

      expect(screen.queryByTestId('queued-message-author')).toBeNull();
      expect(screen.getByText('solo')).toBeTruthy();
    });

    it("omits the author on the viewer's own entries, keeping it on other members'", () => {
      renderQueue({
        props: {
          messages: [
            queued({
              id: 'q-guest',
              content: 'queued by guest',
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
            queued({
              id: 'q-owner',
              content: 'queued by owner',
              position: 1,
              messageMetadata: { fromPrincipalId: owner.principalId },
            }),
          ],
          authors,
          ownPrincipalId: owner.principalId,
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers.map((h) => h.getAttribute('data-principal-id'))).toEqual([guest.principalId]);
      expect(screen.getByText('queued by guest')).toBeTruthy();
      expect(screen.getByText('queued by owner')).toBeTruthy();
    });

    it('omits the author on unstamped or unresolvable entries', () => {
      renderQueue({
        props: {
          messages: [
            queued({ id: 'q-legacy', content: 'older daemon entry' }),
            queued({
              id: 'q-new',
              content: 'member without a transcript row yet',
              position: 1,
              messageMetadata: { fromPrincipalId: 'principal-unseen' },
            }),
          ],
          authors,
        },
      });

      expect(screen.queryByTestId('queued-message-author')).toBeNull();
      expect(screen.getByText('older daemon entry')).toBeTruthy();
      expect(screen.getByText('member without a transcript row yet')).toBeTruthy();
    });

    it("renders the entry's own author projection with no transcript history", () => {
      // A member whose first message is queued before any of their transcript
      // rows exist: the daemon serves the projection on the queue entry
      // (intent-hq/intentd#1869), so the empty transcript map is not needed.
      renderQueue({
        props: {
          messages: [
            queued({
              id: 'q-first',
              content: 'first ever message, still queued',
              messageMetadata: { fromPrincipalId: guest.principalId },
              author: guest,
            }),
            // Stale transcript copy vs. fresher projection: the projection wins.
            queued({
              id: 'q-renamed',
              content: 'renamed since the transcript row',
              position: 1,
              messageMetadata: { fromPrincipalId: owner.principalId },
              author: { ...owner, displayName: 'Owner Renamed' },
            }),
          ],
          authors: new Map(),
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers.map((h) => h.getAttribute('data-principal-id'))).toEqual([
        guest.principalId,
        owner.principalId,
      ]);
      expect(headers[0].getAttribute('aria-label')).toContain('Guest User');
      expect(headers[1].getAttribute('aria-label')).toContain('Owner Renamed');
      expect(screen.getByText('first ever message, still queued')).toBeTruthy();
    });

    it('omits the author on an explicit null projection even when the transcript resolves it', () => {
      // `author: null` is the daemon's authoritative "principal row is gone";
      // the stamp-based transcript fallback applies only when the field is absent.
      renderQueue({
        props: {
          messages: [
            queued({
              id: 'q-gone',
              content: 'author row deleted',
              messageMetadata: { fromPrincipalId: guest.principalId },
              author: null,
            }),
            queued({
              id: 'q-legacy',
              content: 'older daemon, stamp only',
              position: 1,
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
          ],
          authors,
        },
      });

      const headers = screen.getAllByTestId('queued-message-author');
      expect(headers).toHaveLength(1);
      expect(headers[0].closest('[data-message-id]')?.getAttribute('data-message-id')).toBe(
        'q-legacy',
      );
      expect(screen.getByText('author row deleted')).toBeTruthy();
      expect(screen.getByText('older daemon, stamp only')).toBeTruthy();
    });

    it('omits the author on daemon-origin entries even when a projection is attached', () => {
      // Legacy projections do not upgrade unstamped automatic metadata to human.
      // Current automatic ingress strips caller-supplied human stamps.
      renderQueue({
        props: {
          messages: [
            queued({
              id: 'q-agent',
              content: 'agent-to-agent',
              messageMetadata: {
                type: 'agent_message',
                fromAgentId: 'agent-2',
              },
              author: owner,
            }),
            queued({
              id: 'q-system',
              content: 'system wake',
              position: 1,
              messageMetadata: { source: 'system' },
              author: owner,
            }),
          ],
          authors,
        },
      });

      expect(screen.queryByTestId('queued-message-author')).toBeNull();
      expect(screen.getByText('agent-to-agent')).toBeTruthy();
      expect(screen.getByText('system wake')).toBeTruthy();
    });

    it('keeps a foreign author visible when a double click cannot edit the entry', async () => {
      renderQueue({
        props: {
          messages: [
            queued({
              content: 'edit me',
              messageMetadata: { fromPrincipalId: guest.principalId },
            }),
          ],
          authors,
        },
      });

      expect(screen.getByTestId('queued-message-author')).toBeTruthy();
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      await tick();
      expect(screen.queryByTestId('queued-message-edit-mode')).toBeNull();
      expect(screen.getByTestId('queued-message-author')).toBeTruthy();
    });
  });

  describe('image thumbnails', () => {
    const IMAGE_BLOCKS: NonNullable<QueuedMessage['imageBlocks']> = [
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ];

    function thumbnails(container: HTMLElement): HTMLButtonElement[] {
      return Array.from(
        container.querySelectorAll<HTMLButtonElement>('[data-testid="queued-image-thumbnail"]'),
      );
    }

    it('renders one thumbnail per image block with the data-URL src', () => {
      const { container } = renderQueue({
        props: { messages: [queued({ content: 'look at these', imageBlocks: IMAGE_BLOCKS })] },
      });

      const buttons = thumbnails(container);
      expect(buttons).toHaveLength(2);
      const imgs = buttons.map((b) => b.querySelector('img'));
      expect(imgs[0]?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      expect(imgs[1]?.getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
      expect(buttons[0].getAttribute('aria-label')).toBe('View attached image 1 of 2 full size');
      expect(screen.getByText('look at these')).toBeTruthy();
    });

    it('renders no thumbnails when imageBlocks is absent or empty', () => {
      const { container } = renderQueue({
        props: {
          messages: [
            queued({ id: 'q-1', content: 'no images', position: 0 }),
            queued({ id: 'q-2', content: 'empty images', position: 1, imageBlocks: [] }),
          ],
        },
      });

      expect(thumbnails(container)).toHaveLength(0);
      expect(container.querySelector('[data-testid="queued-image-thumbnail"] img')).toBeNull();
    });

    it('clicking a thumbnail opens the lightbox and does not start edit mode', async () => {
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const { container } = renderQueue({
        props: { messages: [queued({ content: 'with image', imageBlocks: IMAGE_BLOCKS })], onedit },
      });

      await fireEvent.click(thumbnails(container)[1]);
      await tick();

      // Lightbox opened (portaled to body) with the clicked image
      const dialog = document.body.querySelector('[role="dialog"][aria-label="Image preview"]');
      expect(dialog).toBeTruthy();
      const lightboxImg = dialog?.querySelector('img');
      expect(lightboxImg?.getAttribute('src')).toBe('data:image/jpeg;base64,BBBB');
      expect(lightboxImg?.getAttribute('alt')).toBe('Attached image 2');

      // Edit mode not triggered
      expect(container.querySelector('textarea')).toBeNull();
      expect(onedit).not.toHaveBeenCalled();
    });

    it('offers no remove or edit affordance for images', () => {
      const { container } = renderQueue({
        props: { messages: [queued({ content: 'with image', imageBlocks: IMAGE_BLOCKS })] },
      });

      // Only the row-level remove button exists; images stay view-only.
      const tooltips = buttonTooltips(container);
      expect(tooltips.filter((t) => t === 'Remove')).toHaveLength(1);
      // Every thumbnail button is a view-only affordance
      for (const button of thumbnails(container)) {
        expect(button.getAttribute('aria-label')).toMatch(
          /^View attached image \d+ of \d+ full size$/,
        );
      }
    });
  });

  describe('attachment-reference thumbnails', () => {
    const originalInvoke = window.electronAPI!.invoke;
    const routeContext = new Map([
      [WORKSPACE_ROUTE_CONTEXT, { workspaceId: WorkspaceId('ws-queued') }],
    ]);

    // PROTOCOL §5.9 `file.getAttachmentInfo` result for the referenced row.
    const attachmentInfo = {
      attachmentId: 'att-q-1',
      fileName: 'shot.png',
      mimeType: 'image/png',
      size: 1234,
      uploadedAt: '2026-01-01T12:00:00Z',
      path: '.intent/attachments/att-q-1/shot.png',
      exists: true,
    };

    beforeEach(() => {
      resetMockIpcRouter();
      window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
        mockInvoke(channel, payload),
      );
    });
    afterEach(() => {
      window.electronAPI!.invoke = originalInvoke;
      resetMockIpcRouter();
      vi.restoreAllMocks();
    });

    it('falls back to the placeholder tile and evicts the cached URL when the thumbnail fails to load', async () => {
      const getAttachmentInfo = vi.fn(() => ({ ok: true, result: attachmentInfo }));
      registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
        expect(payload).toEqual({
          method: 'file.getAttachmentInfo',
          params: { attachmentId: 'att-q-1', workspaceId: 'ws-queued' },
        });
        return getAttachmentInfo();
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      renderQueue({
        props: {
          messages: [
            queued({
              content: 'see attached',
              imageBlocks: [{ type: 'image', attachmentId: 'att-q-1', mimeType: 'image/png' }],
            }),
          ],
        },
        context: routeContext,
      });

      // The reference resolves to a workspace-file:// URL and renders as <img>.
      const img = await screen.findByRole('img', { name: /attached image/i });
      const url = 'workspace-file://ws-queued/.intent/attachments/att-q-1/shot.png';
      expect(img.getAttribute('src')).toBe(url);
      expect(getAttachmentInfo).toHaveBeenCalledTimes(1);

      // The protocol handler refused the bytes (e.g. 404): the <img> errors.
      await fireEvent.error(img);

      await waitFor(() => expect(screen.getByTestId('queued-image-placeholder')).toBeTruthy());
      expect(screen.queryByRole('img', { name: /attached image/i })).toBeNull();
      const thumbnailWarnings = warn.mock.calls.filter(([message]) =>
        String(message).includes('Attachment thumbnail failed to load'),
      );
      expect(thumbnailWarnings).toHaveLength(1);
      expect(thumbnailWarnings[0][1]).toEqual({ attachmentId: 'att-q-1', url });
      // Evicted: the next resolve re-issues file.getAttachmentInfo instead of
      // replaying the URL that just failed — and this instance does not loop.
      await expect(resolveAttachmentImageUrl('ws-queued', 'att-q-1')).resolves.toBe(url);
      expect(getAttachmentInfo).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('queued-image-placeholder')).toBeTruthy();
      expect(screen.queryByRole('img', { name: /attached image/i })).toBeNull();
    });
  });
});
