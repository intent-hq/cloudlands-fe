import { beforeEach, describe, expect, it, vi } from 'vitest';
const notify = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify }));
vi.mock('./DesktopConsentToast.svelte', () => ({ default: () => {} }));
import {
  showDesktopPrompt,
  dismissDesktopPrompt,
  showDesktopStarted,
  showDesktopError,
} from './desktop-notifications';
import { request } from './desktop-test-fixtures';
beforeEach(() => vi.clearAllMocks());
describe('desktop notifications', () => {
  it('does not resurrect a resolved prompt while lazy imports finish', async () => {
    await Promise.all([showDesktopPrompt(request), dismissDesktopPrompt(request.requestId)]);
    expect(notify.custom).not.toHaveBeenCalled();
    expect(notify.dismiss).toHaveBeenCalledWith('desktop-consent:request');
  });
  it('keeps a prompt sticky and supplies immutable request identity', async () => {
    await showDesktopPrompt(request);
    expect(notify.custom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        duration: Infinity,
        dismissible: false,
        componentProps: { workspaceId: 'workspace', agentId: 'agent', requestId: 'request' },
      }),
    );
  });
  it('names the target desktop on an actual start and preserves OS error detail', async () => {
    await showDesktopStarted('session', 'Windows workstation');
    expect(notify.info).toHaveBeenCalledWith('Desktop control started on Windows workstation', {
      id: 'desktop-start:session',
    });
    await showDesktopError('Windows secure desktop is unavailable.');
    expect(notify.error).toHaveBeenCalledWith('Desktop control could not start', {
      description: 'Windows secure desktop is unavailable.',
    });
  });
});
