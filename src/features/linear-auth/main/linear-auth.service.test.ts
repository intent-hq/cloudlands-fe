import { describe, expect, it } from 'vitest';

import { LinearAuthService, linearAuthService } from './linear-auth.service';

// The Linear integration is mocked to a no-op (Wave 4a): the UI still renders
// but the service makes ZERO real calls. These tests assert the inert
// not-connected state and empty issue lists end to end.
describe('LinearAuthService (inert no-op mock)', () => {
  const service = new LinearAuthService();

  it('getLinearStatus returns a fixed not-connected status', async () => {
    expect(await service.getLinearStatus()).toEqual({
      isConfigured: false,
      oauthUrl: '',
    });
    // forceRefresh is ignored and must not change the inert result
    expect(await service.getLinearStatus(true)).toEqual({
      isConfigured: false,
      oauthUrl: '',
    });
  });

  it('isAuthenticated reports not connected', async () => {
    expect(await service.isAuthenticated()).toBe(false);
  });

  it('checkAuthComplete reports not connected', async () => {
    expect(await service.checkAuthComplete()).toBe(false);
  });

  it('getAuthState returns inert not-connected with no user', async () => {
    expect(await service.getAuthState()).toEqual({
      isAuthenticated: false,
      requiresAugmentAuth: false,
    });
    expect(await service.getAuthState(true)).toEqual({
      isAuthenticated: false,
      requiresAugmentAuth: false,
    });
  });

  it('startAuth is an inert no-op that does not connect', async () => {
    const result = await service.startAuth();
    expect(result.success).toBe(false);
    expect(result.oauthUrl).toBeUndefined();
    expect(result.alreadyAuthenticated).toBeUndefined();
    expect(typeof result.error).toBe('string');
  });

  it('revokeAccess is a no-op returning success', async () => {
    expect(await service.revokeAccess()).toBe(true);
  });

  it('fetchMyIssues returns an empty list for every filter', async () => {
    const filters = ['assigned', 'created', 'subscribed', 'team', 'all'] as const;
    for (const filter of filters) {
      expect(await service.fetchMyIssues(filter)).toEqual([]);
    }
    // default filter
    expect(await service.fetchMyIssues()).toEqual([]);
  });

  it('searchIssues returns an empty list', async () => {
    expect(await service.searchIssues('anything')).toEqual([]);
    expect(await service.searchIssues('')).toEqual([]);
  });

  it('exposes a shared singleton instance with the same inert behavior', async () => {
    expect(linearAuthService).toBeInstanceOf(LinearAuthService);
    expect(await linearAuthService.getAuthState()).toEqual({
      isAuthenticated: false,
      requiresAugmentAuth: false,
    });
  });
});
