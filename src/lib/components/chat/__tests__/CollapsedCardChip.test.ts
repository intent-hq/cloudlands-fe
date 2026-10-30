/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import CollapsedCardChip from '../CollapsedCardChip.svelte';

function actionSnippet(onAction: () => void) {
  return createRawSnippet(() => ({
    render: () => '<button type="button" data-testid="chip-action">Act</button>',
    setup: (node: Element) => {
      node.addEventListener('click', onAction);
      return () => node.removeEventListener('click', onAction);
    },
  }));
}

function setup(props: { count?: number; action?: ReturnType<typeof actionSnippet> } = {}) {
  const onExpand = vi.fn();
  render(CollapsedCardChip, {
    props: {
      title: 'Card title',
      expandLabel: 'Open card',
      onExpand,
      expandTestId: 'chip-expand',
      'data-testid': 'chip-root',
      ...props,
    },
  });
  return { onExpand, expand: screen.getByTestId('chip-expand') };
}

describe('CollapsedCardChip', () => {
  it('expands on click and reports itself as collapsed', async () => {
    const { onExpand, expand } = setup();
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(expand);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('shows the count only when one is given', () => {
    setup({ count: 3 });
    expect(screen.getByTestId('chip-expand').textContent).toContain('3');
  });

  it('omits the count when none is given', () => {
    setup();
    expect(screen.getByTestId('chip-expand').textContent).not.toMatch(/\d/);
  });

  it('renders the action as a separate control that does not expand', async () => {
    const onAction = vi.fn();
    const { onExpand, expand } = setup({ action: actionSnippet(onAction) });
    const action = screen.getByTestId('chip-action');
    expect(expand.contains(action)).toBe(false);
    expect(expand.querySelector('button, a, input')).toBeNull();
    await fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('renders only the expand button without an action', () => {
    setup();
    expect(screen.getByTestId('chip-root').querySelectorAll('button')).toHaveLength(1);
  });
});
