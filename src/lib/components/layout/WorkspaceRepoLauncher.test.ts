/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { m } from '$shared/paraglide/messages.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), isCollaboratorOnlyClient: { value: false } }));

vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectIsCollaboratorOnlyClient: () => readable(mocks.isCollaboratorOnlyClient.value),
}));
import WorkspaceRepoLauncher from './WorkspaceRepoLauncher.svelte';

describe('WorkspaceRepoLauncher', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.isCollaboratorOnlyClient.value = false;
  });

  it('withholds the launcher for a collaborator-only client (multiplayer w3)', () => {
    mocks.isCollaboratorOnlyClient.value = true;
    render(WorkspaceRepoLauncher);
    expect(screen.queryByRole('button', { name: 'New Workspace' })).toBeNull();
  });

  it.each([
    ['pointer', async (launcher: HTMLElement) => fireEvent.click(launcher)],
    [
      'Enter',
      async (launcher: HTMLElement) => {
        launcher.focus();
        await fireEvent.keyDown(launcher, { key: 'Enter' });
        await fireEvent.keyUp(launcher, { key: 'Enter' });
        await fireEvent.click(launcher, { detail: 0 });
      },
    ],
    [
      'Space',
      async (launcher: HTMLElement) => {
        launcher.focus();
        await fireEvent.keyDown(launcher, { key: ' ' });
        await fireEvent.keyUp(launcher, { key: ' ' });
        await fireEvent.click(launcher, { detail: 0 });
      },
    ],
  ])('opens the existing create modal exactly once by %s', async (_input, activate) => {
    render(WorkspaceRepoLauncher);
    const launcher = screen.getByRole('button', { name: 'New Workspace' });

    expect(launcher.tagName).toBe('BUTTON');
    expect(launcher.getAttribute('data-size')).toBeNull();
    await activate(launcher);

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'sidebarNav/setShowCreateModal',
      payload: [true],
    });
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) =>
          action.type === 'workspaceInitializer/setCompactWorkspaceInitializerFormState',
      ),
    ).toBe(false);
  });

  it('renders a centered 14px plus inside the non-shrinking 32px titlebar target', () => {
    const { container } = render(WorkspaceRepoLauncher);
    const launcher = screen.getByRole('button', { name: 'New Workspace' });
    const svg = container.querySelector('svg');
    const iconOverride = launcher.className.match(/\[&_svg\]:size-([\d.]+)!/);
    const iconClassSize = svg?.getAttribute('class')?.match(/(?:^|\s)size-([\d.]+)!/);

    expect(launcher.className).toContain('size-8');
    expect(launcher.className).toContain('shrink-0');
    expect(launcher.className).toContain('items-center');
    expect(launcher.className).toContain('justify-center');
    expect(svg?.getAttribute('width')).toBe('14px');
    expect(svg?.getAttribute('height')).toBe('14px');
    expect(Number(iconOverride?.[1]) * 4).toBe(14);
    expect(Number(iconClassSize?.[1]) * 4).toBe(14);
  });

  it('keeps the localized label and tooltip on the native button', async () => {
    render(WorkspaceRepoLauncher);
    const launcher = screen.getByRole('button', { name: m.menu_new_workspace() });

    expect(launcher.getAttribute('aria-label')).toBe(m.menu_new_workspace());
    await waitFor(() => expect(launcher.hasAttribute('data-tooltip-trigger')).toBe(true));
    launcher.focus();
    await fireEvent.focus(launcher);
    const tooltip = await screen.findByRole('tooltip', {
      name: m.menu_new_workspace(),
      hidden: true,
    });
    await waitFor(() => expect(launcher.getAttribute('aria-describedby')).toBe(tooltip.id));
  });

  // The resolved focus-visible treatment (outline, border, background, forced
  // colors) needs a real browser: WorkspaceRepoLauncher.focus-visible.ct.spec.ts.
  it('uses contained outline-free keyboard focus and pressed treatments', () => {
    render(WorkspaceRepoLauncher);
    const classes = screen.getByRole('button', { name: 'New Workspace' }).className;

    expect(classes).toContain('active:bg-muted');
    expect(classes).toContain('focus-visible:border-foreground');
    expect(classes).toContain('focus-visible:bg-muted');
    expect(classes).toContain('focus-visible:outline-0');
    expect(classes).toContain('focus-visible:outline-offset-0');
    expect(classes).toContain('focus-visible:ring-0');
    expect(classes).not.toMatch(/focus-visible:outline-(?:[1-9])/);
    expect(classes).not.toMatch(/focus-visible:outline-offset-(?:[1-9])/);
    expect(classes).not.toMatch(/focus-visible:ring-(?:[1-9])/);
    expect(classes).not.toMatch(/focus-visible:ring-offset-/);
    expect(classes).not.toMatch(/focus-visible:shadow-/);
  });
});
