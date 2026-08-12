/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '$shared/types/agent-session';

const mocks = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial;
    return {
      subscribe(run: (next: T) => void) {
        run(value);
        return () => {};
      },
      set(next: T) {
        value = next;
      },
    };
  }

  const specialists$ = writable([
    {
      id: 'ui-designer',
      name: 'UI Designer',
      description: 'Designs polished, accessible product interfaces.',
      source: 'bundled',
    },
  ]);

  return { specialists$, writable, navigateToSettings: vi.fn() };
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.specialists$,
  selectUserOverrides: () => mocks.writable({ modelOverrides: {} }),
  filterPickableSpecialists: (specialists: unknown[]) => specialists,
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.writable(true),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: mocks.navigateToSettings,
}));

vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockDropdownMenu.svelte'))
    .default,
}));

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../ui/__tests__/mocks/Fa.svelte')).default,
}));

import RegularAgentWelcome from './RegularAgentWelcome.svelte';

function session(specialist?: string): AgentSession {
  return {
    id: 'agent-1',
    backendSessionId: null,
    metadata: specialist ? { specialist } : {},
  } as unknown as AgentSession;
}

describe('RegularAgentWelcome specialist picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('shows rich specialist details and selects a specialist', async () => {
    const onSpecialistChange = vi.fn();
    render(RegularAgentWelcome, { props: { session: session(), onSpecialistChange } });

    const trigger = screen.getByTestId('specialist-picker-trigger');
    expect(trigger.textContent).toContain('General');
    expect(trigger.textContent).toContain('No specialized behavior');

    await fireEvent.click(trigger);
    const option = document.querySelector<HTMLButtonElement>(
      '[data-specialist-option="ui-designer"]',
    );
    expect(option).not.toBeNull();
    expect(option?.textContent).toContain('Designs polished, accessible product interfaces.');

    await fireEvent.click(option!);
    expect(onSpecialistChange).toHaveBeenCalledWith('ui-designer');
    expect(document.querySelector('[data-specialist-option="ui-designer"]')).toBeNull();
  });

  it('marks the current specialist as selected', async () => {
    render(RegularAgentWelcome, {
      props: { session: session('ui-designer'), onSpecialistChange: vi.fn() },
    });

    const trigger = screen.getByTestId('specialist-picker-trigger');
    expect(trigger.textContent).toContain('UI Designer');
    await fireEvent.click(trigger);

    expect(
      document
        .querySelector('[data-specialist-option="ui-designer"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
