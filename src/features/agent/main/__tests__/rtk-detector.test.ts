import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockHostExec, mockFindBinary, mockGetSetting, loggerSpies } = vi.hoisted(() => ({
  mockHostExec: vi.fn(),
  mockFindBinary: vi.fn(),
  mockGetSetting: vi.fn(),
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

vi.mock('../../../workspace/main/app-settings.service', () => ({
  getSetting: mockGetSetting,
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
  beforeEach(() => {
    vi.resetModules();
    mockHostExec.mockReset();
    mockFindBinary.mockReset();
    mockGetSetting.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
    mockGetSetting.mockReturnValue(false);
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
});