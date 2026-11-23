/**
 * @vitest-environment jsdom
 *
 * The welcome step's note on an orchestrator: agents run on the user's
 * machines, so the step points to Settings → Machines when none is set up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import OnboardingAgentMachinesNotice from './OnboardingAgentMachinesNotice.svelte';

const openButton = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Open Settings → Machines'),
  );

beforeEach(() => mocks.goto.mockReset());

describe('OnboardingAgentMachinesNotice', () => {
  it('asks for a machine and links to Settings → Machines when none is set up', async () => {
    const { container } = render(OnboardingAgentMachinesNotice, { props: { machines: 'none' } });
    expect(container.textContent).toContain('Add a runner to run agents');
    await fireEvent.click(openButton(container)!);
    expect(mocks.goto).toHaveBeenCalledWith('/settings?tab=devices#devices');
  });

  it.each(['machines', 'unknown', 'backend'] as const)('renders nothing for %s', (machines) => {
    const { container } = render(OnboardingAgentMachinesNotice, { props: { machines } });
    expect(container.textContent?.trim()).toBe('');
  });
});
