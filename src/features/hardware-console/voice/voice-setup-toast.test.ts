import { beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateToRouteMock } = vi.hoisted(() => ({
  navigateToRouteMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: navigateToRouteMock,
}));

import { voiceSettingsToastAction } from './voice-setup-toast';

describe('voice setup toast', () => {
  beforeEach(() => {
    navigateToRouteMock.mockClear();
  });

  it('opens the canonical Connections voice settings route', async () => {
    voiceSettingsToastAction().onClick();
    await Promise.resolve();

    expect(navigateToRouteMock).toHaveBeenCalledWith('/settings?tab=connections#voice');
  });
});
