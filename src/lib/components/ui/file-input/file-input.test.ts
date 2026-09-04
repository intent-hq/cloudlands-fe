// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import FileInput from './file-input.svelte';
import FileInputHarness from './FileInputHarness.svelte';
import { fileInputFixtures } from './file-input.fixtures';
import { fileInputMetadata } from './file-input.meta';

function themeColor(css: string, mode: 'light' | 'dark', role: string): string {
  const match = css.match(new RegExp(`--theme-${mode}-${role}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing ${mode} ${role} token`);
  return match[1].trim();
}

function hslToRgb(value: string): [number, number, number] {
  const [hue, saturation, lightness] = value.match(/[\d.]+/g)?.map(Number) ?? [];
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const channels =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return channels.map((channel) => Math.round((channel + offset) * 255)) as [
    number,
    number,
    number,
  ];
}

function contrastRatio(first: string, second: string): number {
  const luminance = (value: string) => {
    const channels = hslToRgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('FileInput', () => {
  it('opens its native input from a keyboard-focusable action', async () => {
    const { container, getByRole } = render(FileInput, {
      props: { id: 'theme-file', label: 'Choose theme file', accept: '.json' },
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const open = vi.spyOn(input, 'click');
    const button = getByRole('button', { name: 'Choose theme file' });
    button.focus();
    await fireEvent.keyDown(button, { key: 'Enter' });
    await fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(open).toHaveBeenCalled();
    expect(input.accept).toBe('.json');
  });

  it('reports selected files and adjacent invalid feedback', async () => {
    const onFilesChange = vi.fn();
    const { container, getByRole } = render(FileInput, {
      props: {
        id: 'rules-file',
        label: 'Choose rules file',
        error: 'The selected file is invalid.',
        invalid: true,
        onFilesChange,
      },
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}'], 'workspace-rules.json', { type: 'application/json' });
    await fireEvent.change(input, { target: { files: [file] } });
    expect(onFilesChange).toHaveBeenCalled();
    expect(getByRole('status').textContent).toContain('workspace-rules.json');
    expect(getByRole('alert').textContent).toContain('invalid');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(getByRole('alert').className).toContain('text-danger');
  });

  it('renders invalid text and control boundaries with AA semantic contrast', () => {
    const { container, getByRole } = render(FileInput, {
      props: {
        id: 'contrast-file',
        label: 'Choose valid file',
        invalid: true,
        error: 'The selected file is invalid.',
      },
    });
    const surface = container.querySelector('[data-slot="file-input-surface"]');
    expect(surface?.className.split(/\s+/)).toContain('border-danger');
    expect(getByRole('button').className.split(/\s+/)).toContain('aria-invalid:border-danger');
    expect(getByRole('alert').className.split(/\s+/)).toContain('text-danger');

    const css = readFileSync(resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    for (const mode of ['light', 'dark'] as const) {
      const invalidForeground = themeColor(css, mode, 'danger');
      for (const surfaceRole of ['background', 'card'] as const) {
        expect(
          contrastRatio(invalidForeground, themeColor(css, mode, surfaceRole)),
          `${mode} invalid foreground on ${surfaceRole}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('forwards form attributes and reports multiple filenames', async () => {
    const { container, getByRole } = render(FileInputHarness);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const liveStatus = container.querySelector('[data-slot="file-input"] [role="status"]');
    expect(input.accept).toBe('.json,application/json');
    expect(input.multiple).toBe(true);
    expect(input.required).toBe(true);
    expect(input.name).toBe('themeFiles');
    const files = [
      new File(['{}'], 'light.json', { type: 'application/json' }),
      new File(['{}'], 'dark.json', { type: 'application/json' }),
    ];
    await fireEvent.change(input, { target: { files } });
    expect(liveStatus?.textContent).toContain('light.json, dark.json');
    expect(getByRole('status', { name: 'Bound filenames' }).textContent).toContain(
      'light.json, dark.json',
    );
  });

  it('synchronizes its binding and live filename after native and explicit parent resets', async () => {
    const { container, getByRole } = render(FileInputHarness);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const liveStatus = container.querySelector('[data-slot="file-input"] [role="status"]');
    const file = new File(['{}'], 'first.json', { type: 'application/json' });
    await fireEvent.change(input, { target: { files: [file] } });
    await fireEvent.click(getByRole('button', { name: 'Reset form' }));
    await waitFor(() => expect(liveStatus?.textContent).toBe('No file selected'));
    expect(getByRole('status', { name: 'Bound filenames' }).textContent).toBe('No bound files');

    await fireEvent.change(input, { target: { files: [file] } });
    await fireEvent.click(getByRole('button', { name: 'Reset from parent' }));
    await waitFor(() => expect(liveStatus?.textContent).toBe('No file selected'));
    expect(getByRole('status', { name: 'Bound filenames' }).textContent).toBe('No bound files');
  });

  it('disables activation while busy', () => {
    const { getByRole } = render(FileInput, {
      props: { id: 'busy-file', label: 'Importing theme', busy: true },
    });
    const button = getByRole('button', { name: 'Importing theme' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('uses a lifted semantic picker surface with safe filename truncation', () => {
    const { container, getByRole } = render(FileInput, {
      props: { id: 'long-file', label: 'Choose a file' },
    });
    const surface = container.querySelector('[data-slot="file-input-surface"]');
    expect(surface?.className).toContain('border-border');
    expect(surface?.className).toContain('bg-card');
    expect(surface?.className).toContain('min-h-(--control-height-medium)');
    expect(surface?.className).toContain('rounded-(--radius-medium)');
    expect(surface?.className).toContain('shadow-(--elevation-raised)');
    expect(surface?.className).toContain('hover:border-input');
    expect(getByRole('status').className).toContain('type-body');
    expect(getByRole('status').className).toContain('truncate');
  });

  it('offers a flat picker surface without a decorative perimeter or shadow', () => {
    const { container } = render(FileInput, {
      props: { id: 'flat-file', label: 'Import file', variant: 'flat' },
    });
    const surface = container.querySelector('[data-slot="file-input-surface"]');

    expect(container.querySelector('[data-slot="file-input"]')?.getAttribute('data-variant')).toBe(
      'flat',
    );
    expect(surface?.className).toContain('border-transparent');
    expect(surface?.className).toContain('bg-muted/40');
    expect(surface?.className).toContain('shadow-none');
    expect(surface?.className).toContain('focus-within:border-ring');
    expect(surface?.className).toContain('focus-within:ring-0');
    expect(surface?.className).not.toContain('focus-within:ring-2');
    expect(surface?.className).not.toContain('focus-within:ring-ring/40');
  });

  it('publishes disabled, error, busy, long-content, and focus fixtures', () => {
    expect(() => parseUiComponentMetadata(fileInputMetadata)).not.toThrow();
    expect(fileInputFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'default',
        'disabled',
        'invalid',
        'error',
        'loading',
        'busy',
        'long-content',
        'compact',
        'keyboard-focus',
        'reduced-motion',
        'accept',
        'multiple',
        'multi-filename',
        'form-reset',
        'parent-reset',
        'zoom-200',
        'no-overflow',
      ]),
    );
  });
});
