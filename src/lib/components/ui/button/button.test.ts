/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { parse } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';
import Button from './button.svelte';
import ButtonHarness from './ButtonHarness.svelte';
import { buttonFixtures } from './button.fixtures';
import { buttonMetadata } from './button.meta';
import {
  activeButtonSurfaceVariants,
  buttonCompatibilityAliases,
  buttonEmphasisLadder,
  buttonSizeLadder,
  buttonSurfaceVariants,
  buttonVariants,
  type ButtonSize,
} from './button.variants';

describe('Button', () => {
  it('owns one variant recipe and maps every size to the control-height scale', () => {
    const sources = ['button.svelte', 'index.ts', 'button.variants.ts'].map((file) =>
      readFileSync(new URL(file, import.meta.url), 'utf8'),
    );
    const source = sources.join('\n');
    expect(source.match(/\btv\(/g)).toHaveLength(1);
    expect(source.match(/export type ButtonVariant\b/g)).toHaveLength(1);
    expect(source.match(/export type ButtonSize\b/g)).toHaveLength(1);
    expect(source.match(/export type ButtonProps\b/g)).toHaveLength(1);
    expect(buttonVariants({ size: 'icon-xs' })).toContain('size-(--control-height-compact)');
    expect(buttonVariants({ size: 'xs' })).toContain('h-(--control-height-compact)');
    expect(buttonVariants({ size: 'sm' })).toContain('h-(--control-height-small)');
    expect(buttonVariants({ size: 'default' })).toContain('h-(--control-height-medium)');
    expect(buttonVariants({ size: 'lg' })).toContain('h-(--control-height-large)');
    expect(buttonVariants({ size: 'default' })).toContain('px-4');
    expect(buttonVariants()).toContain('rounded-(--radius-medium)');
    expect(buttonVariants()).toContain('border-0');
    expect(buttonVariants()).toContain('font-normal');
    expect(buttonVariants()).not.toContain('outline-none');
    expect(buttonVariants()).not.toContain('focus-visible:ring');
    expect(buttonVariants()).toContain('type-caption');
    expect(buttonVariants()).not.toMatch(/\btext-(?:xs|sm|base)\b/);
  });

  it('publishes the canonical emphasis, size, and compatibility ladders', () => {
    expect(buttonEmphasisLadder.map(({ value }) => value)).toEqual([
      'primary',
      'secondary',
      'ghost',
      'destructive',
    ]);
    expect(buttonSizeLadder).toEqual([
      { value: 'sm', iconValue: 'icon-sm', label: 'Small' },
      { value: 'default', iconValue: 'icon', label: 'Medium' },
      { value: 'lg', iconValue: 'icon-lg', label: 'Large' },
    ]);
    expect(buttonCompatibilityAliases).toEqual([
      { prop: 'variant', alias: 'default', replacement: 'secondary' },
      { prop: 'variant', alias: 'tertiary', replacement: 'outline' },
      { prop: 'variant', alias: 'neumorphic', replacement: 'outline' },
      { prop: 'size', alias: 'xs', replacement: 'compact' },
      { prop: 'size', alias: 'icon-xs', replacement: 'icon-compact' },
    ]);
    expect(buttonVariants()).toBe(buttonVariants({ variant: 'secondary', size: 'default' }));
    expect(buttonMetadata.apiGuidance?.emphasis).toEqual(buttonEmphasisLadder);
  });

  it('gives default, primary, and secondary solid raised surfaces with pressed states', () => {
    const defaultButton = buttonVariants({ variant: 'default' });
    expect(defaultButton).toBe(buttonVariants({ variant: 'secondary' }));
    expect(defaultButton).toContain('text-secondary-foreground');
    expect(buttonSurfaceVariants.default).toBe(buttonSurfaceVariants.secondary);
    expect(activeButtonSurfaceVariants.default).toBe(activeButtonSurfaceVariants.secondary);
    expect(buttonVariants({ variant: 'primary' })).toContain('text-primary-foreground');
    expect(buttonSurfaceVariants.primary).toContain('bg-primary');
    expect(buttonSurfaceVariants.primary).toContain('shadow-(--elevation-raised)');
    expect(buttonSurfaceVariants.primary).toContain('group-active/button:brightness-90');
    const outlineButton = buttonVariants({ variant: 'outline' });
    expect(outlineButton).toContain('text-foreground');
    expect(buttonSurfaceVariants.outline).toContain('group-hover/button:bg-hover');
    expect(buttonSurfaceVariants.outline).toContain('group-active/button:bg-active');
    const secondaryButton = buttonVariants({ variant: 'secondary' });
    expect(secondaryButton).toContain('text-secondary-foreground');
    expect(buttonSurfaceVariants.secondary).toContain('bg-secondary');
    expect(buttonSurfaceVariants.secondary).toContain('shadow-(--elevation-raised)');
    expect(buttonSurfaceVariants.secondary).toContain('group-active/button:brightness-90');
    const destructiveButton = buttonVariants({ variant: 'destructive' });
    expect(destructiveButton).toContain('text-danger-background');
    expect(buttonSurfaceVariants.destructive).toContain('bg-danger');
    expect(buttonSurfaceVariants.neumorphic).toBe(buttonSurfaceVariants.outline);
  });

  it('keeps filled and ghost controls borderless while outline controls retain 1px', () => {
    for (const variant of ['default', 'primary', 'secondary', 'destructive', 'ghost'] as const) {
      const classes = buttonVariants({ variant }).split(/\s+/);
      expect(classes).toContain('border-0');
      expect(classes).not.toContain('border');
    }

    const outline = buttonVariants({ variant: 'outline' }).split(/\s+/);
    expect(outline).toEqual(expect.arrayContaining(['border', 'border-border']));
    expect(buttonSurfaceVariants.outline).toContain('shadow-none');
  });

  it('renders press-collapse, forced-active, icon, loading, and contextual-size states', () => {
    const { container } = render(ButtonHarness);
    const contextual = screen.getByRole('button', { name: 'Contextual action' });
    const explicit = screen.getByRole('button', { name: 'Explicit action' });
    const active = screen.getByRole('button', { name: 'Active action' });
    const loading = screen.getByRole('button', { name: 'Loading action' });

    expect(contextual.className).toContain('h-(--control-height-compact)');
    expect(explicit.className).toContain('h-(--control-height-large)');
    expect(active.getAttribute('data-state')).toBe('active');
    expect(active.querySelector('[data-slot="button-surface"]')?.className).toContain('bg-active');
    expect(activeButtonSurfaceVariants.outline).toContain('bg-active');

    const iconButton = screen.getByRole('button', { name: 'Navigate' });
    expect(iconButton.querySelector('[data-slot="button-leading-icon"]')).not.toBeNull();
    expect(iconButton.querySelector('[data-slot="button-trailing-icon"]')).not.toBeNull();
    expect(iconButton.className).toContain('pl-[var(--button-icon-padding)]');
    expect(iconButton.className).toContain('pr-[var(--button-icon-padding)]');

    const content = loading.querySelector('[data-slot="button-content"]');
    const label = loading.querySelector('[data-slot="button-label"]');
    const spinner = loading.querySelector('[data-slot="button-spinner"]');
    expect(content?.textContent).toContain('Preserved loading label');
    expect(content?.classList.contains('min-w-0')).toBe(true);
    expect(label?.classList.contains('truncate')).toBe(true);
    expect(content?.classList.contains('opacity-0')).toBe(true);
    const loader = spinner?.querySelector('[data-slot="intent-mark-loader"]');
    expect(loader?.getAttribute('data-variant')).toBe('bloom');
    expect(loader?.getAttribute('data-playing')).toBe('true');
    expect(loader?.getAttribute('width')).toBe('16');
    expect(loader?.getAttribute('class')).toContain('size-4!');
    expect(container.querySelectorAll('[data-slot="button-surface"]')).toHaveLength(5);
  });

  it('lets a caller replace the default caption role with body typography', () => {
    render(Button, { props: { 'aria-label': 'Body action', class: 'type-body' } });

    const button = screen.getByRole('button', { name: 'Body action' });
    expect(button.classList.contains('type-body')).toBe(true);
    expect(button.classList.contains('type-caption')).toBe(false);
  });

  it('keeps full-card layout regions as direct children when content wrapping is disabled', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span data-testid="card-layout-region"></span>',
    }));
    render(Button, { props: { 'aria-label': 'Workspace card', wrapContent: false, children } });

    const button = screen.getByRole('button', { name: 'Workspace card' });
    expect(screen.getByTestId('card-layout-region').parentElement).toBe(button);
    expect(button.querySelector('[data-slot="button-content"]')).toBeNull();
  });

  it('prevents disabled and loading buttons from activating', async () => {
    const disabledClick = vi.fn();
    const { unmount } = render(Button, {
      props: { 'aria-label': 'Disabled action', disabled: true, onclick: disabledClick },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Disabled action' }));
    expect(disabledClick).not.toHaveBeenCalled();
    unmount();

    const loadingClick = vi.fn();
    render(Button, {
      props: { 'aria-label': 'Save', loading: true, onclick: loadingClick },
    });
    const loading = screen.getByRole('button', { name: 'Save' });
    expect((loading as HTMLButtonElement).disabled).toBe(true);
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
    await fireEvent.click(loading);
    expect(loadingClick).not.toHaveBeenCalled();
  });

  it('preserves native keyboard focus and forwards keyboard events', async () => {
    const onkeydown = vi.fn();
    render(Button, { props: { 'aria-label': 'Keyboard action', onkeydown } });
    const button = screen.getByRole('button', { name: 'Keyboard action' });
    button.focus();
    await fireEvent.keyDown(button, { key: 'Enter' });
    expect(document.activeElement).toBe(button);
    expect(onkeydown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
  });

  it.each(['icon', 'icon-compact', 'icon-sm', 'icon-xs', 'icon-lg'] as const)(
    'rejects unnamed %s buttons',
    (size) => {
      expect(() => render(Button, { props: { size } })).toThrow(/requires a non-empty/i);
    },
  );

  it('rejects malformed icon-like size values instead of bypassing name enforcement', () => {
    const size = 'icon-xs -mt-2 -mr-2' as ButtonSize;
    expect(() => render(Button, { props: { size } })).toThrow(/requires a non-empty/i);
  });

  it('enforces canonical sizes and accessible names for literal icon Button callers', () => {
    const srcRoot = resolve(process.cwd(), 'src');
    const canonicalSizes = new Set(['icon', 'icon-compact', 'icon-sm', 'icon-xs', 'icon-lg']);
    const nameAttributes = new Set(['aria-label', 'aria-labelledby', 'title', 'tooltip']);
    const malformed: string[] = [];
    const unnamed: string[] = [];

    type AstNode = {
      type?: string;
      name?: string;
      data?: string;
      attributes?: AstNode[];
      value?: true | AstNode[];
      [key: string]: unknown;
    };

    const staticAttribute = (attributes: AstNode[], name: string) => {
      const attribute = attributes.find((candidate) => candidate.name === name);
      const value = attribute?.value;
      return Array.isArray(value) && value.length === 1 && value[0].type === 'Text'
        ? value[0].data
        : undefined;
    };
    const hasName = (attributes: AstNode[]) =>
      attributes.some((attribute) => {
        if (!attribute.name || !nameAttributes.has(attribute.name)) return false;
        if (!Array.isArray(attribute.value)) return attribute.value !== true;
        if (attribute.value.some((chunk) => chunk.type !== 'Text')) return true;
        return attribute.value.some((chunk) => chunk.data?.trim());
      });

    for (const path of readdirSync(srcRoot, { recursive: true }).filter((entry) =>
      entry.endsWith('.svelte'),
    )) {
      const source = readFileSync(resolve(srcRoot, path), 'utf8');
      const visited = new WeakSet<object>();
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object' || visited.has(value)) return;
        visited.add(value);
        const node = value as AstNode;
        if (node.type === 'Component' && node.name === 'Button') {
          const attributes = node.attributes ?? [];
          const size = staticAttribute(attributes, 'size');
          if (size?.startsWith('icon')) {
            if (!canonicalSizes.has(size)) malformed.push(`${path}: ${size}`);
            else if (!hasName(attributes)) unnamed.push(`${path}: ${size}`);
          }
        }
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
      };
      visit(parse(source, { modern: true }).fragment);
    }

    expect({ malformed, unnamed }).toEqual({ malformed: [], unnamed: [] });
  });

  it.each(['aria-label', 'aria-labelledby', 'title', 'tooltip'] as const)(
    'rejects an empty %s on icon buttons',
    (nameSource) => {
      expect(() => render(Button, { props: { size: 'icon', [nameSource]: ' ' } })).toThrow(
        /requires a non-empty/i,
      );
    },
  );

  it('accepts every supported accessible-name source for icon buttons', () => {
    expect(() => render(Button, { props: { iconOnly: true } })).toThrow(/requires a non-empty/i);

    const labelledBy = document.createElement('span');
    labelledBy.id = 'icon-button-name';
    labelledBy.textContent = 'Labelled action';
    document.body.append(labelledBy);

    const cases = [
      [{ 'aria-label': 'ARIA action' }, 'ARIA action'],
      [{ 'aria-labelledby': 'icon-button-name' }, 'Labelled action'],
      [{ title: 'Title action' }, 'Title action'],
      [{ tooltip: 'Tooltip action' }, 'Tooltip action'],
    ] as const;
    for (const [props, name] of cases) {
      const { unmount } = render(Button, { props: { size: 'icon', ...props } });
      expect(screen.getByRole('button', { name })).toBeTruthy();
      unmount();
    }
  });

  it('publishes complete host-independent catalog metadata', () => {
    expect(buttonMetadata.characterizationTest).toBe('src/lib/components/ui/button/button.test.ts');
    const states = new Set(buttonFixtures.flatMap((fixture) => fixture.states));
    expect(states).toEqual(
      new Set([
        'emphasis-ladder',
        'size-ladder',
        'guidance',
        'default',
        'primary',
        'secondary',
        'ghost',
        'outline',
        'destructive',
        'active',
        'keyboard-focus',
        'disabled',
        'loading',
        'loading-variants',
        'icon-only',
        'icon-weight',
        'action-feedback',
        'long-label',
        'light',
        'dark',
        'compact',
        'reduced-motion',
      ]),
    );
  });
});
