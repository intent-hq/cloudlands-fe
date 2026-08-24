import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('primary navigation icon contract', () => {
  it('maps each reachable destination to its approved Figma icon', () => {
    const spaces = source('./sidebar-nav/SidebarNav.svelte');
    const titleBar = source('./WindowTitleBar.svelte');
    const launcher = source('./WorkspaceRepoLauncher.svelte');

    expect(spaces).toContain('name="dandelion"');
    expect(spaces).not.toContain('name="spaces"');
    expect(titleBar).toContain('<IntentNavigationIcon name="settings" size={16}');
    expect(launcher).toContain(
      '<FaWrapper icon={faPlus} size={16} class="pointer-events-none size-4!" />',
    );
    expect(titleBar).not.toContain('ChiefTrigger');
    expect(titleBar.match(/<SidebarNav \/>/g)).toHaveLength(1);
    expect(titleBar.indexOf('<SidebarNav />')).toBeLessThan(titleBar.indexOf('<WorkspaceTabStrip'));
    expect(titleBar).not.toContain('WorkspaceViewModeToggle');
    expect(spaces).toContain('shortcut="mod+o"');
    expect(spaces).toContain('label={m.layout_titleBar_toggleSidebar_ariaLabel()}');
    expect(spaces).toContain('aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}');
    expect(spaces).not.toContain('title={m.ui_shortcuts_toggleSpaces_label()}');
  });

  it('centers primary glyphs in 32px transparent hit targets', () => {
    const spaces = source('./sidebar-nav/SidebarNav.svelte');
    const titleBar = source('./WindowTitleBar.svelte');
    const launcher = source('./WorkspaceRepoLauncher.svelte');

    expect(spaces).toContain('size="icon"');
    expect(titleBar).toContain('size="icon"');
    expect(launcher).toContain('<Button');
    expect(launcher).toContain('size="icon"');
    expect(launcher).toContain('class="size-8 shrink-0');
    for (const navSource of [spaces, titleBar]) {
      expect(navSource).toContain('TITLEBAR_NAVIGATION_CONTROL_CLASS');
      expect(navSource).toContain('TITLEBAR_NAVIGATION_GLYPH_CLASS');
    }
    expect(source('./titlebar-navigation.ts')).toContain(
      'titlebar-navigation-glyph flex size-5 shrink-0 items-center justify-center',
    );
  });

  it('uses one full-opacity foreground contract without focus rings or shadows', () => {
    const contract = source('./titlebar-navigation.ts');
    const styles = source('./titlebar-navigation.css');

    expect(contract).toContain(
      'titlebar-navigation-control text-foreground opacity-100 shadow-none outline-none',
    );
    expect(contract).toContain('focus-visible:outline-none focus-visible:ring-0');
    expect(contract).toContain('focus-visible:shadow-none');
    expect(contract).toContain('disabled:opacity-50');
    expect(contract).not.toContain('text-muted-foreground');
    expect(contract).not.toContain('text-subtle');
    expect(contract).not.toMatch(/(?:^|\s)(?:hover:|active:|focus-visible:)?bg-/);
    expect(styles).toContain('.titlebar-navigation-control:hover');
    expect(styles).toContain('.titlebar-navigation-control:active');
    expect(styles).toContain('.titlebar-navigation-control:focus-visible');
    expect(styles).toContain(".titlebar-navigation-control[data-state='on']");
    expect(styles).toContain(".titlebar-navigation-control[aria-pressed='true']");
    expect(styles).toContain(".titlebar-navigation-control[aria-expanded='true']");
    expect(styles).toContain(".titlebar-navigation-control[aria-current='page']");
    expect(styles).toContain('background-color: transparent !important');
    expect(styles).toContain('border-color: transparent !important');
    expect(styles).toContain('color: hsl(var(--foreground)) !important');
    expect(styles).toContain('box-shadow: none !important');
    expect(styles).toContain(
      '.titlebar-navigation-control:focus-visible .titlebar-navigation-glyph',
    );
    expect(styles).toContain('transform: scale(1.125)');
  });
});
