import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockHostExec, mockFindBinary, mockGetLocalPref, loggerSpies } = vi.hoisted(() => ({
  mockHostExec: vi.fn(),
  mockFindBinary: vi.fn(),
  mockGetLocalPref: vi.fn(),
  loggerSpies: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: mockHostExec,
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: mockFindBinary,
}));

vi.mock('../../../../main/local-prefs', () => ({
  getLocalPref: mockGetLocalPref,
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

describe('rtk-detector', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockHostExec.mockReset();
    mockFindBinary.mockReset();
    mockGetLocalPref.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
    mockGetLocalPref.mockResolvedValue(undefined);
    const { __resetRtkDetectorForTesting } = await import('../rtk-detector');
    __resetRtkDetectorForTesting();
  });

  it('runs help using the resolved rtk path', async () => {
    mockFindBinary.mockResolvedValue('/tmp/custom tools/rtk');
    mockHostExec.mockResolvedValue({
      stdout: 'Commands:\n  ls  List directory\n',
      stderr: '',
      exitCode: 0,
    });

    const { detectRtk } = await import('../rtk-detector');

    await expect(detectRtk()).resolves.toEqual({ available: true, subcommands: ['ls'] });
    expect(mockFindBinary).toHaveBeenCalledWith('rtk', { cache: false });
    expect(mockHostExec).toHaveBeenCalledWith('/tmp/custom tools/rtk', {
      args: ['help'],
      timeoutMs: 10000,
    });
  });

  describe('initRtkEnabled + getRtkPromptInstruction', () => {
    it('reads rtkEnabled from local-prefs', async () => {
      mockGetLocalPref.mockResolvedValueOnce(true);
      const { initRtkEnabled } = await import('../rtk-detector');
      await initRtkEnabled();
      expect(mockGetLocalPref).toHaveBeenCalledWith('rtkEnabled');
    });

    it('returns null when the flag is unhydrated (pre-init default off)', async () => {
      const { getRtkPromptInstruction } = await import('../rtk-detector');
      expect(getRtkPromptInstruction()).toBeNull();
    });

    it('returns null when hydrated to disabled', async () => {
      mockGetLocalPref.mockResolvedValueOnce(false);
      const { initRtkEnabled, getRtkPromptInstruction } = await import('../rtk-detector');
      await initRtkEnabled();
      expect(getRtkPromptInstruction()).toBeNull();
    });

    it('returns null when enabled but rtk is unavailable', async () => {
      mockGetLocalPref.mockResolvedValueOnce(true);
      const { initRtkEnabled, getRtkPromptInstruction } = await import('../rtk-detector');
      await initRtkEnabled();
      expect(getRtkPromptInstruction()).toBeNull();
    });

    it('returns the prompt line when enabled and rtk is available', async () => {
      mockGetLocalPref.mockResolvedValueOnce(true);
      mockFindBinary.mockResolvedValue('/usr/local/bin/rtk');
      mockHostExec.mockResolvedValue({
        stdout: 'Commands:\n  ls  List\n  cat  Cat\n',
        stderr: '',
        exitCode: 0,
      });
      const { initRtkEnabled, detectRtk, getRtkPromptInstruction } = await import(
        '../rtk-detector'
      );
      await Promise.all([initRtkEnabled(), detectRtk()]);
      expect(getRtkPromptInstruction()).toBe(
        'Prefix these commands with rtk for compressed, LLM-friendly output: ls, cat',
      );
    });

    it('defaults to disabled when the local-prefs read throws', async () => {
      mockGetLocalPref.mockRejectedValueOnce(new Error('disk error'));
      const { initRtkEnabled, getRtkPromptInstruction } = await import('../rtk-detector');
      await initRtkEnabled();
      expect(getRtkPromptInstruction()).toBeNull();
    });
  });
});