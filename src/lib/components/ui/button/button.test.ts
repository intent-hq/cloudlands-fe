/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';
import Button from './button.svelte';
import { buttonFixtures } from './button.fixtures';
import { buttonMetadata } from './button.meta';
import { buttonVariants, type ButtonSize } from './button.variants';

describe('Button', () => {
  it('owns one variant recipe and maps every size to 28, 32, or 36px control tokens', () => {
    const sources = ['button.svelte', 'index.ts', 'button.variants.ts'].map((file) =>
      readFileSync(new URL(file, import.meta.url), 'utf8'),
    );
    const source = sources.join('\n');
    expect(source.match(/\btv\(/g)).toHaveLength(1);
    expect(source.match(/export type ButtonVariant\b/g)).toHaveLength(1);
    expect(source.match(/export type ButtonSize\b/g)).toHaveLength(1);
    expect(source.match(/export type ButtonProps\b/g)).toHaveLength(1);
    expect(buttonVariants({ size: 'icon-xs' })).toContain('size-7');
    expect(buttonVariants({ size: 'xs' })).toContain('h-7');
    expect(buttonVariants({ size: 'sm' })).toContain('h-7');
    expect(buttonVariants({ size: 'default' })).toContain('h-8');
    expect(buttonVariants({ size: 'lg' })).toContain('h-9');
    expect(buttonVariants()).toContain('focus-visible:ring-2');
    expect(buttonVariants()).toContain('focus-visible:border-ring');
    expect(buttonVariants()).toContain('type-body');
    expect(buttonVariants()).not.toMatch(/\btext-(?:xs|sm|base)\b/);
  });

  it('uses semantic editorial variants and keeps neumorphic as an outline alias', () => {
    const defaultButton = buttonVariants({ variant: 'default' });
    expect(defaultButton).toContain('border-border');
    expect(defaultButton).toContain('bg-card');
    expect(defaultButton).toContain('hover:border-input');
    expect(defaultButton).not.toContain('hover:border-primary');
    expect(defaultButton).not.toContain('bg-primary ');
    const outlineButton = buttonVariants({ variant: 'outline' });
    expect(outlineButton).toContain('border-border');
    expect(outlineButton).toContain('bg-transparent');
    expect(outlineButton).toContain('shadow-none');
    const secondaryButton = buttonVariants({ variant: 'secondary' });
    expect(secondaryButton).toContain('border-border');
    expect(secondaryButton).not.toContain('hover:border-primary');
    const destructiveButton = buttonVariants({ variant: 'destructive' });
    expect(destructiveButton).toContain('bg-card');
    expect(destructiveButton).toContain('hover:bg-danger');
    expect(destructiveButton.split(/\s+/)).not.toContain('bg-danger');
    const compatibility = buttonVariants({ variant: 'neumorphic' });
    expect(compatibility).toContain('border-border');
    expect(compatibility).toContain('bg-card');
    expect(compatibility).not.toMatch(/gradient|rounded-2xl|shadow-md/);
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

  it('disables an open tooltip reactively without remounting its button', async () => {
    const view = render(Button, {
      props: { tooltip: 'Stable action help', tooltipDelayDuration: 0 },
    });
    const button = screen.getByRole('button', { name: 'Stable action help' });
    button.focus();
    await fireEvent.focus(button);
    await screen.findByRole('tooltip', { name: 'Stable action help', hidden: true });

    await view.rerender({
      tooltip: 'Stable action help',
      tooltipDelayDuration: 0,
      tooltipDisabled: true,
    });
    await waitFor(() => expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull());
    expect(screen.getByRole('button', { name: 'Stable action help' })).toBe(button);

    await view.rerender({
      tooltip: 'Stable action help',
      tooltipDelayDuration: 0,
      tooltipDisabled: false,
    });
    button.blur();
    button.focus();
    await fireEvent.focus(button);
    await screen.findByRole('tooltip', { name: 'Stable action help', hidden: true });
  });

  it.each(['icon', 'icon-sm', 'icon-xs', 'icon-lg'] as const)(
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
    const canonicalSizes = new Set(['icon', 'icon-sm', 'icon-xs', 'icon-lg']);
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
        'default',
        'secondary',
        'outline',
        'destructive',
        'keyboard-focus',
        'disabled',
        'loading',
        'icon-only',
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
