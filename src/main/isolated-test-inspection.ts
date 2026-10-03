import assert from 'node:assert/strict';
import type { App } from 'electron';
import { getBackendClient } from '../features/backend/main/backend.ipc';
import { getSidecarRunLog } from '../features/backend/main/intentd-sidecar';
import { BUILD_CONFIG } from './build-config.generated.js';
import { getIsolatedTestProfile, isIsolatedTestBuild } from './isolated-test-profile';

/** CI-only caller: observes original exported APIs; never starts or substitutes a daemon. */
export async function inspectIsolatedTestPackage(
  app: Pick<App, 'getName' | 'getPath'>,
  expected: { frontendSha: string; backendSha: string },
) {
  assert.ok(isIsolatedTestBuild(), 'Packaged inspection requires the isolated test build');
  const profile = getIsolatedTestProfile();
  assert.ok(profile);
  for (const sha of [expected.frontendSha, expected.backendSha]) {
    assert.match(sha, /^[a-f0-9]{40}$/);
  }
  const matchesBuild = (actual: unknown, expectedSha: string) => {
    assert.equal(typeof actual, 'string');
    assert.match(actual as string, /^[a-f0-9]{7,40}$/);
    assert.ok(expectedSha.startsWith(actual as string), 'Original build identity mismatch');
  };
  matchesBuild(BUILD_CONFIG.GIT_COMMIT_HASH, expected.frontendSha);
  assert.equal(profile.backendSha, expected.backendSha);
  assert.equal(BUILD_CONFIG.ISOLATED_TEST_BACKEND_SHA, expected.backendSha);
  const client = getBackendClient();
  assert.equal(client.getStatus(), 'connected');
  const config = client.getConfig();
  assert.equal(config.transport, 'uds');
  assert.ok(config.transport === 'uds');
  assert.equal(config.socketPath, profile.socket);
  const hello = await client.request<{
    clientId: string;
    server: {
      protocolVersion: string;
      buildCommit: string;
      locality: string;
      capabilities: Record<string, unknown>;
    };
  }>('client.hello');
  assert.ok(typeof hello?.clientId === 'string' && hello.clientId.length > 0);
  assert.equal(hello.server?.protocolVersion, '13.3'); // protocol-version-ok: integrated GitLab candidate contract
  assert.equal(hello.server?.locality, 'local');
  for (const capability of [
    'collaborationIdentity',
    'hostMembership',
    'personalPairing',
    'repositoryContext',
    'repositorySelection',
    'repositoryResourceRead',
    'nativeReview',
    'nativeReviewCompanion',
  ])
    assert.equal(hello.server?.capabilities?.[capability], 1, capability);
  matchesBuild(hello.server.buildCommit, expected.backendSha);
  const status = await client.request<{ buildCommit: string }>('system.status');
  matchesBuild(status?.buildCommit, expected.backendSha);
  assert.equal(status.buildCommit, hello.server.buildCommit);
  const run = getSidecarRunLog();
  assert.equal(run.available, true);
  assert.ok(run.startedAt);
  assert.equal(run.endedAt, null);
  assert.equal(run.spawnError, null);
  assert.equal(app.getPath('userData'), profile.userData);
  assert.equal(app.getPath('home'), profile.home);
  assert.equal(app.getName(), 'Intent GitLab Test');
  return {
    name: app.getName(),
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    data: profile.data,
    root: profile.root,
    socket: profile.socket,
    frontendSha: BUILD_CONFIG.GIT_COMMIT_HASH,
    backendSha: profile.backendSha,
    config,
    run,
    hello,
    status,
  };
}
