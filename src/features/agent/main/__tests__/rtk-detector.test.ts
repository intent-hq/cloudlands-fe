import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockExecAsync, mockFindBinary, mockGetSetting, loggerSpies } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
  mockFindBinary: vi.fn(),
  mockGetSetting: vi.fn(),
  loggerSpies: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  execAsync: mockExecAsync,
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
    mockExecAsync.mockReset();
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
    mockExecAsync.mockResolvedValue({
      stdout: 'Commands:\n  ls  List directory\n',
      stderr: '',
    });

    const { detectRtk } = await import('../rtk-detector');

    await expect(detectRtk()).resolves.toEqual({ available: true, subcommands: ['ls'] });
    expect(mockFindBinary).toHaveBeenCalledWith('rtk', { cache: false });
    expect(mockExecAsync).toHaveBeenCalledWith('"/tmp/custom tools/rtk" help', { timeout: 10000 });
  });
});