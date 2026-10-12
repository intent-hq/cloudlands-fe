import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnownRepo } from '../../../../shared/types/known-repo';
import type { SettingDefinitionWithValue } from '../../../../lib/client/settings-types';
import {
  createKnownRepositoriesReader,
  REPOS_KNOWN_SETTING,
  type KnownRepositoriesReadPorts,
} from './known-repositories-read-factory';

const releases: Array<() => void> = [];
const pending: Array<Promise<unknown>> = [];
function held<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  releases.push(() => resolve(fallback));
  return { promise, resolve };
}
function track<T>(promise: Promise<T>): Promise<T> {
  pending.push(promise);
  // Attach a settlement observer immediately; the original promise is still returned.
  void promise.then(
    () => undefined,
    () => undefined,
  );
  return promise;
}
afterEach(async () => {
  const failures: unknown[] = [];
  for (const release of releases.splice(0)) {
    try {
      release();
    } catch (error) {
      failures.push(error);
    }
  }
  const settled = await Promise.allSettled(pending.splice(0));
  for (const result of settled) if (result.status === 'rejected') failures.push(result.reason);
  if (failures.length)
    throw new AggregateError(failures, 'Held repository reads failed during cleanup');
});
function repo(path: string, lastUsedAt = '2026-01-01', githubUrl?: string): KnownRepo {
  return {
    path,
    name: path,
    addedAt: '2025-01-01',
    lastUsedAt,
    ...(githubUrl ? { githubUrl } : {}),
  };
}
function setting(value: unknown): SettingDefinitionWithValue {
  return {
    path: 'repos.known',
    label: 'Known repositories',
    description: '',
    category: 'repos',
    type: 'object',
    value,
  };
}
function harness() {
  let connection: string | null = 'host-a';
  let admin = true;
  const calls: string[] = [];
  const request =
    vi.fn<
      (...args: Parameters<KnownRepositoriesReadPorts['backendRequest']>) => Promise<unknown>
    >();
  request.mockResolvedValue({ repos: [] });
  const readSetting = vi.fn<KnownRepositoriesReadPorts['readSetting']>().mockResolvedValue(null);
  const backendRequest: KnownRepositoriesReadPorts['backendRequest'] = <T>(
    ...args: Parameters<KnownRepositoriesReadPorts['backendRequest']>
  ): Promise<T> => {
    calls.push('repo.list');
    return request(...args) as Promise<T>;
  };
  const ports: KnownRepositoriesReadPorts = {
    backendRequest,
    readSetting: (...args) => {
      calls.push('settings');
      return readSetting(...args);
    },
    currentConnection: () => {
      calls.push('connection');
      return connection;
    },
    canAdministerHost: () => {
      calls.push('admin');
      return admin;
    },
  };
  const reader = createKnownRepositoriesReader(ports);
  return {
    ...reader,
    request,
    readSetting,
    calls,
    connect: (next: string | null) => {
      connection = next;
    },
    authorize: (next: boolean) => {
      admin = next;
    },
  };
}

describe('canonical known-repository daemon reader', () => {
  it('does not call any required port during construction', () => {
    const h = harness();
    expect(h.calls).toEqual([]);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.readSetting).not.toHaveBeenCalled();
  });

  it('preserves wire arity, read ordering, managed-path exclusion and GitHub-pick precedence', async () => {
    const h = harness();
    const local = repo('/local', '2026-02-01');
    const picked = repo('/same', '2026-03-01', 'https://github.com/acme/picked');
    h.request.mockResolvedValue({
      repos: [
        local,
        repo('/same', '2026-04-01'),
        repo('/root/.clones/internal'),
        repo('C:\\root\\.repo-cache\\internal'),
      ],
    });
    h.readSetting.mockResolvedValue(setting([picked, repo('/setting-without-github')]));
    const result = await h.readKnownRepositories();
    expect(h.request.mock.calls).toEqual([['repo.list']]);
    expect(h.readSetting.mock.calls).toEqual([['repos.known']]);
    expect(h.calls).toEqual([
      'connection',
      'repo.list',
      'connection',
      'admin',
      'settings',
      'connection',
    ]);
    expect(result).toEqual({ success: true, data: [picked, local] });
    expect(result.data[0]).toBe(picked);
    expect(result.data[1]).toBe(local);
  });

  it('keeps lexical MRU ordering and deduplicates registry paths only against GitHub picks', async () => {
    const h = harness();
    const a = repo('same', '9', 'https://github.com/one/repo');
    const b = repo('same', '8', 'https://github.com/two/repo');
    const local = repo('/local', '10');
    h.request.mockResolvedValue({ repos: [repo('same', '99'), local, local] });
    h.readSetting.mockResolvedValue(setting([a, b]));
    expect((await h.readKnownRepositories()).data).toEqual([a, b, local, local]);
  });

  it('keeps the settings array mutable and returns its exact value reference for existing mutations', async () => {
    const h = harness();
    const entries = [repo('first', '1', 'https://github.com/acme/first')];
    h.readSetting.mockResolvedValue(setting(entries));
    const result = await h.readReposKnownSetting();
    expect(result).toBe(entries);
    result.push(repo('second', '2', 'https://github.com/acme/second'));
    expect((await h.readKnownRepositories()).data.map(({ path }) => path)).toEqual([
      'second',
      'first',
    ]);
    expect(REPOS_KNOWN_SETTING).toBe('repos.known');
  });

  it('reads registry data for a non-admin without reading settings', async () => {
    const h = harness();
    h.authorize(false);
    const local = repo('/member-visible');
    h.request.mockResolvedValue({ repos: [local] });
    expect(await h.readKnownRepositories()).toEqual({ success: true, data: [local] });
    expect(h.readSetting).not.toHaveBeenCalled();
    expect(h.calls).toEqual(['connection', 'repo.list', 'connection', 'admin', 'connection']);
  });

  it('preserves matching-null connection equality without adding a new admission guard', async () => {
    const h = harness();
    h.connect(null);
    h.authorize(false);
    const local = repo('/same-null');
    h.request.mockResolvedValue({ repos: [local] });
    expect(await h.readKnownRepositories()).toEqual({ success: true, data: [local] });
    expect(h.readSetting).not.toHaveBeenCalled();
  });

  it('refuses an old registry result after its await and never starts the settings read', async () => {
    const h = harness();
    const reply = held<unknown>({ repos: [] });
    h.request.mockReturnValue(reply.promise);
    const read = track(h.readKnownRepositories());
    h.connect('host-b');
    reply.resolve({ repos: [repo('/old')] });
    expect(await read).toEqual({ success: true, data: [] });
    expect(h.readSetting).not.toHaveBeenCalled();
    expect(h.calls).toEqual(['connection', 'repo.list', 'connection']);
  });

  it('refuses both sources after the settings await crosses a connection change', async () => {
    const h = harness();
    const reply = held<SettingDefinitionWithValue | null>(null);
    h.request.mockResolvedValue({ repos: [repo('/old')] });
    h.readSetting.mockReturnValue(reply.promise);
    const read = track(h.readKnownRepositories());
    await vi.waitFor(() => expect(h.readSetting).toHaveBeenCalledOnce());
    h.connect('host-b');
    reply.resolve(setting([repo('old/pick', '1', 'https://github.com/old/pick')]));
    expect(await read).toEqual({ success: true, data: [] });
  });

  it('propagates registry rejection without reading settings', async () => {
    const h = harness();
    const failure = new Error('Registry unavailable');
    h.request.mockRejectedValue(failure);
    await expect(h.readKnownRepositories()).rejects.toBe(failure);
    expect(h.readSetting).not.toHaveBeenCalled();
  });

  it('keeps registry data when the optional settings read rejects', async () => {
    const h = harness();
    const local = repo('/available');
    h.request.mockResolvedValue({ repos: [local] });
    h.readSetting.mockRejectedValue(new Error('Settings unavailable'));
    expect(await h.readKnownRepositories()).toEqual({ success: true, data: [local] });
  });

  it.each([null, 'not-an-array', { unexpected: true }])(
    'ignores a non-array settings value %j',
    async (value) => {
      const h = harness();
      const local = repo('/available');
      h.request.mockResolvedValue({ repos: [local] });
      h.readSetting.mockResolvedValue(setting(value));
      expect(await h.readKnownRepositories()).toEqual({ success: true, data: [local] });
    },
  );

  it('accepts missing registry repos while still returning valid settings picks', async () => {
    const h = harness();
    const pick = repo('acme/pick', '1', 'https://github.com/acme/pick');
    h.request.mockResolvedValue({});
    h.readSetting.mockResolvedValue(setting([pick]));
    expect(await h.readKnownRepositories()).toEqual({ success: true, data: [pick] });
  });

  it.each([null, { repos: {} }, { repos: [null] }, { repos: [{ path: 1 }] }])(
    'preserves malformed registry rejection for %j',
    async (reply) => {
      const h = harness();
      h.request.mockResolvedValue(reply);
      await expect(h.readKnownRepositories()).rejects.toBeInstanceOf(TypeError);
      expect(h.readSetting).not.toHaveBeenCalled();
    },
  );

  it('does not hide malformed entries inside an array-shaped settings value', async () => {
    const h = harness();
    h.readSetting.mockResolvedValue(setting([null]));
    await expect(h.readKnownRepositories()).rejects.toBeInstanceOf(TypeError);
  });
});
