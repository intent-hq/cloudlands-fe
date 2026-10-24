// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { notarize, runStaplerWithBackoff } = vi.hoisted(() => ({
  notarize: vi.fn(),
  runStaplerWithBackoff: vi.fn(),
}));
vi.mock('@electron/notarize', () => ({ notarize }));
vi.mock('./apple-ticket-retry.mjs', () => ({ runStaplerWithBackoff }));

const { default: notarizing } = await import('./notarize.js');

const context = {
  electronPlatformName: 'darwin',
  appOutDir: '/build/mac-arm64',
  packager: { appInfo: { productFilename: 'Intent' } },
};
const lostConnection = new Error(
  'Failed to staple your application with code: 68\n\nNSURLErrorDomain Code=-1005',
);

describe('notarize afterSign hook', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUDLANDS_APPLE_ID', 'release@example.com');
    vi.stubEnv('CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD', 'app-password');
    vi.stubEnv('CLOUDLANDS_APPLE_TEAM_ID', 'TEAM123456');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    notarize.mockReset();
    runStaplerWithBackoff.mockReset();
  });

  it('notarizes and staples without the extended retry when Apple responds', async () => {
    notarize.mockResolvedValue(undefined);
    await expect(notarizing(context)).resolves.toBeUndefined();
    expect(notarize).toHaveBeenCalledWith({
      tool: 'notarytool',
      appPath: '/build/mac-arm64/Intent.app',
      appleId: 'release@example.com',
      appleIdPassword: 'app-password',
      teamId: 'TEAM123456',
    });
    expect(runStaplerWithBackoff).not.toHaveBeenCalled();
  });

  it('keeps stapling with backoff after Apple drops the ticket connection (exit 68)', async () => {
    notarize.mockRejectedValue(lostConnection);
    runStaplerWithBackoff.mockResolvedValue('The staple and validate action worked!');
    await expect(notarizing(context)).resolves.toBeUndefined();
    expect(runStaplerWithBackoff).toHaveBeenCalledWith('staple', '/build/mac-arm64/Intent.app');
  });

  it('fails the build when the extended staple retry is exhausted', async () => {
    notarize.mockRejectedValue(lostConnection);
    runStaplerWithBackoff.mockRejectedValue(new Error('xcrun stapler staple failed after 5'));
    await expect(notarizing(context)).rejects.toThrow('xcrun stapler staple failed after 5');
  });

  it.each([
    ['a notarization rejection', new Error('Failed to notarize via notarytool: status Invalid')],
    ['a missing ticket', new Error('Failed to staple your application with code: 65')],
    [
      'a different code that starts with 68',
      new Error('Failed to staple your application with code: 681'),
    ],
  ])('re-throws %s without retrying', async (_, error) => {
    notarize.mockRejectedValue(error);
    await expect(notarizing(context)).rejects.toBe(error);
    expect(runStaplerWithBackoff).not.toHaveBeenCalled();
  });

  it('still skips notarization when credentials are missing', async () => {
    vi.stubEnv('CLOUDLANDS_APPLE_ID', '');
    vi.stubEnv('APPLE_ID', '');
    await expect(notarizing(context)).resolves.toBeUndefined();
    expect(notarize).not.toHaveBeenCalled();
  });

  it('skips non-macOS builds', async () => {
    await expect(
      notarizing({ ...context, electronPlatformName: 'linux' }),
    ).resolves.toBeUndefined();
    expect(notarize).not.toHaveBeenCalled();
  });
});
