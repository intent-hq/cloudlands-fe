/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';

vi.mock('../PullRequestCreator.svelte', async () => ({
  default: (await import('./mocks/MockPullRequestCreator.svelte')).default,
}));

import WorkspaceModals from '../WorkspaceModals.svelte';

const workspace = (overrides: Partial<Workspace> = {}) =>
  ({ id: 'ws-1', title: 'Workspace', branch: 'main', ...overrides }) as Workspace;

describe('WorkspaceModals pull request creator', () => {
  it('never opens the PR creator for a plain-folder workspace', () => {
    const { container } = render(WorkspaceModals, {
      props: { workspace: workspace({ plainFolder: true, branch: '' }), showPRCreator: true },
    });
    expect(container.querySelector('[data-mock-pull-request-creator]')).toBeNull();
  });

  it('opens the PR creator for a git workspace', () => {
    const { container } = render(WorkspaceModals, {
      props: { workspace: workspace(), showPRCreator: true },
    });
    expect(container.querySelector('[data-mock-pull-request-creator]')).toBeTruthy();
  });
});
