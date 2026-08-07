import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mocks exist before module resolution.
const { mockIsElectron, mockToast, mockNotice } = vi.hoisted(() => ({
  mockIsElectron: vi.fn(() => true),
  mockToast: vi.fn(),
  mockNotice: vi.fn((args: { label: string }) => `Couldn't reach ${args.label}; using this machine.`),
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: mockIsElectron,
}));

vi.mock('svelte-sonner', () => ({
  toast: mockToast,
}));

vi.mock('$shared/paraglide/messages.js', () => ({
  m: { layout_daemonStatus_bootFallback_notice: mockNotice },
}));

// Import after mocking.
import { createBootFallbackToastMiddleware } from './boot-fallback-toast-service';

const GET_BOOT_FALLBACK = 'connections:get-boot-fallback';

describe('createBootFallbackToastMiddleware', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  const initMiddleware = () => {
    const middleware = createBootFallbackToastMiddleware();
    return middleware({} as never)(next);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    next = vi.fn((action) => action);
    mockInvoke = vi.fn(async () => ({ bootFallback: null }));
    (global as unknown as { window: unknown }).window = {
      electronAPI: { invoke: mockInvoke },
    };
  });

  it('pulls the boot-fallback notice on creation and toasts it when present', async () => {
    mockInvoke.mockResolvedValue({ bootFallback: { id: 'remote-1', label: 'Studio Mac' } });
    initMiddleware();

    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(GET_BOOT_FALLBACK));
    await vi.waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith("Couldn't reach Studio Mac; using this machine."),
    );
    expect(mockNotice).toHaveBeenCalledWith({ label: 'Studio Mac' });
  });

  it('does not toast when there is no notice (the common case)', async () => {
    mockInvoke.mockResolvedValue({ bootFallback: null });
    initMiddleware();

    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('does not pull the notice outside Electron', () => {
    mockIsElectron.mockReturnValue(false);
    initMiddleware();

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('swallows a failed pull (advisory only — no throw, no toast)', async () => {
    mockInvoke.mockRejectedValue(new Error('bridge gone'));

    expect(() => initMiddleware()).not.toThrow();
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('passes through all actions', () => {
    const chain = initMiddleware();
    const action = { type: 'test/action' };
    const result = chain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
