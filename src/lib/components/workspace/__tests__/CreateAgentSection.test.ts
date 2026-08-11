import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import CreateAgentSection from '../CreateAgentSection.svelte';

describe('CreateAgentSection blank-agent creation', () => {
  afterEach(() => {
    cleanup();
  });

  it('creates a blank agent immediately from the compact plus button', async () => {
    const onCreateWithSpecialist = vi.fn();
    render(CreateAgentSection, {
      props: { compact: true, onCreateWithSpecialist },
    });

    const trigger = screen.getByRole('button', { name: 'Create new agent' });
    expect(trigger.classList.contains('shadow-none')).toBe(true);
    expect(trigger.classList.contains('shadow-xs')).toBe(false);

    await fireEvent.click(trigger);

    expect(onCreateWithSpecialist).toHaveBeenCalledOnce();
    expect(onCreateWithSpecialist).toHaveBeenCalledWith(null);
    expect(screen.queryByText('Blank Agent')).toBeNull();
  });

  it('falls back to plain creation from the full-width button', async () => {
    const onCreate = vi.fn();
    render(CreateAgentSection, { props: { onCreate } });

    await fireEvent.click(screen.getByRole('button', { name: 'Create new agent' }));

    expect(onCreate).toHaveBeenCalledOnce();
  });
});
