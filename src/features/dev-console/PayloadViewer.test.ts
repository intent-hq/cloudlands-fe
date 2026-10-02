import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PayloadViewer from './PayloadViewer.svelte';
import PayloadDetails from './PayloadDetails.svelte';
import type { DevConsoleRecord } from '$shared/types/dev-console';
const richViewSupported = vi.hoisted(() => vi.fn(() => true));
vi.mock('./traffic-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./traffic-view')>()),
  payloadSupportsRichView: richViewSupported,
}));
import {
  configureMonacoWorkers,
  initializePayloadMonaco,
  editors,
  models,
  monaco,
  resetMonaco,
} from './__tests__/monaco-mock';

vi.mock('./payload-monaco', () => ({ initializePayloadMonaco: () => initializePayloadMonaco() }));

beforeEach(() => {
  resetMonaco();
  richViewSupported.mockReset().mockReturnValue(true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('creates a read-only JSON model and sends search/fold actions to the owning pane', async () => {
  const first = render(PayloadViewer, {
    text: '{"nested":{"items":[true,null]}}',
    label: 'Request',
  });
  const second = render(PayloadViewer, { text: '{"result":42}', label: 'Response' });
  await waitFor(() => expect(editors).toHaveLength(2));
  expect(models[0].getValue()).toBe(
    '{\n  "nested": {\n    "items": [\n      true,\n      null\n    ]\n  }\n}',
  );
  expect(models[0].getLanguageId()).toBe('json');
  expect(monaco.editor.create).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({
      readOnly: true,
      domReadOnly: true,
      ariaLabel: 'Request',
      folding: true,
      showFoldingControls: 'always',
    }),
  );
  await fireEvent.click(first.container.querySelector('button')!);
  expect(editors[0].getAction('actions.find').run).toHaveBeenCalledOnce();
  for (const [name, action] of [
    ['Search', 'actions.find'],
    ['Collapse all', 'editor.foldAll'],
    ['Expand all', 'editor.unfoldAll'],
  ]) {
    const button = Array.from(second.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === name,
    )!;
    await fireEvent.click(button);
    expect(editors[1].getAction(action).run).toHaveBeenCalledOnce();
  }
  expect(editors[0].getAction('editor.foldAll').run).not.toHaveBeenCalled();
});

it.each([true, false])(
  'preserves original-text copying and capture labels with rich view %s',
  async (rich) => {
    richViewSupported.mockReturnValue(rich);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const record: DevConsoleRecord = {
      id: 'a',
      method: 'test.call',
      rpcMethod: 'test.call',
      timestamp: 0,
      direction: 'outbound',
      kind: 'request',
      backendId: 'one',
      connectionId: 'main',
      connectionGeneration: 1,
      status: 'success',
      payload: { state: 'complete', text: '{"x":1}', originalBytes: 7, retainedBytes: 7 },
      response: { state: 'truncated', text: '{"partial":', originalBytes: 100, retainedBytes: 11 },
    };
    const view = render(PayloadDetails, {
      row: record,
      record,
      full: false,
      ontoggle: vi.fn(),
      onclose: vi.fn(),
    });
    await waitFor(() => expect(editors).toHaveLength(2));
    expect(models[0].getValue()).toBe('{\n  "x": 1\n}');
    expect(models[1].getValue()).toBe(record.response!.text);
    const copy = view.getAllByRole('button', { name: 'Copy payload', exact: true });
    await fireEvent.click(copy[0]);
    expect(writeText).toHaveBeenLastCalledWith('{"x":1}');
    await fireEvent.click(copy[1]);
    expect(writeText).toHaveBeenLastCalledWith('{"partial":');
    expect(view.container.textContent).toContain('Truncated');
    expect(view.container.textContent).toContain('11');
    expect(view.container.textContent).toContain('100');
    vi.unstubAllGlobals();
  },
);

it.each(['absent', 'unserializable'] as const)(
  'renders %s payloads without inventing content',
  async (state) => {
    const record: DevConsoleRecord = {
      id: 'a',
      method: 'test.event',
      rpcMethod: 'test.event',
      timestamp: 0,
      direction: 'inbound',
      kind: 'notification',
      backendId: 'one',
      connectionId: 'main',
      connectionGeneration: 1,
      status: 'received',
      payload: { state, text: '', originalBytes: null, retainedBytes: 0 },
    };
    const view = render(PayloadDetails, {
      row: record,
      record,
      full: false,
      ontoggle: vi.fn(),
      onclose: vi.fn(),
    });
    await waitFor(() => expect(models).toHaveLength(1));
    expect(models[0].getValue()).toBe('');
    expect(models[0].getLanguageId()).toBe('plaintext');
    expect(view.container.textContent).toContain(
      state === 'absent' ? 'Omitted' : 'Not serializable',
    );
    expect(
      (view.getByRole('button', { name: 'Copy payload', exact: true }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  },
);

it('updates the existing model when a reply changes, including switching to raw text', async () => {
  const view = render(PayloadViewer, { text: '{"pending":true}', label: 'Response' });
  await waitFor(() => expect(models).toHaveLength(1));
  await view.rerender({ text: '{"reply":{"value":1}}', label: 'Response' });
  expect(models).toHaveLength(1);
  expect(models[0].getValue()).toContain('"value": 1');
  await view.rerender({ text: '{"truncated":', label: 'Response' });
  expect(models[0].getValue()).toBe('{"truncated":');
  expect(models[0].getLanguageId()).toBe('plaintext');
  const updates = models[0].setValue.mock.calls.length;
  await view.rerender({ text: '{"truncated":', label: 'Event' });
  expect(models[0].setValue).toHaveBeenCalledTimes(updates);
  expect(editors[0].updateOptions).toHaveBeenLastCalledWith({ ariaLabel: 'Event', folding: true });
});

it('uses the latest payload if it changes during worker startup', async () => {
  let ready!: () => void;
  configureMonacoWorkers.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const view = render(PayloadViewer, { text: '"old"', label: 'Response' });
  await waitFor(() => expect(configureMonacoWorkers).toHaveBeenCalled());
  await view.rerender({ text: '{"latest":true}', label: 'Response' });
  ready();
  await waitFor(() => expect(models).toHaveLength(1));
  expect(models[0].getValue()).toBe('{\n  "latest": true\n}');
});

it('does not create an editor after being closed during worker startup', async () => {
  let ready!: () => void;
  configureMonacoWorkers.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const view = render(PayloadViewer, { text: '{}', label: 'Request' });
  await waitFor(() => expect(configureMonacoWorkers).toHaveBeenCalled());
  view.unmount();
  ready();
  await tick();
  expect(monaco.editor.createModel).not.toHaveBeenCalled();
  expect(monaco.editor.create).not.toHaveBeenCalled();
});

it('releases editor, model and theme observer when closed', async () => {
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const view = render(PayloadViewer, { text: '{}', label: 'Request' });
  await waitFor(() => expect(editors).toHaveLength(1));
  view.unmount();
  expect(editors[0].dispose).toHaveBeenCalledOnce();
  expect(models[0].dispose).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalled();
  disconnect.mockRestore();
});

it('keeps captured text readable if Monaco cannot load', async () => {
  configureMonacoWorkers.mockRejectedValueOnce(new Error('worker unavailable'));
  const view = render(PayloadViewer, { text: '{"partial":', label: 'Request' });
  await waitFor(() => expect(view.getByRole('status').textContent).toContain('Could not load'));
  expect(view.container.querySelector('pre')?.textContent).toBe('{"partial":');
  expect((view.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
});

it('releases a partially created model if editor creation fails', async () => {
  monaco.editor.create.mockImplementationOnce(() => {
    throw new Error('editor unavailable');
  });
  const view = render(PayloadViewer, { text: '{}', label: 'Request' });
  await waitFor(() => expect(view.getByRole('status')).toBeTruthy());
  expect(models[0].dispose).toHaveBeenCalledOnce();
  view.unmount();
  expect(models[0].dispose).toHaveBeenCalledOnce();
});

it('explains the large-payload limitation and disables folding while keeping search available', async () => {
  // Exercise presentation without inserting a 300,000-line text node into jsdom.
  richViewSupported.mockReturnValue(false);
  const view = render(PayloadViewer, { text: '{"large":true}', label: 'Response' });
  await waitFor(() => expect(editors).toHaveLength(1));
  expect(view.getByRole('status').textContent).toContain('Syntax highlighting and folding');
  expect((view.getByRole('button', { name: 'Collapse all' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((view.getByRole('button', { name: 'Expand all' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((view.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(false);
  expect(models[0].getValue()).toBe('{\n  "large": true\n}');
  expect(models[0].getLanguageId()).toBe('plaintext');
  await fireEvent.click(view.getByRole('button', { name: 'Search' }));
  expect(editors[0].getAction('actions.find').run).toHaveBeenCalledOnce();
});

it('replaces models when updates cross the rich-view boundary and restores ordinary JSON features', async () => {
  const view = render(PayloadViewer, { text: '{"small":1}', label: 'Response' });
  await waitFor(() => expect(editors).toHaveLength(1));
  richViewSupported.mockReturnValue(false);
  await view.rerender({ text: '{"large":true}', label: 'Response' });
  expect(models).toHaveLength(2);
  expect(models[0].dispose).toHaveBeenCalledOnce();
  expect(models[1].getLanguageId()).toBe('plaintext');
  expect(editors[0].updateOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ folding: false }),
  );
  richViewSupported.mockReturnValue(true);
  await view.rerender({ text: '{"small":2}', label: 'Response' });
  expect(models).toHaveLength(3);
  expect(models[1].dispose).toHaveBeenCalledOnce();
  expect(models[2].getLanguageId()).toBe('json');
  expect(view.queryByRole('status')).toBeNull();
  expect((view.getByRole('button', { name: 'Collapse all' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect(editors[0].updateOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ folding: true }),
  );
  view.unmount();
  expect(models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
});
