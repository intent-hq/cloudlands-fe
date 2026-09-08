/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import {
  activeDiffMapPathForScroll,
  createDiffMapOpenAction,
  filterDiffMapChanges,
  isDiffMapOpenGesture,
  scrollDiffMapHeaderIntoView,
} from '../chat-changes-diff-map';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { LocalFileChange } from '../types';

function change(filePath: string, action: string, status?: string): LocalFileChange {
  return {
    filePath,
    action,
    status,
    additions: 1,
    deletions: 0,
    toolName: 'test',
    toolCallId: filePath,
    category: 'unstaged',
  } as LocalFileChange;
}

function rect(top: number): DOMRect {
  return { top } as DOMRect;
}

describe('ChatChangesPanel diff map', () => {
  it('omits unstaged additions and porcelain untracked rows from its map document input', () => {
    expect(
      filterDiffMapChanges([
        change('src/tracked.ts', 'modify', 'modified'),
        change('src/added.ts', 'add', 'added'),
        change('src/porcelain.ts', 'modify', '??'),
      ]).map((item) => item.filePath),
    ).toEqual(['src/tracked.ts']);
  });

  it('scrolls the linked diff header selected from the map', () => {
    const container = document.createElement('div');
    const content = document.createElement('div');
    const header = document.createElement('div');
    header.dataset.changeHeaderKey = 'src/target.ts';
    header.dataset.changeStickyTop = '20';
    content.append(header);
    container.append(content);
    container.scrollTop = 10;
    Object.defineProperties(container, {
      scrollHeight: { value: 500 },
      clientHeight: { value: 100 },
    });
    container.getBoundingClientRect = vi.fn(() => rect(10));
    header.getBoundingClientRect = vi.fn(() => rect(110));
    container.scrollTo = vi.fn();

    scrollDiffMapHeaderIntoView(container, content, 'src/target.ts');

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 90, behavior: 'auto' });
  });

  it('builds the exact adjacent-panel open action for a modified map double-click', () => {
    const panel = document.createElement('div');
    const button = document.createElement('button');
    panel.dataset.panelId = 'panel-1';
    panel.append(button);
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    let action: ReturnType<typeof createDiffMapOpenAction> | undefined;
    button.addEventListener('dblclick', (event) => {
      action = createDiffMapOpenAction(
        'workspace-1' as WorkspaceId,
        change('src/target.ts', 'modify', 'modified'),
        event,
      );
    });

    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, ctrlKey: true }));

    expect(action).toEqual({
      type: 'workspaceNavigation/openWorkspaceDiff',
      payload: [
        'workspace-1',
        {
          id: 'chat-change-src/target.ts',
          file: 'src/target.ts',
          relativePath: 'src/target.ts',
          type: 'modified',
          stage: 'unstaged',
          stats: { additions: 1, deletions: 0 },
          attribution: { manual: true, timestamp: 1234 },
        },
        {
          changeId: 'chat-change-src/target.ts',
          filePath: 'src/target.ts',
          openInAdjacentPanel: true,
          sourcePanelId: 'panel-1',
        },
      ],
    });
  });

  it('classifies double-click and modified keyboard events as map-open gestures', () => {
    expect(isDiffMapOpenGesture(new MouseEvent('dblclick'))).toBe(true);
    expect(isDiffMapOpenGesture(new KeyboardEvent('keydown', { ctrlKey: true }))).toBe(true);
    expect(isDiffMapOpenGesture(new KeyboardEvent('keydown', { metaKey: true }))).toBe(true);
    expect(isDiffMapOpenGesture(new MouseEvent('click'))).toBe(false);
    expect(isDiffMapOpenGesture(new MouseEvent('click', { ctrlKey: true }))).toBe(false);
    expect(isDiffMapOpenGesture(new MouseEvent('click', { metaKey: true }))).toBe(false);
  });

  it('moves the active map path as the diff scrolls without issuing a feedback scroll', () => {
    const container = document.createElement('div');
    const content = document.createElement('div');
    const firstCard = document.createElement('div');
    const firstHeader = document.createElement('div');
    const secondCard = document.createElement('div');
    const secondHeader = document.createElement('div');
    firstCard.dataset.changeCardKey = 'src/first.ts';
    firstHeader.dataset.changeMapPath = 'src/first.ts';
    secondCard.dataset.changeCardKey = 'src/second.ts';
    secondHeader.dataset.changeMapPath = 'src/second.ts';
    firstCard.append(firstHeader);
    secondCard.append(secondHeader);
    content.append(firstCard, secondCard);
    container.append(content);
    container.getBoundingClientRect = vi.fn(() => rect(100));
    firstCard.getBoundingClientRect = vi.fn(() => rect(90));
    secondCard.getBoundingClientRect = vi.fn(() => rect(140));
    container.scrollTo = vi.fn();

    expect(activeDiffMapPathForScroll(container, content)).toBe('src/first.ts');
    firstCard.getBoundingClientRect = vi.fn(() => rect(40));
    secondCard.getBoundingClientRect = vi.fn(() => rect(125));
    expect(activeDiffMapPathForScroll(container, content)).toBe('src/second.ts');
    expect(container.scrollTo).not.toHaveBeenCalled();
  });
});
