/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkspaceId } from '$shared/types/branded-ids';
import SuggestedPrompts from '../SuggestedPrompts.svelte';
import {
  CHAT_OPERATIONAL_LEADING_CLASS,
  COMPACT_TOOL_TRAILING_CLASS,
  OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
  OPERATIONAL_ROW_TONE_CLASS,
} from '../operational-disclosure-row';

const { handleLinkMock } = vi.hoisted(() => ({ handleLinkMock: vi.fn() }));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: handleLinkMock,
}));

beforeEach(() => {
  handleLinkMock.mockReset();
  handleLinkMock.mockResolvedValue(true);
});

afterEach(cleanup);

const PR_URL = 'https://github.com/intent-hq/intent/pull/5034';
const LINK_PROMPT = `Approve the [#5034](${PR_URL}) diagnostic.`;

/** The visual row wrapping a prompt's send control. */
function rowOf(control: HTMLElement): HTMLElement {
  const row = control.closest<HTMLElement>('[data-suggested-prompt-row]');
  if (!row) throw new Error('send control is not inside a prompt row');
  return row;
}

function promptRow(name: string | RegExp): HTMLElement {
  return rowOf(screen.getByRole('button', { name }));
}

describe('SuggestedPrompts', () => {
  it('uses canonical operational body typography and preserves selection behavior', async () => {
    const onSelect = vi.fn();
    render(SuggestedPrompts, {
      props: {
        prompts: ['Approved, proceed with delegation.'],
        onSelect,
      },
    });

    const control = screen.getByRole('button', { name: 'Approved, proceed with delegation.' });
    const suggestion = rowOf(control);
    for (const className of OPERATIONAL_ROW_TONE_CLASS.split(' ')) {
      expect(suggestion.classList.contains(className)).toBe(true);
    }
    for (const className of OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS.split(' ')) {
      expect(suggestion.classList.contains(className)).toBe(true);
    }
    expect(suggestion.classList.contains('items-center')).toBe(true);
    expect(suggestion.classList.contains('items-baseline')).toBe(false);
    expect(suggestion.getAttribute('data-typography-role')).toBe('body');
    expect(suggestion.getAttribute('role')).not.toBe('button');

    await fireEvent.click(suggestion);
    expect(onSelect).toHaveBeenCalledWith('Approved, proceed with delegation.');
    await fireEvent.click(control);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('keeps prompt rows closely grouped in tall chat panels', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['First prompt', 'Second prompt'],
        onSelect: vi.fn(),
      },
    });

    expect(screen.getByTestId('suggested-prompts-list').className).toContain('gap-0.5');
    expect(promptRow('First prompt').className).toContain('py-0.5');
  });

  it('groups follow-up prompts on a quiet surface separate from response prose', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['First prompt'],
        onSelect: vi.fn(),
      },
    });

    const surface = screen.getByTestId('suggested-prompts-surface');
    expect(surface.className).toContain('mt-4');
    expect(surface.className).not.toContain('bg-');
    expect(surface.className).not.toContain('rounded');
    expect(surface.className).not.toContain('border');
    const prompt = promptRow('First prompt');
    expect(prompt.className).toContain('gap-[var(--operational-leading-gap)]');
    expect(prompt.className).toContain('px-1.5');
    expect(prompt.className).not.toContain('hover:bg-');
    expect(prompt.className).toContain('hover:text-foreground');
    const icon = prompt.querySelector('[data-suggested-prompt-icon]')!;
    for (const className of CHAT_OPERATIONAL_LEADING_CLASS.split(' ')) {
      expect(icon.classList.contains(className)).toBe(true);
    }
    expect(icon.className).toContain('mt-px');
    expect(icon.className).toContain('self-start');
    expect(icon.className).not.toContain('/60');
    const source = readFileSync(resolve('src/lib/components/chat/SuggestedPrompts.svelte'), 'utf8');
    expect(source).toContain('size={16} class={CHAT_OPERATIONAL_ICON_CLASS}');
    expect(source).not.toContain('size={18} class={CHAT_OPERATIONAL_ICON_CLASS}');
  });

  it('removes row gaps and tightens padding in short chat panels', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['First prompt', 'Second prompt'],
        onSelect: vi.fn(),
        compact: true,
      },
    });

    const list = screen.getByTestId('suggested-prompts-list');
    expect(list.className).toContain('gap-0');
    expect(list.getAttribute('data-compact')).toBe('true');
    expect(promptRow('First prompt').className).toContain('py-0.5');
  });

  it('connects chat panel compact mode to prompt spacing', () => {
    const chatPanel = readFileSync(resolve('src/lib/components/chat/ChatPanel.svelte'), 'utf8');

    expect(chatPanel).toContain("class=\"w-full {isCompactMode ? 'pb-1 pt-2' : 'py-2'}\"");
    expect(chatPanel).toContain('compact={isCompactMode}');
  });

  it('renders shortcut hints as opaque normal-weight operational metadata', () => {
    render(SuggestedPrompts, {
      props: {
        prompts: ['Approved, proceed with delegation.'],
        onSelect: vi.fn(),
        showShortcutHints: true,
      },
    });

    const hint = screen.getByText(/(?:⌃|Alt\+)1/);
    expect(hint.className).toContain('font-normal!');
    expect(hint.className).toContain('text-muted-foreground!');
    for (const className of COMPACT_TOOL_TRAILING_CLASS.replace('text-ui', '').split(' ')) {
      if (!className) continue;
      expect(hint.classList.contains(className)).toBe(true);
    }
    expect(hint.className).toContain('type-caption');
    expect(hint.className).not.toContain('text-ui');
    expect(hint.className).not.toContain('font-medium');
    expect(hint.className).not.toMatch(/text-(?:muted-foreground|subtle)\//);
    expect(hint.parentElement?.className).toContain('type-body');
  });

  it('preserves keyboard selection and the separate edit affordance', async () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    render(SuggestedPrompts, {
      props: { prompts: ['Review this change'], onSelect, onEdit },
    });

    const suggestion = screen.getByRole('button', { name: 'Review this change' });
    expect(suggestion.tabIndex).toBe(0);
    await fireEvent.keyDown(suggestion, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('Review this change');

    const edit = screen.getByRole('button', { name: 'Edit in input' });
    expect(suggestion.contains(edit)).toBe(false);
    await fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledWith('Review this change');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  describe('markdown links', () => {
    it('renders a well-formed link as an anchor showing its label and keeps the row sending the raw prompt', async () => {
      const onSelect = vi.fn();
      render(SuggestedPrompts, {
        props: { prompts: [LINK_PROMPT], onSelect, workspaceId: WorkspaceId('ws-1') },
      });

      const control = screen.getByRole('button', { name: 'Approve the #5034 diagnostic.' });
      const row = rowOf(control);
      const link = screen.getByRole('link', { name: '#5034' });
      expect(link.getAttribute('href')).toBe(PR_URL);
      expect(link.getAttribute('title')).toBe(PR_URL);
      expect(link.tabIndex).toBe(0);
      expect(link.classList.contains('underline')).toBe(true);
      expect(row.contains(link)).toBe(true);
      expect(row.querySelector('[data-suggested-prompt-label]')?.textContent).toBe(
        'Approve the #5034 diagnostic.',
      );

      await fireEvent.click(row);
      expect(onSelect).toHaveBeenCalledWith(LINK_PROMPT);
      expect(handleLinkMock).not.toHaveBeenCalled();
    });

    it('keeps the link outside the send button and after it in tab order', () => {
      render(SuggestedPrompts, { props: { prompts: [LINK_PROMPT], onSelect: vi.fn() } });

      const control = screen.getByRole('button', { name: 'Approve the #5034 diagnostic.' });
      const link = screen.getByRole('link', { name: '#5034' });
      expect(control.closest('[role="button"]')).toBe(control);
      expect(link.closest('[role="button"], button')).toBeNull();
      expect(control.tabIndex).toBe(0);
      expect(link.tabIndex).toBe(0);
      expect(control.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps one send button per row, named for the whole prompt, when the prompt starts with a link', async () => {
      const prompt = `[#5034](${PR_URL}) needs a review.`;
      const onSelect = vi.fn();
      render(SuggestedPrompts, { props: { prompts: [prompt], onSelect } });

      const control = screen.getByRole('button', { name: '#5034 needs a review.' });
      const link = screen.getByRole('link', { name: '#5034' });
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(control.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(rowOf(control).querySelector('[data-suggested-prompt-label]')?.textContent).toBe(
        '#5034 needs a review.',
      );

      await fireEvent.keyDown(control, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(prompt);
      expect(handleLinkMock).not.toHaveBeenCalled();
    });

    it('routes a link click through handleLink with the workspace and does not select the row', async () => {
      const onSelect = vi.fn();
      render(SuggestedPrompts, {
        props: { prompts: [LINK_PROMPT], onSelect, workspaceId: WorkspaceId('ws-1') },
      });

      const link = screen.getByRole('link', { name: '#5034' });
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(clickEvent);

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(handleLinkMock).toHaveBeenCalledTimes(1);
      expect(handleLinkMock).toHaveBeenCalledWith(
        PR_URL,
        expect.objectContaining({ workspaceId: 'ws-1', event: clickEvent }),
      );
      expect(onSelect).not.toHaveBeenCalled();
    });

    it.each(['Enter', ' '])(
      'activates the link on %j from the keyboard without scrolling or selecting the row',
      async (key) => {
        const onSelect = vi.fn();
        render(SuggestedPrompts, { props: { prompts: [LINK_PROMPT], onSelect } });

        const link = screen.getByRole('link', { name: '#5034' });
        const keyEvent = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        link.dispatchEvent(keyEvent);

        expect(keyEvent.defaultPrevented).toBe(true);
        expect(handleLinkMock).toHaveBeenCalledTimes(1);
        expect(handleLinkMock).toHaveBeenCalledWith(
          PR_URL,
          expect.objectContaining({ workspaceId: undefined, event: keyEvent }),
        );
        expect(onSelect).not.toHaveBeenCalled();
      },
    );

    it.each(['Enter', ' '])('sends the raw markdown when %j is pressed on the row', async (key) => {
      const onSelect = vi.fn();
      render(SuggestedPrompts, { props: { prompts: [LINK_PROMPT], onSelect } });

      await fireEvent.keyDown(screen.getByRole('button', { name: /Approve/ }), { key });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(LINK_PROMPT);
      expect(handleLinkMock).not.toHaveBeenCalled();
    });

    it('routes an uppercase-scheme link with a lowercase scheme while the row keeps the raw prompt', async () => {
      const prompt = 'Review [PR](HTTPS://github.com/intent-hq/intent/pull/5034) now';
      const onSelect = vi.fn();
      render(SuggestedPrompts, { props: { prompts: [prompt], onSelect } });

      const link = screen.getByRole('link', { name: 'PR' });
      expect(link.getAttribute('href')).toBe(PR_URL);
      expect(link.getAttribute('title')).toBe(PR_URL);

      await fireEvent.click(link);
      expect(handleLinkMock).toHaveBeenCalledWith(PR_URL, expect.anything());

      await fireEvent.click(promptRow('Review PR now'));
      expect(onSelect).toHaveBeenCalledWith(prompt);
    });

    it('keeps bare URLs, bare #N and malformed link syntax as literal text', () => {
      const prompts = [
        'Approve #5034 now',
        `See ${PR_URL} please`,
        '[x](javascript:alert(1)) and ![img](https://a.test/i.png)',
      ];
      render(SuggestedPrompts, { props: { prompts, onSelect: vi.fn() } });

      expect(screen.queryAllByRole('link')).toHaveLength(0);
      for (const prompt of prompts) {
        expect(screen.getByRole('button', { name: prompt })).toBeTruthy();
      }
    });

    it('renders several links in one prompt in order', () => {
      render(SuggestedPrompts, {
        props: {
          prompts: ['Merge [#1](https://a.test/1) then [note](intent://local/note/spec).'],
          onSelect: vi.fn(),
        },
      });

      const links = screen.getAllByRole('link');
      expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
        ['#1', 'https://a.test/1'],
        ['note', 'intent://local/note/spec'],
      ]);
      expect(screen.getByRole('button', { name: 'Merge #1 then note.' })).toBeTruthy();
    });
  });
});
