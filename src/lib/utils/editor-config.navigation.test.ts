/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorConfig } from './editor-config';
import { processMarkdownToHTML } from './markdown-processor';

const handleLinkMock = vi.hoisted(() => vi.fn());
vi.mock('$features/navigation/link-handler', () => ({ handleLink: handleLinkMock }));
vi.mock('$lib/utils/store-note-title-lookup', () => ({
  storeNoteTitleLookup: (ws: string, id: string) =>
    ({ 'workspace-1/n1': 'Renamed meeting', 'ws-2/n9': 'Other plan (renamed)' })[`${ws}/${id}`],
}));

describe('note editor navigation', () => {
  beforeEach(() => handleLinkMock.mockClear());

  it('opens intent links in the rendered source panel by default', () => {
    const element = document.createElement('div');
    element.dataset.panelId = 'panel-note';
    const anchor = document.createElement('a');
    anchor.href = 'intent://local/note/spec';
    element.appendChild(anchor);
    const config = createEditorConfig({
      element,
      content: '',
      editable: true,
      onUpdate: () => {},
      workspace: { id: 'workspace-1' },
    });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: anchor });

    config.editorProps?.handleClick?.({} as never, 0, event);

    expect(handleLinkMock).toHaveBeenCalledWith(anchor.href, {
      workspaceId: 'workspace-1',
      sourcePanelId: 'panel-note',
      event,
    });
    expect(
      config.extensions.find((extension) => extension.name === 'taskItem')?.options.workspaceId,
    ).toBe('workspace-1');
  });

  it('forwards a modified click with its source panel', () => {
    const element = document.createElement('div');
    element.dataset.panelId = 'panel-note';
    const anchor = document.createElement('a');
    anchor.href = 'intent://local/note/spec';
    element.appendChild(anchor);
    const config = createEditorConfig({
      element,
      content: '',
      editable: true,
      onUpdate: () => {},
      workspace: { id: 'workspace-1' },
    });
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      metaKey: true,
    });
    Object.defineProperty(event, 'target', { value: anchor });

    config.editorProps?.handleClick?.({} as never, 0, event);

    expect(handleLinkMock).toHaveBeenCalledWith(anchor.href, {
      workspaceId: 'workspace-1',
      sourcePanelId: 'panel-note',
      event,
    });
  });

  it('opens a restored sibling-workspace note chip in its own workspace', async () => {
    const element = document.createElement('div');
    element.dataset.panelId = 'panel-note';
    element.innerHTML = await processMarkdownToHTML('See @note[ws-2/spec:Other plan] now');
    const chip = element.querySelector('[data-mention][data-type="note"]') as HTMLElement;
    expect(chip?.textContent).toBe('Other plan');
    const config = createEditorConfig({
      element,
      content: '',
      editable: true,
      onUpdate: () => {},
      workspace: { id: 'workspace-1' },
    });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: chip });

    config.editorProps?.handleClick?.({} as never, 0, event);

    expect(handleLinkMock).toHaveBeenCalledWith('intent://local/ws-2/note/spec', {
      workspaceId: 'workspace-1',
      sourcePanelId: 'panel-note',
      event,
    });
  });

  it('renders a note chip with its live title but serializes the saved token', () => {
    const config = createEditorConfig({
      element: document.createElement('div'),
      content: '',
      editable: true,
      onUpdate: () => {},
      workspace: { id: 'workspace-1' },
      enableMentions: true,
    } as never);
    const mention = config.extensions.find((extension) => extension.name === 'mention');
    const options = mention?.options as {
      renderHTML: (props: { node: { attrs: Record<string, unknown> } }) => unknown[];
      renderText: (props: { node: { attrs: Record<string, unknown> } }) => string;
    };
    const same = { type: 'note', id: 'n1', label: 'Old meeting', meta: {} };
    const sibling = {
      type: 'note',
      id: 'n9',
      label: 'Other plan',
      meta: { workspaceId: 'ws-2', isExternalLink: true },
    };

    expect(options.renderHTML({ node: { attrs: same } })[2]).toBe('Renamed meeting');
    expect(options.renderHTML({ node: { attrs: sibling } })[2]).toBe('Other plan (renamed)');
    expect(options.renderHTML({ node: { attrs: { ...same, id: 'gone' } } })[2]).toBe('Old meeting');
    expect(options.renderText({ node: { attrs: same } })).toBe('@note[n1:Old meeting]');
  });
});
