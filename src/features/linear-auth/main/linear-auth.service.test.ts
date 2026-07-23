import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonRpcError } from '../../backend/main/json-rpc-errors';

// Mock the daemon JSON-RPC client so the service's live `linear.*` calls are
// observable and controllable without a real socket.
const request = vi.fn();
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request }),
}));

import { LinearAuthService, linearAuthService } from './linear-auth.service';

/** Build a daemon "method not found" (`-32601`) error. */
const methodNotFound = () => new JsonRpcError({ code: -32601, message: 'Method not found' });

// Wave 4e wires the service to the daemon `linear.*` namespace (PROTOCOL §5.28):
// `linear.authStatus` maps to the FE status shape, `linear.listIssues` /
// `linear.searchIssues` return the flattened `LinearIssueResult[]` verbatim, and
// not-configured / un-wired (`-32601`) responses degrade gracefully.
describe('LinearAuthService (live daemon linear.*)', () => {
  let service: LinearAuthService;

  beforeEach(() => {
    request.mockReset();
    service = new LinearAuthService();
  });

  it('getLinearStatus maps linear.authStatus and never carries the key', async () => {
    request.mockResolvedValueOnce({ authenticated: true, login: 'Ada Lovelace', scopes: [] });
    expect(await service.getLinearStatus()).toEqual({ isConfigured: true, oauthUrl: '' });
    expect(request).toHaveBeenCalledWith('linear.authStatus');
  });

  it('getLinearStatus caches and forceRefresh bypasses the cache', async () => {
    request
      .mockResolvedValueOnce({ authenticated: true, scopes: [] })
      .mockResolvedValueOnce({ authenticated: false, scopes: [] });

    expect((await service.getLinearStatus()).isConfigured).toBe(true);
    // cached: no second daemon call
    expect((await service.getLinearStatus()).isConfigured).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);

    // forceRefresh re-reads from the daemon
    expect((await service.getLinearStatus(true)).isConfigured).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('getLinearStatus degrades to not-connected on -32601 and on errors', async () => {
    request.mockRejectedValueOnce(methodNotFound());
    expect(await service.getLinearStatus()).toEqual({ isConfigured: false, oauthUrl: '' });

    request.mockRejectedValueOnce(new Error('boom'));
    expect(await service.getLinearStatus(true)).toEqual({ isConfigured: false, oauthUrl: '' });
  });

  it('isAuthenticated reflects the daemon status', async () => {
    request.mockResolvedValueOnce({ authenticated: true, scopes: [] });
    expect(await service.isAuthenticated()).toBe(true);

    request.mockResolvedValueOnce({ authenticated: false, scopes: [] });
    expect(await service.isAuthenticated()).toBe(true); // cached from first call
  });

  it('checkAuthComplete forces a fresh status read', async () => {
    request.mockResolvedValueOnce({ authenticated: true, scopes: [] });
    expect(await service.checkAuthComplete()).toBe(true);
    expect(request).toHaveBeenCalledWith('linear.authStatus');
  });

  it('getAuthState maps status and never requires daemon auth', async () => {
    request.mockResolvedValueOnce({ authenticated: true, scopes: [] });
    expect(await service.getAuthState(true)).toEqual({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      oauthUrl: '',
    });
  });

  it('startAuth reports already-authenticated when the key is configured', async () => {
    // linear.startAuth is not a v1 wire method → -32601 → fall back to authStatus
    request.mockRejectedValueOnce(methodNotFound());
    request.mockResolvedValueOnce({ authenticated: true, scopes: [] });

    const result = await service.startAuth();
    expect(result).toEqual({ success: true, alreadyAuthenticated: true });
    expect(request).toHaveBeenNthCalledWith(1, 'linear.startAuth');
    expect(request).toHaveBeenNthCalledWith(2, 'linear.authStatus');
  });

  it('startAuth returns an actionable error when the key is missing', async () => {
    request.mockRejectedValueOnce(methodNotFound());
    request.mockResolvedValueOnce({ authenticated: false, scopes: [] });

    const result = await service.startAuth();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/LINEAR_API_KEY/);
  });

  it('startAuth honors a real linear.startAuth result when present', async () => {
    request.mockResolvedValueOnce({ success: true, oauthUrl: 'https://linear/auth' });
    const result = await service.startAuth();
    expect(result).toEqual({ success: true, oauthUrl: 'https://linear/auth' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('revokeAccess attempts linear.revoke, clears the cache, and reports success', async () => {
    // seed a cached "configured" status
    request.mockResolvedValueOnce({ authenticated: true, scopes: [] });
    expect((await service.getLinearStatus()).isConfigured).toBe(true);

    request.mockRejectedValueOnce(methodNotFound()); // revoke not a v1 wire method
    expect(await service.revokeAccess()).toBe(true);
    expect(request).toHaveBeenCalledWith('linear.revoke');

    // cache was cleared → next status read hits the daemon again
    request.mockResolvedValueOnce({ authenticated: false, scopes: [] });
    expect((await service.getLinearStatus()).isConfigured).toBe(false);
  });

  it('fetchMyIssues returns the daemon { issues, nextToken } envelope for the given filter', async () => {
    const issues = [{ id: 'a1', identifier: 'ENG-123', title: 'Fix the widget', state: 'Todo' }];
    request.mockResolvedValueOnce({ issues, nextToken: 'eyJjIjoiY3Vyc29yLTIifQ' });

    expect(await service.fetchMyIssues('created')).toEqual({
      issues,
      nextToken: 'eyJjIjoiY3Vyc29yLTIifQ',
    });
    expect(request).toHaveBeenCalledWith('linear.listIssues', { filter: 'created' });
  });

  it('fetchMyIssues forwards limit/nextToken cursor params (§5.28)', async () => {
    request.mockResolvedValueOnce({ issues: [], nextToken: null });

    await service.fetchMyIssues('assigned', { limit: 50, nextToken: 'cursor-1' });

    expect(request).toHaveBeenCalledWith('linear.listIssues', {
      filter: 'assigned',
      limit: 50,
      nextToken: 'cursor-1',
    });
  });

  it('fetchMyIssues defaults to the assigned filter and degrades to an empty page on error', async () => {
    request.mockResolvedValueOnce({ issues: [], nextToken: null });
    expect(await service.fetchMyIssues()).toEqual({ issues: [], nextToken: null });
    expect(request).toHaveBeenCalledWith('linear.listIssues', { filter: 'assigned' });

    request.mockRejectedValueOnce(methodNotFound());
    expect(await service.fetchMyIssues('all')).toEqual({ issues: [], nextToken: null });

    request.mockRejectedValueOnce(new Error('boom'));
    expect(await service.fetchMyIssues('team')).toEqual({ issues: [], nextToken: null });
  });

  it('searchIssues forwards the query and degrades to an empty page for empty/errored searches', async () => {
    const issues = [{ id: 'b2', identifier: 'ENG-9', title: 'Search hit' }];
    request.mockResolvedValueOnce({ issues, nextToken: null });
    expect(await service.searchIssues('widget')).toEqual({ issues, nextToken: null });
    expect(request).toHaveBeenCalledWith('linear.searchIssues', { query: 'widget' });

    // empty query short-circuits without a daemon call
    request.mockReset();
    expect(await service.searchIssues('')).toEqual({ issues: [], nextToken: null });
    expect(request).not.toHaveBeenCalled();

    request.mockRejectedValueOnce(new Error('boom'));
    expect(await service.searchIssues('anything')).toEqual({ issues: [], nextToken: null });
  });

  it('searchIssues forwards limit/nextToken cursor params and returns the next cursor (§5.28)', async () => {
    request.mockResolvedValueOnce({ issues: [], nextToken: 'cursor-2' });

    const page = await service.searchIssues('widget', { limit: 20, nextToken: 'cursor-1' });

    expect(request).toHaveBeenCalledWith('linear.searchIssues', {
      query: 'widget',
      limit: 20,
      nextToken: 'cursor-1',
    });
    expect(page.nextToken).toBe('cursor-2');
  });

  it('exposes a shared singleton instance', async () => {
    expect(linearAuthService).toBeInstanceOf(LinearAuthService);
    request.mockResolvedValueOnce({ authenticated: false, scopes: [] });
    expect(await linearAuthService.getAuthState(true)).toEqual({
      isAuthenticated: false,
      requiresDaemonAuth: false,
      oauthUrl: '',
    });
  });
});
