import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { artifactsSaga } from '$store/renderer/slices/artifacts/sagas/artifacts-saga';
import { writable } from 'svelte/store';
import type { ArtifactDocument } from '$shared/types/visual-artifact';
import ArtifactBlock from './ArtifactBlock.svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  target: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
  images: vi.fn(),
  clipboard: vi.fn(),
  note: null as any,
  Conflict: class extends Error {},
}));
vi.mock('./components/ArtifactEditor.svelte', async () => ({
  default: (await import('./__tests__/EditorMock.svelte')).default,
}));
vi.mock('$shared/paraglide/messages.js', () => ({
  m: new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch, state: {} } }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectMostRecentAgentTab: { select: mocks.target },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: () => mocks.note,
}));
vi.mock('$store/renderer/slices/artifacts/artifacts-selectors', async () => ({
  selectArtifactImages: Object.assign(() => awaitImportWritable(), {
    effect: function* () {
      return {};
    },
  }),
}));
function awaitImportWritable() {
  return writable({});
}
vi.mock('$lib/utils/clipboard', () => ({ writeTextToClipboard: mocks.clipboard }));
vi.mock('./image-context', () => ({ artifactImageContextItems: mocks.images }));
vi.mock('./service', () => ({
  loadArtifact: mocks.load,
  saveArtifact: mocks.save,
  createArtifact: mocks.create,
  ArtifactConflictError: mocks.Conflict,
  artifactSelectionToContextItem: (
    document: unknown,
    selection: unknown,
    source: unknown,
    comment: string,
  ) => ({
    id: 'captured',
    type: 'selection',
    label: 'Snapshot',
    metadata: {
      semanticId: 'artifact:a#items:card-a',
      artifactSelection: { document, selection, source, comment },
    },
    content: JSON.stringify({ document, selection, source, comment }),
  }),
}));

const document: ArtifactDocument = {
  version: 1,
  id: 'a',
  kind: 'board',
  title: 'Original title',
  items: [{ id: 'card-a', type: 'card', text: 'Card', x: 0, y: 0, width: 100, height: 80 }],
  connections: [],
  annotations: [],
};
const loaded = { document, revision: 1, rawBlock: 'original' };
const reference = { noteId: 'n', artifactId: 'a' };
const button = (key: string) =>
  screen.getByRole('button', { name: `artifacts_block_${key}_label` });

let sagaTask: Task;
afterEach(() => sagaTask?.cancel());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.note = writable(undefined);
  mocks.load.mockResolvedValue(loaded);
  mocks.save.mockResolvedValue({
    ...loaded,
    document: { ...document, title: 'Edited title' },
    revision: 2,
  });
  mocks.create.mockResolvedValue(reference);
  mocks.images.mockResolvedValue([]);
  mocks.target.mockReturnValue({ agentId: 'recent-agent' });
  const channel = stdChannel();
  mocks.dispatch.mockImplementation((action) => {
    channel.put(action);
    return action;
  });
  sagaTask = runSaga({ channel, dispatch: mocks.dispatch, getState: () => ({}) }, artifactsSaga);
});

describe('artifact editor persistence and composer attachment', () => {
  it('queues a local immutable snapshot plus pixels to the explicit agent without saving', async () => {
    mocks.images.mockResolvedValue([
      { id: 'pixels', type: 'file', label: 'Image', imageData: 'AA==', imageMimeType: 'image/png' },
    ]);
    render(ArtifactBlock, { block: { document }, workspaceId: 'w', agentId: 'explicit-agent' });
    await fireEvent.click(screen.getByText('Edit document'));
    await fireEvent.click(screen.getByText('Select card'));
    await fireEvent.click(button('add'));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'artifacts/selectionQueued' }),
      ),
    );
    const action = mocks.dispatch.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === 'artifacts/selectionQueued');
    expect(action.payload.slice(0, 2)).toEqual(['w', 'explicit-agent']);
    expect(action.payload[2]).toHaveLength(2);
    expect(action.payload[2][0].metadata).toMatchObject({
      semanticId: 'artifact:a#items:card-a',
      artifactSelection: {
        selection: { itemIds: ['card-a'] },
        source: { workspaceId: 'w', artifactId: 'a' },
      },
    });
    expect(JSON.parse(action.payload[2][0].content)).toMatchObject({
      document: { title: 'Edited title' },
      selection: { itemIds: ['card-a'] },
      source: { workspaceId: 'w', artifactId: 'a' },
    });
    expect(action.payload[2][1]).toMatchObject({ imageData: 'AA==', imageMimeType: 'image/png' });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('targets the most recent agent from a note and refuses an unscoped capture', async () => {
    mocks.target.mockReturnValue(undefined);
    render(ArtifactBlock, { block: { document }, workspaceId: 'w' });
    await fireEvent.click(button('add'));
    await screen.findByText('artifacts_block_noAgent_error');
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'artifacts/captureRequested'),
    ).toBe(false);
    mocks.target.mockReturnValue({ agentId: 'recent-agent' });
    await fireEvent.click(button('add'));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'artifacts/selectionQueued' }),
      ),
    );
    const action = mocks.dispatch.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === 'artifacts/selectionQueued');
    expect(action.payload.slice(0, 2)).toEqual(['w', 'recent-agent']);
  });

  it('reloads a changed reference and ignores the previous load completion', async () => {
    let finishOld!: (value: typeof loaded) => void;
    let finishNew!: (value: typeof loaded) => void;
    mocks.load
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      );
    const view = render(ArtifactBlock, { block: reference, workspaceId: 'w' });
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('w', 'n', 'a'));
    await view.rerender({ block: { noteId: 'other-note', artifactId: 'a' }, workspaceId: 'w' });
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('w', 'other-note', 'a'));
    finishOld(loaded);
    await mocks.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === 'artifacts/loadRequested').promise;
    expect(screen.queryByTestId('title')).toBeNull();
    finishNew({ ...loaded, document: { ...document, title: 'New reference' }, revision: 7 });
    await screen.findByRole('heading', { name: 'New reference' });
    await fireEvent.click(screen.getByText('Edit document'));
    await fireEvent.click(button('save'));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        'w',
        'other-note',
        expect.objectContaining({ revision: 7 }),
        expect.objectContaining({ title: 'Edited title' }),
      ),
    );
  });

  it('does not apply an old save result after the workspace identity changes', async () => {
    let finishSave!: (value: typeof loaded) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    mocks.load.mockResolvedValueOnce(loaded).mockResolvedValueOnce({
      ...loaded,
      document: { ...document, title: 'Other workspace' },
      revision: 9,
    });
    const view = render(ArtifactBlock, { block: reference, workspaceId: 'w' });
    await screen.findByRole('heading', { name: 'Original title' });
    await fireEvent.click(screen.getByText('Edit document'));
    await fireEvent.click(button('save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    await view.rerender({ block: reference, workspaceId: 'other-workspace' });
    await screen.findByRole('heading', { name: 'Other workspace' });
    finishSave({ ...loaded, document: { ...document, title: 'Old save' }, revision: 2 });
    await mocks.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === 'artifacts/saveRequested').promise;
    await waitFor(() => expect(screen.getByTestId('title').textContent).toBe('Other workspace'));
    expect(screen.queryByText('artifacts_block_saved_label')).toBeNull();
  });

  it.each(['board', 'options', 'preview'] as const)(
    'restores an annotation selection in the %s view without changing the document',
    async (kind) => {
      const annotated = {
        ...document,
        kind,
        ...(kind === 'preview' ? { html: '<p>Preview</p>' } : {}),
        items: [...document.items, { ...document.items[0], id: 'card-b' }],
        annotations: [
          { id: 'comment-1', text: 'Discuss the second card', selection: { itemIds: ['card-b'] } },
        ],
      };
      render(ArtifactBlock, { block: { document: annotated }, workspaceId: 'w' });
      await fireEvent.click(screen.getByText('Select card'));
      const annotation = screen.getByRole('button', { name: 'Discuss the second card' });
      expect(annotation.getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(annotation);
      expect(annotation.getAttribute('aria-pressed')).toBe('true');
      await fireEvent.click(button('add'));
      await waitFor(() =>
        expect(mocks.dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'artifacts/selectionQueued' }),
        ),
      );
      const queued = mocks.dispatch.mock.calls
        .map(([action]) => action)
        .find((action) => action.type === 'artifacts/selectionQueued');
      expect(JSON.parse(queued.payload[2][0].content)).toMatchObject({
        selection: { itemIds: ['card-b'] },
        document: annotated,
      });
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it('shows newly added comments immediately and includes them in the explicit note save', async () => {
    const onChange = vi.fn();
    render(ArtifactBlock, { block: { document }, workspaceId: 'w', onChange });
    await fireEvent.click(screen.getByText('Select card'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Review this card' } });
    await fireEvent.click(button('comment'));
    const annotation = screen.getByRole('button', { name: 'Review this card' });
    await fireEvent.click(annotation);
    expect(annotation.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(button('save'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        annotations: [
          expect.objectContaining({ text: 'Review this card', selection: { itemIds: ['card-a'] } }),
        ],
      }),
    );
  });

  it('retains edits on failed save and retries using the original revision', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline'));
    render(ArtifactBlock, { block: reference, workspaceId: 'w' });
    await screen.findByRole('heading', { name: 'Original title' });
    await fireEvent.click(screen.getByText('Edit document'));
    await fireEvent.click(button('save'));
    await screen.findByRole('alert');
    expect(screen.getByTestId('title').textContent).toBe('Edited title');
    await fireEvent.click(button('save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]).toEqual([
      'w',
      'n',
      loaded,
      { ...document, title: 'Edited title' },
    ]);
  });

  it('preserves dirty edits when subscriptions publish a newer revision', async () => {
    render(ArtifactBlock, { block: reference, workspaceId: 'w' });
    await screen.findByRole('heading', { name: 'Original title' });
    await fireEvent.click(screen.getByText('Edit document'));
    mocks.note.set({
      id: 'n',
      workspaceId: 'w',
      rev: 2,
      content:
        '```ws-block:artifact\n' +
        JSON.stringify({ document: { ...document, title: 'Remote title' } }) +
        '\n```',
    });
    await screen.findByText('artifacts_block_stale_description');
    expect(screen.getByTestId('title').textContent).toBe('Edited title');
    expect(button('save').hasAttribute('disabled')).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('reports image capture failure without queuing a partial selection', async () => {
    mocks.images.mockRejectedValue(new Error('missing image'));
    render(ArtifactBlock, { block: { document }, workspaceId: 'w' });
    await fireEvent.click(button('add'));
    await screen.findByRole('alert');
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'artifacts/selectionQueued'),
    ).toBe(false);
  });

  it('saves inline note edits through the outer note and creates a copyable shared note explicitly', async () => {
    const onChange = vi.fn();
    render(ArtifactBlock, { block: { document }, workspaceId: 'w', onChange });
    await fireEvent.click(screen.getByText('Edit document'));
    await fireEvent.click(button('save'));
    expect(onChange).toHaveBeenCalledWith({ ...document, title: 'Edited title' });
    expect(mocks.save).not.toHaveBeenCalled();
    await fireEvent.click(button('share'));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith('w', { ...document, title: 'Edited title' }),
    );
    await fireEvent.click(button('copy'));
    expect(mocks.clipboard).toHaveBeenCalledWith(expect.stringContaining('"noteId": "n"'));
  });
});
