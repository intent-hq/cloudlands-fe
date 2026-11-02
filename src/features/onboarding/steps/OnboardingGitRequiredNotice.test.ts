/**
 * @vitest-environment jsdom
 *
 * Git not required without a forge (Labs): choosing a git project on the
 * onboarding project step while Git is missing prompts to install Git.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  handleLink: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/navigation/link-handler', () => ({ handleLink: mocks.handleLink }));

import OnboardingGitRequiredNotice from './OnboardingGitRequiredNotice.svelte';

const button = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label))!;

beforeEach(() => vi.clearAllMocks());

describe('OnboardingGitRequiredNotice', () => {
  it('asks to install Git and links to the download page', async () => {
    const { container } = render(OnboardingGitRequiredNotice);
    expect(container.textContent).toContain('Install Git to create this project');
    await fireEvent.click(button(container, 'Install git'));
    expect(mocks.handleLink).toHaveBeenCalledWith('https://git-scm.com/downloads', {});
  });

  it('re-checks the host requirements on Check again', async () => {
    const { container } = render(OnboardingGitRequiredNotice);
    await fireEvent.click(button(container, 'Check again'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hostRequirements/checkHostRequirementsRequested' }),
    );
  });
});
