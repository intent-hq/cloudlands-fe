/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import SetupScriptTrigger from './SetupScriptTrigger.svelte';

afterEach(cleanup);

it('labels the current value and opens its dialog', async () => {
  const onOpen = vi.fn();
  render(SetupScriptTrigger, { value: 'pnpm install', onOpen });
  const trigger = screen.getByLabelText('Setup script');
  expect(trigger.textContent).toContain('pnpm install');
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await fireEvent.click(trigger);
  expect(onOpen).toHaveBeenCalledOnce();
});

it('keeps the field label while detecting its value', () => {
  render(SetupScriptTrigger, { value: 'Custom', loading: true, expanded: true, onOpen: () => {} });
  const trigger = screen.getByLabelText('Setup script');
  expect(trigger.querySelector('[data-slot="intent-mark-loader"]')).not.toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});
