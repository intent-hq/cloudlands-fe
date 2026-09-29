import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const effects = vi.hoisted(() => ({ started: [] as string[], cancelled: [] as string[] }));
vi.mock('./slices/host-requirements/sagas/host-requirements-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    hostRequirementsSaga: function* () {
      effects.started.push('requirements');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('requirements');
      }
    },
  };
});
vi.mock('./slices/hardware-console/sagas/hardware-console-device-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    hardwareConsoleDeviceSaga: function* () {
      effects.started.push('hardware');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('hardware');
      }
    },
  };
});
vi.mock('./slices/hardware-console/sagas/encoder-preference-saga', () => ({
  encoderPreferenceSaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/action-key-saga', () => ({
  actionKeySaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/key-pin-persistence-saga', () => ({
  keyPinPersistenceSaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/prompt-picker-saga', () => ({
  promptPickerSaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/voice-transcription-saga', () => ({
  voiceTranscriptionSaga: function* () {},
}));
vi.mock('./slices/voice-settings/sagas/voice-settings-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    voiceSettingsSaga: function* () {
      effects.started.push('voice');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('voice');
      }
    },
  };
});
vi.mock('./slices/user-preferences/sagas/notification-settings-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    notificationSettingsSaga: function* () {
      effects.started.push('notifications');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('notifications');
      }
    },
  };
});
vi.mock('./slices/github-auth/sagas/github-auth-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    githubAuthSaga: function* () {
      effects.started.push('account');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('account');
      }
    },
  };
});

vi.mock('./slices/gitlab-auth/sagas/gitlab-auth-saga', () => ({ gitlabAuthSaga: function* () {} }));

import { withLegacyPrincipal } from '../../test/fixtures/principal-state';
import { hostOwnerServicesSaga } from './slices/principal/sagas/host-owner-services-saga';
import { initializeGitHubAuth } from './slices/github-auth/github-auth-slice';
import { initializeGitLabAuth } from './slices/gitlab-auth/gitlab-auth-slice';
import { hostRequirementsReset } from './slices/host-requirements/host-requirements-slice';

describe('host-owned settings lifecycle', () => {
  it('waits for an owner, cancels on demotion/reconnect, and never boots member account readers', async () => {
    effects.started.length = 0;
    effects.cancelled.length = 0;
    let state = {} as ReturnType<typeof withLegacyPrincipal>;
    const listeners = new Set<() => void>();
    const channel = stdChannel();
    const dispatch = vi.fn((action) => channel.put(action));
    const reduxStore = {
      getState: () => state,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const task = runSaga(
      { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
      hostOwnerServicesSaga,
    );
    const admit = (role: 'owner' | 'member' | 'guest', backend = 'host-A') => {
      state = withLegacyPrincipal({ connections: { windowBackendId: backend } });
      state.principal.snapshot!.capabilities.hostMembership = true;
      state.principal.snapshot!.principal.hostRole = role;
      for (const fn of listeners) fn();
    };
    try {
      admit('member');
      admit('guest');
      expect(effects.started).toEqual([]);
      admit('owner');
      expect(effects.started).toEqual([
        'requirements',
        'hardware',
        'voice',
        'notifications',
        'account',
      ]);
      expect(dispatch).toHaveBeenCalledWith(initializeGitHubAuth());
      expect(dispatch).toHaveBeenCalledWith(initializeGitLabAuth(undefined, 'status-only'));
      admit('member');
      expect(effects.cancelled).toEqual(effects.started);
      expect(dispatch).toHaveBeenLastCalledWith(hostRequirementsReset());
      admit('owner', 'host-B');
      expect(effects.started).toHaveLength(10);
      state = { ...state, principal: { ...state.principal, status: 'loading' } };
      for (const fn of listeners) fn();
      expect(effects.cancelled).toHaveLength(10);
    } finally {
      task.cancel();
      await task.toPromise();
    }
    expect(listeners.size).toBe(0);
  });
});
