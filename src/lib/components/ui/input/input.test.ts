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

  it('uses contrast-validated invalid borders without an outer ring', () => {
    const text = render(InputHarness);
    const textInput = text.getByRole('textbox', { name: 'Profile name' });
    const file = render(Input, {
      props: { type: 'file', 'aria-label': 'Profile file', 'aria-invalid': 'true' },
    });
    const fileInput = file.container.querySelector('input[type="file"]');
    for (const control of [textInput, fileInput]) {
      expect(control?.className.split(/\s+/)).toContain('aria-invalid:border-danger');
      expect(control?.className.split(/\s+/)).not.toContain('aria-invalid:ring-1');
    }
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('publishes its resolved size without consuming the native file-input size', () => {
    const compact = render(Input, {
      props: { 'aria-label': 'Project name', size: 'compact' },
    });
    expect(compact.getByRole('textbox', { name: 'Project name' }).dataset.size).toBe('compact');
    compact.unmount();

    const file = render(Input, {
      props: { type: 'file', 'aria-label': 'Project file', size: 24 },
    }).container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.size).toBe(24);
    expect(file.dataset.size).toBe('default');
  });

  it('connects animated helper and error messages to the control', () => {
    const { getByRole } = render(Input, {
      props: { id: 'project-name', 'aria-label': 'Project name', error: 'A name is required' },
    });
    const input = getByRole('textbox', { name: 'Project name' });
    const alert = getByRole('alert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
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
    expect(classes).toContain('focus-visible:!shadow-none');
  });
});

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('global focus rules (composite repo input regression)', () => {
  const appCss = readSource('../../../../app.css');
  const gitHubRepoTabSource = readSource(
    '../../../../features/onboarding/messages/GitHubRepoTab.svelte',
  );

  // Under Tailwind v4, unlayered author CSS beats every layered utility, which
  // silently defeated `noFocusStyle` (`focus-visible:outline-none`) everywhere.
  // The global keyboard-focus fallback must live in `@layer base` so utilities
  // can override it, and composite wrappers must carry their own indicator.
  it('keeps the global focus-visible fallback inside @layer base', () => {
    const layerBase = /@layer base \{[\s\S]*?^\}/m.exec(appCss)?.[0] ?? '';
    expect(layerBase).toContain(':focus:not(:focus-visible)');
    expect(layerBase).toContain(':focus-visible {');
    const outsideLayer = appCss.replace(layerBase, '');
    expect(outsideLayer).not.toMatch(/^:focus-visible\s*\{/m);
    expect(outsideLayer).not.toMatch(/^:focus:not\(:focus-visible\)/m);
  });

  it('gives the onboarding GitHub repo wrapper a focus-within indicator', () => {
    expect(gitHubRepoTabSource).toContain('focus-within:border-ring');
  });
});
