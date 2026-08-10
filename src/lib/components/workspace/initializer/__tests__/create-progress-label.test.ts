/**
 * Label mapper for the Create-button progress UI: daemon phase → localized
 * stage label, submodule "(N/M)" counter extraction, and locale-aware percent
 * formatting.
 */
import { describe, expect, it } from 'vitest';
import { createProgressLabel, formatCreateProgressPercent } from '../create-progress-label';
import type { WorkspaceCreateProgressEntry } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-types';

function entry(phase: string, message?: string): WorkspaceCreateProgressEntry {
  return { phase, percent: 0, message, sawFrame: true, done: false };
}

describe('createProgressLabel', () => {
  it.each([
    ['starting', 'Preparing workspace…'],
    ['cache', 'Preparing repository cache…'],
    ['counting', 'Counting objects…'],
    ['compressing', 'Compressing objects…'],
    ['receiving', 'Cloning repository…'],
    ['resolving', 'Resolving deltas…'],
    ['checkout', 'Checking out files…'],
    ['cow-copy', 'Copying repository…'],
    ['worktree', 'Creating worktree…'],
    ['finalizing', 'Finalizing workspace…'],
    ['complete', 'Almost ready…'],
  ])('maps daemon phase %s', (phase, label) => {
    expect(createProgressLabel(entry(phase))).toBe(label);
  });

  it('falls back to the generic preparing label for unknown phases', () => {
    expect(createProgressLabel(entry('future-phase'))).toBe('Preparing workspace…');
  });

  it('renders the submodule (N/M) counter parsed from the daemon message', () => {
    expect(createProgressLabel(entry('submodules', 'Cloning submodules (2/3)'))).toBe(
      'Cloning submodules (2/3)…',
    );
  });

  it('renders the counterless submodule label when the message has no (N/M)', () => {
    expect(createProgressLabel(entry('submodules'))).toBe('Cloning submodules…');
    expect(createProgressLabel(entry('submodules', 'Fetching submodules'))).toBe(
      'Cloning submodules…',
    );
  });
});

describe('formatCreateProgressPercent', () => {
  it('formats a 0–100 value as a locale percent', () => {
    expect(formatCreateProgressPercent(45)).toBe('45%');
    expect(formatCreateProgressPercent(0)).toBe('0%');
    expect(formatCreateProgressPercent(100)).toBe('100%');
  });

  it('clamps out-of-range values', () => {
    expect(formatCreateProgressPercent(-5)).toBe('0%');
    expect(formatCreateProgressPercent(140)).toBe('100%');
  });
});
