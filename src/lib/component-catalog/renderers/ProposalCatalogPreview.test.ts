// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import ProposalCatalogPreview from './ProposalCatalogPreview.svelte';

const fixtures = [
  {
    id: 'pending-settings-change',
    title: 'Pending settings change',
    states: ['default', 'editable', 'long-content'],
  },
  {
    id: 'applied-with-undo',
    title: 'Applied with undo',
    states: ['success', 'disabled'],
  },
  {
    id: 'bulk-operation-warning',
    title: 'Bulk operation warning',
    states: ['warning', 'mixed-selection', 'long-content'],
  },
] satisfies UiComponentFixture[];

afterEach(cleanup);

describe('ProposalCatalogPreview', () => {
  it.each(fixtures)('renders every declared state for $id', (fixture) => {
    const { container } = render(ProposalCatalogPreview, { props: { fixture } });
    const renderedStates = Array.from(
      container.querySelectorAll('[data-catalog-rendered-state]'),
    ).flatMap((element) => element.getAttribute('data-catalog-rendered-state')?.split(' ') ?? []);

    expect(new Set(renderedStates)).toEqual(new Set(fixture.states));
    expect(
      container
        .querySelector('[data-catalog-renderer-fixture]')
        ?.getAttribute('data-catalog-renderer-fixture'),
    ).toBe(fixture.id);
  });

  it('uses real canonical controls for the editable pending proposal', () => {
    const { container } = render(ProposalCatalogPreview, { props: { fixture: fixtures[0] } });

    expect(screen.getByRole('heading', { name: 'Update workspace defaults' })).toBeTruthy();
    expect(screen.getByLabelText('Workspace title').getAttribute('data-slot')).toBe('input');
    expect(screen.getByRole('button', { name: 'Apply changes' }).getAttribute('data-slot')).toBe(
      'button',
    );
    expect(container.textContent).not.toContain('Static proposal preview');
  });

  it('renders applied and mixed-selection states instead of labeling placeholders', () => {
    const applied = render(ProposalCatalogPreview, { props: { fixture: fixtures[1] } });
    expect(screen.getByRole('status').textContent).toContain('Applied just now');
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    applied.unmount();

    render(ProposalCatalogPreview, { props: { fixture: fixtures[2] } });
    expect(screen.getByRole('note', { name: 'Proposal warning' })).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Toggle Review Buddy' }).getAttribute('data-state'),
    ).toBe('checked');
    expect(
      screen.getByRole('checkbox', { name: 'Toggle Test Writer' }).getAttribute('data-state'),
    ).toBe('unchecked');
  });
});
