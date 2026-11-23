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

  it('renders the change notices', () => {
    render(EffortChangeNotice, { props: { notice: { from: 'low', to: 'high' } } });
    expect(screen.getByRole('status').querySelector('svg')).toBeTruthy();
  });
});
