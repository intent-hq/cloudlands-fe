/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import { faFlag } from '@fortawesome/free-solid-svg-icons';
import ChatInlineDivider from '../ChatInlineDivider.svelte';
import EffortChangeNotice from '../EffortChangeNotice.svelte';

const label = createRawSnippet(() => ({ render: () => '<span>Goal removed.</span>' }));

describe('ChatInlineDivider', () => {
  it('announces the icon and label as a status row', () => {
    render(ChatInlineDivider, { props: { icon: faFlag, children: label } });
    const row = screen.getByRole('status');
    expect(row.textContent?.trim()).toBe('Goal removed.');
    expect(row.querySelector('svg')).toBeTruthy();
  });

  it('drops the status role when the host asks', () => {
    render(ChatInlineDivider, { props: { icon: faFlag, children: label, role: null } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Goal removed.')).toBeTruthy();
  });

  it('keeps a host class and lets it override the default margin', () => {
    const { container } = render(ChatInlineDivider, {
      props: { icon: faFlag, children: label, class: 'model-change-notice my-0' },
    });
    const row = container.firstElementChild!;
    // The class merge is the contract: GoalNotice relies on my-0 replacing my-4.
    // eslint-disable-next-line intent/no-class-name-assertions-in-tests -- merge contract
    expect(row.classList.contains('model-change-notice')).toBe(true);
    // eslint-disable-next-line intent/no-class-name-assertions-in-tests -- merge contract
    expect(row.classList.contains('my-0')).toBe(true);
    // eslint-disable-next-line intent/no-class-name-assertions-in-tests -- merge contract
    expect(row.classList.contains('my-4')).toBe(false);
  });

  it('is what EffortChangeNotice renders', () => {
    render(EffortChangeNotice, { props: { notice: { from: 'low', to: 'high' } } });
    expect(screen.getByRole('status').querySelector('svg')).toBeTruthy();
  });
});
