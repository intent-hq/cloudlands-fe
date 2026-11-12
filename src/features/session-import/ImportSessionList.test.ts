/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ImportSessionList from './ImportSessionList.svelte';
import type { ImportableSession } from './importable-session';

const session = (
  sessionId: string,
  title: string,
  updatedAt: string | null,
): ImportableSession => ({
  provider: 'claude-code',
  sessionId,
  title,
  cwd: `/repo/${sessionId}`,
  updatedAt,
});

describe('ImportSessionList', () => {
  afterEach(cleanup);

  it('shows an undated session in the daemon order, after dated rows, without a date', () => {
    render(ImportSessionList, {
      props: {
        status: 'ready',
        sessions: [
          session('dated', 'Dated session', '2026-09-01T11:00:00.000Z'),
          session('undated', 'Undated session', null),
        ],
        onselect: () => {},
        onretry: () => {},
      },
    });

    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.textContent ?? '')).toEqual([
      expect.stringContaining('Dated session'),
      expect.stringContaining('Undated session'),
    ]);
    expect(within(rows[0]).getByTestId('import-session-meta').querySelector('time')).not.toBeNull();
    const undatedMeta = within(rows[1]).getByTestId('import-session-meta');
    expect(undatedMeta.querySelector('time')).toBeNull();
    expect(undatedMeta.textContent).toContain('undated');
  });
});
