/**
 * @vitest-environment jsdom
 *
 * OnboardingRequirementsStep — the pre-onboarding requirements gate UI.
 * Covers: the quiet first-check posture, the blocked posture with per-tool
 * cards and platform-aware install guidance (daemon host.os mirrored into
 * daemonHealth.stats from the system.status poll), copy-to-clipboard, docs
 * link-outs, the "Check again" affordance, and focus/visibility re-check
 * dispatches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';

import type { HostRequirementsState } from '$store/renderer/slices/host-requirements/host-requirements-types';
import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const hostRequirements: { value: unknown } = { value: null };
  const daemonHealthStats: { value: unknown } = { value: null };
  const handleLink = vi.fn(() => Promise.resolve(true));
  return { dispatch, hostRequirements, daemonHealthStats, handleLink };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      hostRequirements: mocks.hostRequirements.value,
      daemonHealth: { stats: mocks.daemonHealthStats.value },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: mocks.handleLink,
}));

import OnboardingRequirementsStep from './OnboardingRequirementsStep.svelte';

const uncheckedState = (): HostRequirementsState => ({
  git: { checked: false, available: false },
  node: { checked: false, ok: false },
  checking: true,
  hasCheckedOnce: false,
});

const failedState = (): HostRequirementsState => ({
  git: { checked: true, available: false },
  node: { checked: true, ok: false },
  checking: false,
  hasCheckedOnce: true,
});

const metState = (): HostRequirementsState => ({
  git: { checked: true, available: true, version: 'git version 2.44.0' },
  node: { checked: true, ok: true, version: '22.4.0' },
  checking: false,
  hasCheckedOnce: true,
});

const findButton = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostRequirements.value = failedState();
  // Default: daemon reports a macOS host (system.status host.os mirrored
  // into daemonHealth.stats by its polling service).
  mocks.daemonHealthStats.value = { os: 'macos', arch: 'aarch64', clients: 1, agents: 0, listenMode: 'uds' };
});

describe('OnboardingRequirementsStep', () => {
  it('dispatches ensureHostRequirementsChecked on mount', async () => {
    render(OnboardingRequirementsStep);
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'hostRequirements/ensureHostRequirementsChecked' }),
      ),
    );
  });

  it('shows the quiet checking posture until the first check group settles', () => {
    mocks.hostRequirements.value = uncheckedState();
    const { container } = render(OnboardingRequirementsStep);
    expect(container.querySelector('[data-testid="requirements-step-checking"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="requirements-step-results"]')).toBeNull();
  });

  it('renders per-tool failure cards with platform-aware install commands (macos)', async () => {
    const { container } = render(OnboardingRequirementsStep);

    const gitCard = container.querySelector('[data-testid="requirement-git"]');
    expect(gitCard).toBeTruthy();
    expect(gitCard!.textContent).toContain("wasn't found");
    await waitFor(() => expect(gitCard!.textContent).toContain('xcode-select --install'));

    const nodeCard = container.querySelector('[data-testid="requirement-node"]');
    expect(nodeCard).toBeTruthy();
    // Major-only display form derived from MINIMUM_NODE_VERSION ("22+"),
    // never the full "22.0.0+" string.
    expect(nodeCard!.textContent).toContain(`Node.js ${MINIMUM_NODE_VERSION.split('.')[0]}+`);
    expect(nodeCard!.textContent).not.toContain(`${MINIMUM_NODE_VERSION}+`);
    await waitFor(() => expect(nodeCard!.textContent).toContain('brew install node'));
  });

  it('shows the installed-but-too-old node message with the probed version', () => {
    mocks.hostRequirements.value = {
      ...failedState(),
      node: { checked: true, ok: false, version: '18.19.0' },
    };
    const { container } = render(OnboardingRequirementsStep);
    const nodeCard = container.querySelector('[data-testid="requirement-node"]');
    expect(nodeCard!.textContent).toContain(`Node.js ${MINIMUM_NODE_VERSION.split('.')[0]}+`);
    expect(nodeCard!.textContent).toContain('You have 18.19.0 installed');
  });

  it('falls back to docs-link-only guidance when host.os is unavailable', () => {
    mocks.daemonHealthStats.value = null;
    const { container } = render(OnboardingRequirementsStep);
    expect(container.textContent).not.toContain('xcode-select');
    expect(findButton(container, 'Install git')).toBeTruthy();
    expect(findButton(container, 'Install Node.js')).toBeTruthy();
  });

  it('copies the install command to the clipboard on click', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(OnboardingRequirementsStep);
    await waitFor(() => expect(container.textContent).toContain('xcode-select --install'));

    await fireEvent.click(findButton(container, 'xcode-select --install')!);
    expect(writeText).toHaveBeenCalledWith('xcode-select --install');
  });

  it('opens the docs link externally', async () => {
    const { container } = render(OnboardingRequirementsStep);
    await waitFor(() => expect(container.textContent).toContain('xcode-select --install'));
    await fireEvent.click(findButton(container, 'Install git')!);
    expect(mocks.handleLink).toHaveBeenCalledWith('https://git-scm.com/downloads/mac', {});
  });

  it('"Check again" dispatches checkHostRequirementsRequested', async () => {
    const { container } = render(OnboardingRequirementsStep);
    await fireEvent.click(findButton(container, 'Check again')!);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hostRequirements/checkHostRequirementsRequested' }),
    );
  });

  it('re-checks on window focus and on visibilitychange while visible', async () => {
    render(OnboardingRequirementsStep);
    mocks.dispatch.mockClear();

    window.dispatchEvent(new Event('focus'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hostRequirements/checkHostRequirementsRequested' }),
    );

    mocks.dispatch.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hostRequirements/checkHostRequirementsRequested' }),
    );
  });

  it('stops re-checking after unmount', async () => {
    const { unmount } = render(OnboardingRequirementsStep);
    unmount();
    mocks.dispatch.mockClear();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('renders success rows with versions when requirements are met', () => {
    mocks.hostRequirements.value = metState();
    const { container } = render(OnboardingRequirementsStep);
    expect(container.textContent).toContain('git version 2.44.0');
    expect(container.textContent).toContain('v22.4.0');
    expect(container.textContent).not.toContain("wasn't found");
  });
});
