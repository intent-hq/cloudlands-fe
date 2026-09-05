/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigateToNewWorkspace: vi.fn(async () => undefined) }));

vi.mock('$features/new-workspace/route/new-workspace-navigation', () => ({
  navigateToNewWorkspace: mocks.navigateToNewWorkspace,
}));
import WorkspaceRepoLauncher from './WorkspaceRepoLauncher.svelte';

describe('WorkspaceRepoLauncher', () => {
  beforeEach(() => mocks.navigateToNewWorkspace.mockClear());

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
  ])('opens the Untitled workspace route exactly once by %s', async (_input, activate) => {
    render(WorkspaceRepoLauncher);
    const launcher = screen.getByRole('button', { name: 'New Workspace' });

    expect(launcher.tagName).toBe('BUTTON');
    expect(launcher.getAttribute('data-size')).toBeNull();
    await activate(launcher);

    expect(mocks.navigateToNewWorkspace).toHaveBeenCalledOnce();
  });

  it('renders a centered 16px plus inside the non-shrinking 32px titlebar target', () => {
    const { container } = render(WorkspaceRepoLauncher);
    const launcher = screen.getByRole('button', { name: 'New Workspace' });
    const svg = container.querySelector('svg');

    expect(launcher.className).toContain('size-8');
    expect(launcher.className).toContain('shrink-0');
    expect(launcher.className).toContain('items-center');
    expect(launcher.className).toContain('justify-center');
    expect(launcher.className).toContain('[&_svg]:size-4!');
    expect(svg?.getAttribute('class')).toContain('size-4!');
    expect(svg?.getAttribute('width')).toBe('16px');
    expect(svg?.getAttribute('height')).toBe('16px');
  });

  it('keeps the localized label and tooltip on the native button', async () => {
    render(WorkspaceRepoLauncher);
    const launcher = screen.getByRole('button', { name: 'New Workspace' });

    expect(launcher.getAttribute('aria-label')).toBe('New Workspace');
    await waitFor(() => expect(launcher.hasAttribute('data-tooltip-trigger')).toBe(true));
    expect(
      readFileSync(
        resolve(process.cwd(), 'src/lib/components/layout/WorkspaceRepoLauncher.svelte'),
        'utf8',
      ),
    ).toContain('tooltip={m.menu_new_workspace()}');
  });

  it('uses contained outline-free keyboard focus and pressed treatments', () => {
    render(WorkspaceRepoLauncher);
    const classes = screen.getByRole('button', { name: 'New Workspace' }).className;
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/layout/WorkspaceRepoLauncher.svelte'),
      'utf8',
    );

    expect(classes).toContain('active:bg-muted');
    expect(classes).toContain('focus-visible:border-foreground');
    expect(classes).toContain('focus-visible:bg-muted');
    expect(classes).toContain('focus-visible:outline-0');
    expect(classes).toContain('focus-visible:outline-offset-0');
    expect(classes).toContain('focus-visible:ring-0');
    expect(source).toContain('border-color: ButtonText');
    expect(classes).not.toMatch(/focus-visible:outline-(?:[1-9])/);
    expect(classes).not.toMatch(/focus-visible:outline-offset-(?:[1-9])/);
    expect(classes).not.toMatch(/focus-visible:ring-(?:[1-9])/);
    expect(classes).not.toMatch(/focus-visible:ring-offset-/);
    expect(classes).not.toMatch(/focus-visible:shadow-/);
    expect(source).toContain('button:focus-visible');
    expect(source).toContain('outline-width: 0');
    expect(source).toContain('outline-offset: 0');
    expect(source).not.toMatch(/outline-width:\s*[1-9]/);
  });
});
