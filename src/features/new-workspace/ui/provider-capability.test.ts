import { describe, expect, it } from 'vitest';

import { createInitialControllerState } from '../controller';
import { coordinatorStateFor, providerCapabilityStatus } from './types';

describe('provider capability presentation', () => {
  it('shows blocking Coordinator guidance when the loaded catalog has no enabled provider', () => {
    const status = providerCapabilityStatus({
      catalogLoaded: true,
      hasEnabledProvider: false,
      hasCheckedOnce: false,
      hasAvailableProvider: false,
    });
    const controller = createInitialControllerState(1);
    controller.phase = 'editing';
    if (status !== null) controller.capabilities.provider = status;

    expect(status).toBe('missing');
    expect(coordinatorStateFor(controller)).toBe('connect-provider');
  });

  it('keeps checking until an enabled provider sweep has settled', () => {
    expect(
      providerCapabilityStatus({
        catalogLoaded: true,
        hasEnabledProvider: true,
        hasCheckedOnce: false,
        hasAvailableProvider: false,
      }),
    ).toBeNull();
  });
});
