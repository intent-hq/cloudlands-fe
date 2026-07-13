import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const editorMocks = vi.hoisted(() => {
  const createdEditors: any[] = [];
  let latestConfig: any = null;
  let setContentSideEffect: ((config: any) => void) | null = null;

  class MockEditor {
    isDestroyed = false;
    setEditable = vi.fn();
    destroy = vi.fn(() => {
      this.isDestroyed = true;
    });
    commands = {
      setContent: vi.fn(() => {
        setContentSideEffect?.(latestConfig);
      }),
    };

    constructor(config: any) {
      latestConfig = config;
      createdEditors.push(this);
      config.onUpdate('<p>normalized during init</p>');
    }
  }

  return {
    MockEditor,
    createdEditors,
    getLatestConfig: () => latestConfig,
    reset: () => {
      createdEditors.splice(0, createdEditors.length);
      latestConfig = null;
      setContentSideEffect = null;
    },
    setSetContentSideEffect: (effect: ((config: any) => void) | null) => {
      setContentSideEffect = effect;
    },
  };
});

vi.mock('@tiptap/core', () => ({
  Editor: editorMocks.MockEditor,
}));

vi.mock('$lib/utils/editor-config', () => ({
  createEditorConfig: (options: any) => options,
}));

vi.mock('$lib/utils/markdown-processor', () => ({
  extractFrontMatter: () => ({ frontMatter: null, body: '' }),
  processMarkdownToHTML: vi.fn(async (content: string) => `<p>${content}</p>`),
  processHTMLToMarkdown: vi.fn(() => '# Project'),
}));

vi.mock('$lib/components/tiptap/BubbleMenu.svelte', () => ({
  default: vi.fn(),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: () => 'ws-1' },
}));

vi.mock('$store/renderer/store', () => ({
  store: { state: {}, dispatch: vi.fn() },
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceFile: vi.fn(),
}));

import MarkdownFileEditor from './MarkdownFileEditor.svelte';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('MarkdownFileEditor external content sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorMocks.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it('ignores TipTap normalization updates during initialization', async () => {
    render(MarkdownFileEditor, { value: '# Project\n', externalContentVersion: 1 });

    await waitFor(() => expect(editorMocks.createdEditors).toHaveLength(1));

    expect(processHTMLToMarkdown).not.toHaveBeenCalled();
  });

  it('still emits user edits after initialization', async () => {
    render(MarkdownFileEditor, { value: '# Project\n', externalContentVersion: 1 });

    await waitFor(() => expect(editorMocks.getLatestConfig()).toBeTruthy());

    editorMocks.getLatestConfig().onUpdate('<p>User edit</p>');

    expect(processHTMLToMarkdown).toHaveBeenCalledWith('<p>User edit</p>', {
      preserveAnchors: false,
    });
  });

  it('sets external content without re-emitting a dirty editor update', async () => {
    const { rerender } = render(MarkdownFileEditor, {
      value: '# Project',
      externalContentVersion: 1,
    });

    await waitFor(() => expect(editorMocks.createdEditors).toHaveLength(1));
    vi.mocked(processHTMLToMarkdown).mockClear();

    await rerender({ value: '# Project\n\nexternal marker', externalContentVersion: 2 });

    await waitFor(() =>
      expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenCalledWith(
        '<p># Project\n\nexternal marker</p>',
        { emitUpdate: false },
      ),
    );
    expect(processMarkdownToHTML).toHaveBeenCalledWith('# Project\n\nexternal marker', {
      preserveAnchors: false,
      processPrimitives: false,
    });
    expect(processHTMLToMarkdown).not.toHaveBeenCalled();
  });

  it('applies two sequential external content versions to the same editor', async () => {
    const { rerender } = render(MarkdownFileEditor, {
      value: '# Project',
      externalContentVersion: 1,
    });

    await waitFor(() => expect(editorMocks.createdEditors).toHaveLength(1));

    await rerender({ value: '# Project\n\nfirst marker', externalContentVersion: 2 });
    await waitFor(() =>
      expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenCalledWith(
        '<p># Project\n\nfirst marker</p>',
        { emitUpdate: false },
      ),
    );

    await rerender({ value: '# Project\n\nsecond marker', externalContentVersion: 3 });

    await waitFor(() =>
      expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenLastCalledWith(
        '<p># Project\n\nsecond marker</p>',
        { emitUpdate: false },
      ),
    );
  });

  it('ignores stale asynchronous markdown conversions from older external content', async () => {
    const { rerender } = render(MarkdownFileEditor, {
      value: '# Project',
      externalContentVersion: 1,
    });

    await waitFor(() => expect(editorMocks.createdEditors).toHaveLength(1));
    vi.mocked(processMarkdownToHTML).mockClear();
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    vi.mocked(processMarkdownToHTML).mockImplementation((content: string) => {
      if (content.includes('first marker')) return first.promise;
      if (content.includes('second marker')) return second.promise;
      return Promise.resolve(`<p>${content}</p>`);
    });

    await rerender({ value: '# Project\n\nfirst marker', externalContentVersion: 2 });
    await waitFor(() =>
      expect(processMarkdownToHTML).toHaveBeenCalledWith('# Project\n\nfirst marker', {
        preserveAnchors: false,
        processPrimitives: false,
      }),
    );

    await rerender({ value: '# Project\n\nsecond marker', externalContentVersion: 3 });
    await waitFor(() =>
      expect(processMarkdownToHTML).toHaveBeenCalledWith('# Project\n\nsecond marker', {
        preserveAnchors: false,
        processPrimitives: false,
      }),
    );

    second.resolve('<p>second marker</p>');
    await waitFor(() =>
      expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenLastCalledWith(
        '<p>second marker</p>',
        { emitUpdate: false },
      ),
    );
    const callCountAfterSecond =
      editorMocks.createdEditors[0].commands.setContent.mock.calls.length;

    first.resolve('<p>first marker</p>');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenCalledTimes(
      callCountAfterSecond,
    );
    expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenLastCalledWith(
      '<p>second marker</p>',
      { emitUpdate: false },
    );
  });

  it('does not emit delayed TipTap echoes from external sync as user edits', async () => {
    const { rerender } = render(MarkdownFileEditor, {
      value: '# Project',
      externalContentVersion: 1,
    });

    await waitFor(() => expect(editorMocks.createdEditors).toHaveLength(1));
    vi.mocked(processHTMLToMarkdown).mockClear();
    editorMocks.setSetContentSideEffect((config: any) => {
      setTimeout(() => config.onUpdate('<p>normalized external echo</p>'), 0);
    });

    await rerender({ value: '# Project\n\nexternal marker', externalContentVersion: 2 });
    await waitFor(() =>
      expect(editorMocks.createdEditors[0].commands.setContent).toHaveBeenCalled(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(processHTMLToMarkdown).not.toHaveBeenCalled();
  });
});
