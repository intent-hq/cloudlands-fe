/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorConfig } from './editor-config';

const handleLinkMock = vi.hoisted(() => vi.fn());
vi.mock('$features/navigation/link-handler', () => ({ handleLink: handleLinkMock }));

describe('note editor navigation', () => {
  beforeEach(() => handleLinkMock.mockClear());

  it('opens intent links beside the rendered source panel by default', () => {
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
      openInAdjacentPanel: true,
      openInNewAdjacentPanel: true,
      event,
    });
  });
});
