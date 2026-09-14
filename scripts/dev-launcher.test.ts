import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));

vi.mock('child_process', () => {
  const childProcess = {
    spawnSync: mocks.spawnSync,
    spawn: (executable: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const { DEV_NAME, VITE_DEV_NAME, DEV_INSTANCE, ENABLE_CDP_DEBUG } = options.env;
      mocks.spawn(executable, args, {
        ...options,
        env: { DEV_NAME, VITE_DEV_NAME, DEV_INSTANCE, ENABLE_CDP_DEBUG },
      });
      return { on: vi.fn(), kill: vi.fn() };
    },
  };
  return { ...childProcess, default: childProcess };
});

vi.mock('net', () => {
  const net = {
    createServer: () => {
      let listening: () => void;
      return {
        unref() {},
        once(event: string, callback: () => void) {
          if (event === 'listening') listening = callback;
        },
        listen() {
          listening();
        },
        close(callback: () => void) {
          callback();
        },
      };
    },
  };
  return { ...net, default: net };
});

vi.mock('fs', async (importOriginal) => {
  const fs = {
    ...(await importOriginal<typeof import('fs')>()),
    existsSync: () => true,
    readdirSync: () => [],
    rmSync: () => {
      throw new Error('The launcher test must not prune real user data');
    },
  };
  return { ...fs, default: fs };
});

const originalArgv = process.argv;
const changedEnv = [
  'DEV_NAME',
  'VITE_DEV_NAME',
  'DEV_PORT',
  'DEV_INSPECT_PORT',
  'DEV_INSTANCE',
  'CDP_PORT',
  'ENABLE_CDP_DEBUG',
  'ELECTRON_EXTRA_ARGS',
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of changedEnv) vi.stubEnv(key, undefined);
  vi.stubEnv('npm_execpath', '/test/pnpm/bin/pnpm.cjs');
  vi.stubEnv('npm_config_user_agent', 'pnpm/10.30.3');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('Unexpected launcher exit');
  });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('dev launcher naming and pnpm integration', () => {
  it.each([
    { args: [], git: ['HEAD', '/workspace', 'everything-clean'], name: 'everything-clean' },
    { args: ['--name', "Amelia's & workspace"], git: [], name: "Amelia's & workspace" },
    { args: ['--cdp'], git: [''], name: '' },
  ])('launches $args with workspace-safe labels through the invoking pnpm', async (scenario) => {
    process.argv = ['node', 'scripts/dev-launcher.mjs', ...scenario.args];
    for (const stdout of scenario.git) mocks.spawnSync.mockReturnValueOnce({ status: 0, stdout });

    await import('./dev-launcher.mjs');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());

    const cdp = scenario.args.includes('--cdp');
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/test/pnpm/bin/pnpm.cjs', 'run', cdp ? 'dev:cdp:base' : 'dev:base'],
      expect.objectContaining({
        shell: false,
        windowsVerbatimArguments: false,
        env: {
          DEV_NAME: scenario.name,
          VITE_DEV_NAME: scenario.name,
          DEV_INSTANCE: '1',
          ENABLE_CDP_DEBUG: cdp ? 'true' : undefined,
        },
      }),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(`Intent [${scenario.name || 'Dev 1'}]`),
    );
    expect(mocks.spawnSync).toHaveBeenCalledTimes(scenario.git.length);
  });
});
