import { describe, expect, it } from 'vitest';
import type { IntentApp } from '../../../shared/intent-apps/intent-apps-types';
import { decideAfterSessionLoss, isSameGrant } from './session-recovery';

const session = { bundleHash: 'sha256:a', level: 2 as const, features: ['models', 'notifications'] };

function app(overrides: Partial<IntentApp['approval']> & { bundleHash?: string } = {}): IntentApp {
  const { bundleHash = 'sha256:a', ...approval } = overrides;
  return {
    id: 'pomodoro-timer',
    name: 'Pomodoro Timer',
    version: '1.0.0',
    description: null,
    icon: null,
    entry: 'index.html',
    bundleHash,
    fileCount: 2,
    sizeBytes: 100,
    permissions: { level: 2, features: ['models', 'notifications'] },
    window: {
      width: 960,
      height: 640,
      minWidth: null,
      minHeight: null,
      resizable: true,
      alwaysOnTop: false,
    },
    approval: {
      status: 'approved',
      level: 2,
      features: ['notifications', 'models'],
      bundleHash: 'sha256:a',
      approvedAt: '2026-11-26T12:00:00.000Z',
      ...approval,
    },
    source: null,
    installedAt: '2026-11-26T11:59:00.000Z',
    updatedAt: '2026-11-26T11:59:00.000Z',
    open: false,
  };
}

describe('session recovery after a lost app connection', () => {
  it('reopens when the grant is unchanged (a daemon restart or a dropped admin connection)', () => {
    expect(decideAfterSessionLoss(session, app())).toEqual({ kind: 'reopen' });
  });

  it('ends with the contract reasons', () => {
    expect(decideAfterSessionLoss(session, null)).toEqual({
      kind: 'end',
      reason: 'uninstalled',
      reopen: false,
    });
    expect(decideAfterSessionLoss(session, app({ status: 'revoked' }))).toEqual({
      kind: 'end',
      reason: 'revoked',
      reopen: false,
    });
    // A replace install with a new hash resets the approval to pending.
    expect(
      decideAfterSessionLoss(session, app({ bundleHash: 'sha256:b', status: 'pending' })),
    ).toEqual({ kind: 'end', reason: 'updated', reopen: false });
    // A replace install that kept the approval of another hash is still a new bundle.
    expect(
      decideAfterSessionLoss(session, {
        ...app({ bundleHash: 'sha256:b' }),
        approval: { ...app().approval, bundleHash: 'sha256:b' },
      }),
    ).toEqual({ kind: 'end', reason: 'updated', reopen: false });
  });

  it('reopens with the new grant when only the features changed', () => {
    expect(decideAfterSessionLoss(session, app({ features: ['models'] }))).toEqual({
      kind: 'end',
      reason: 'updated',
      reopen: true,
    });
  });

  it('compares grants as sets', () => {
    expect(isSameGrant(session, { ...session, features: ['notifications', 'models'] })).toBe(true);
    expect(isSameGrant(session, { ...session, bundleHash: 'sha256:b' })).toBe(false);
    expect(isSameGrant(session, { ...session, features: ['models'] })).toBe(false);
  });
});
