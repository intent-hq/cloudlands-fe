// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseUiComponentMetadata } from '../component-metadata';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import Input from './input.svelte';
import InputHarness from './input.test-harness.svelte';
import { inputFixtures } from './input.fixtures';
import { inputMetadata } from './input.meta';

afterEach(cleanup);

describe('Input', () => {
  it('binds values and preserves labels, descriptions, and errors', async () => {
    const { getByRole, getByTestId } = render(InputHarness);
    const input = getByRole('textbox', { name: 'Profile name' });
    expect(input.getAttribute('aria-describedby')).toBe(
      'profile-name-description profile-name-error',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await fireEvent.input(input, { target: { value: 'Operate' } });
    expect(getByTestId('input-value').textContent).toBe('Operate');
  });

  it('preserves imperative focus, selection, disabled, and read-only behavior', () => {
    const { getByRole } = render(Input, {
      props: { 'aria-label': 'Workspace', value: 'Cloudlands', readonly: true },
    });
    const input = getByRole('textbox', { name: 'Workspace' }) as HTMLInputElement;
    input.focus();
    input.select();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.readOnly).toBe(true);
  });

  it('uses contrast-validated invalid borders and rings for text and file inputs', () => {
    const text = render(InputHarness);
    const textInput = text.getByRole('textbox', { name: 'Profile name' });
    const file = render(Input, {
      props: { type: 'file', 'aria-label': 'Profile file', 'aria-invalid': 'true' },
    });
    const fileInput = file.container.querySelector('input[type="file"]');
    for (const control of [textInput, fileInput]) {
      expect(control?.className.split(/\s+/)).toContain('aria-invalid:border-danger');
      expect(control?.className.split(/\s+/)).toContain('aria-invalid:ring-1');
      expect(control?.className.split(/\s+/)).toContain('aria-invalid:ring-danger/25');
    }
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses a flat neutral field treatment and canonical Body typography', () => {
    const { getByRole } = render(Input, {
      props: { 'aria-label': 'Project name', placeholder: 'Enter a project name' },
    });
    const classes = getByRole('textbox', { name: 'Project name' }).className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'type-body',
        'border-border',
        'bg-card',
        'shadow-none',
        'hover:border-input',
        'focus-visible:border-ring',
        'focus-visible:outline-none',
        'focus-visible:ring-0',
      ]),
    );
    const fileInput = render(Input, {
      props: { type: 'file', 'aria-label': 'Project file' },
    }).container.querySelector('input[type="file"]');
    expect(fileInput?.className.split(/\s+/)).toContain('shadow-none');
    expect(fileInput?.className.split(/\s+/)).toContain('focus-visible:ring-0');
    expect(fileInput?.className.split(/\s+/)).not.toContain('focus-visible:ring-2');
    expect(fileInput?.className.split(/\s+/)).not.toContain('focus-visible:ring-ring/40');
    expect(classes).not.toContain('shadow-(--elevation-raised)');
    expect(fileInput?.className.split(/\s+/)).not.toContain('shadow-(--elevation-raised)');
    expect(classes).not.toContain('border-input');
    expect(classes).not.toContain('text-sm');
    expect(classes).not.toContain('focus-visible:ring-2');
    expect(classes).not.toContain('focus-visible:ring-ring/40');
  });

  it('publishes compact, theme, validation, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(inputMetadata)).not.toThrow();
    expect(inputFixtures[0].states).toEqual(
      expect.arrayContaining(['compact-28', 'medium-32', 'large-36', 'invalid', 'long-content']),
    );
  });

  it('lets noFocusStyle opt out of the focus ring via utilities', () => {
    const { getByRole } = render(Input, {
      props: { 'aria-label': 'Composite field', noFocusStyle: true },
    });
    const classes = getByRole('textbox', { name: 'Composite field' }).className.split(/\s+/);
    expect(classes).toContain('focus-visible:outline-none');
    expect(classes).toContain('focus-visible:ring-0');
    expect(classes).not.toContain('focus-visible:border-ring');
  });
});

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('global focus rules (composite repo input regression)', () => {
  const appCss = readSource('../../../../app.css');

  // Under Tailwind v4, unlayered author CSS beats every layered utility, which
  // silently defeated `noFocusStyle` (`focus-visible:outline-none`) everywhere.
  // The global keyboard-focus fallback must live in `@layer base` so utilities
  // can override it.
  it('keeps the global focus-visible fallback inside @layer base', () => {
    const layerBase = /@layer base \{[\s\S]*?^\}/m.exec(appCss)?.[0] ?? '';
    expect(layerBase).toContain(':focus:not(:focus-visible)');
    expect(layerBase).toContain(':focus-visible {');
    const outsideLayer = appCss.replace(layerBase, '');
    expect(outsideLayer).not.toMatch(/^:focus-visible\s*\{/m);
    expect(outsideLayer).not.toMatch(/^:focus:not\(:focus-visible\)/m);
  });
});
