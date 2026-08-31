/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';
import SlashSkillSuggestionList from './SlashSkillSuggestionList.svelte';

const items: SkillInfo[] = [
  {
    name: 'review',
    description: 'Review a change',
    location: '/skills/review',
  },
  {
    name: 'research',
    description: 'Research a topic',
    location: '/skills/research',
  },
];

describe('SlashSkillSuggestionList', () => {
  afterEach(cleanup);

  it('renders localized loading, error, and empty states', () => {
    const onSelect = vi.fn();
    const view = render(SlashSkillSuggestionList, { props: { loading: true, onSelect } });
    expect(screen.getByRole('status').textContent).toContain('Loading skills');

    view.rerender({ loading: false, error: 'wire failure', onSelect });
    expect(screen.getByRole('alert').textContent).toContain('Failed to load skills');
    expect(screen.queryByText('wire failure')).toBeNull();

    view.rerender({ error: null, items: [], onSelect });
    expect(screen.getByRole('status').textContent).toContain('No matching skills');
  });

  it('renders a compact slash-free list and exposes descriptions as accessible tooltips', async () => {
    const view = render(SlashSkillSuggestionList, { props: { items, onSelect: vi.fn() } });
    const surface = view.container.querySelector('.slash-skill-suggestion-list');
    expect(surface?.classList.contains('max-w-72')).toBe(true);
    expect(surface?.classList.contains('rounded-(--radius-medium)')).toBe(true);
    expect(surface?.classList.contains('shadow-(--elevation-overlay)')).toBe(true);

    const reviewOption = screen.getByRole('option', { name: 'review' });
    expect(reviewOption.textContent?.trim()).toBe('review');
    const reviewLabel = reviewOption.querySelector('span');
    expect(reviewLabel?.className).toContain('type-body');
    expect(reviewLabel?.className).not.toContain('type-code');
    expect(screen.queryByText('Review a change')).toBeNull();

    reviewOption.focus();
    await fireEvent.focus(reviewOption);
    const tooltip = await screen.findByRole('tooltip', {
      name: 'Review a change',
      hidden: true,
    });
    expect(tooltip.className).toContain('type-caption');
    await waitFor(() => expect(reviewOption.getAttribute('aria-describedby')).toBe(tooltip.id));
  });

  it('exposes listbox selection and supports wrapping keyboard navigation', async () => {
    const onSelect = vi.fn();
    render(SlashSkillSuggestionList, { props: { items, onSelect } });

    const listbox = screen.getByRole('listbox', { name: 'Skill commands' });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[0].id);

    await fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    await fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it('supports pointer highlighting and selection without moving focus', async () => {
    const onSelect = vi.fn();
    render(SlashSkillSuggestionList, { props: { items, onSelect } });
    const options = screen.getAllByRole('option');

    await fireEvent.pointerEnter(options[1]);
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    const pointerDownResult = await fireEvent.pointerDown(options[1]);
    expect(pointerDownResult).toBe(false);
    await fireEvent.click(options[1]);
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it('dismisses on Escape and leaves ordinary keys unhandled', async () => {
    const onDismiss = vi.fn();
    render(SlashSkillSuggestionList, {
      props: { items, onSelect: vi.fn(), onDismiss },
    });
    const listbox = screen.getByRole('listbox');

    expect(await fireEvent.keyDown(listbox, { key: 'a' })).toBe(true);
    expect(await fireEvent.keyDown(listbox, { key: 'Escape' })).toBe(false);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('resets selection when the available items change', async () => {
    const onSelect = vi.fn();
    const view = render(SlashSkillSuggestionList, { props: { items, onSelect } });
    const listbox = screen.getByRole('listbox');
    await fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    await view.rerender({ items: [items[1]], onSelect });
    expect(screen.getByRole('option').getAttribute('aria-selected')).toBe('true');
  });
});
