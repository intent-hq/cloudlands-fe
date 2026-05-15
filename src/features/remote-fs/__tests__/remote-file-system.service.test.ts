import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import * as nodepath from 'path';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import { tmpdir } from 'os';

// Local helpers
const toPosix = (p: string) => p.split(nodepath.sep).join(nodepath.posix.sep);

// Mock the Remote RPC Manager used by the service to execute commands remotely
vi.mock('$shared/main/remote-rpc-manager', () => {
  type ExecResult = { stdout: string; stderr: string; exitCode: number };

  const unescape = (s: string) =>
    s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\`/g, '`')
      .replace(/\\\$/g, '$')
      .replace(/\\\"/g, '"')
      .replace(/\\\\/g, '\\');

  async function execLocal(command: string): Promise<ExecResult> {
    try {
      // cat "path" or cat 'path'
      let m = command.match(/^cat\s+(['"])(.+)\1$/);
      if (m) {
        const p = m[2];
        const data = await fs.readFile(p, 'utf-8');
        return { stdout: data, stderr: '', exitCode: 0 };
      }

      // echo "<base64>" | base64 -d > 'path' (or >>)
      m = command.match(/^echo\s+\"([^\"]+)\"\s+\|\s+base64\s+-d\s+(>>|>)\s+(['"])(.+)\3$/);
      if (m) {
        const base64Content = m[1];
        const append = m[2] === '>>';
        const p = m[4];
        const content = Buffer.from(base64Content, 'base64').toString('utf-8');
        await fs.mkdir(nodepath.dirname(p), { recursive: true });
        await fs.writeFile(p, content, { encoding: 'utf-8', flag: append ? 'a' : 'w' });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // printf "%b" "..." >|>> "path" (legacy path used by some callers)
      m = command.match(/^printf\s+\"%b\"\s+\"([\s\S]*)\"\s*(>>|>)\s*\"([^\"]+)\"$/);
      if (m) {
        const content = unescape(m[1]);
        const append = m[2] === '>>';
        const p = m[3];
        await fs.mkdir(nodepath.dirname(p), { recursive: true });
        await fs.writeFile(p, content, { encoding: 'utf-8', flag: append ? 'a' : 'w' });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // rm -f "path" or rm -f 'path'
      m = command.match(/^rm\s+-f\s+(['"])(.+)\1$/);
      if (m) {
        const p = m[2];
        await fs.rm(p, { force: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // ls -la --time-style=long-iso "path" | tail -n +2
      m = command.match(/^ls\s+-la\s+--time-style=long-iso\s+(['"])(.+)\1.*$/);
      if (m) {
        const dir = m[2];
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const stats = await Promise.all(
            entries.map(async (ent) => {
              const full = nodepath.join(dir, ent.name);
              const st = await fs.stat(full);
              const perms = `${ent.isDirectory() ? 'd' : '-'}rwxr-xr-x`; // simple
              const size = st.size.toString();
              const date = new Date(st.mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
              const parts = [
                perms,
                '1',
                'user',
                'group',
                size,
                date.split(' ')[0],
                date.split(' ')[1],
                ent.name,
              ];
              return parts.join(' ');
            }),
          );
          return { stdout: stats.join('\n'), stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: e.message, exitCode: 2 };
        }
      }

      // mkdir [-p] "path" or mkdir [-p] 'path'
      m = command.match(/^mkdir\s+(-p\s+)?(['"])(.+)\2$/);
      if (m) {
        const p = m[3];
        await fs.mkdir(p, { recursive: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // rm -rf "path" OR rmdir "path" (supports both quote styles)
      m = command.match(/^(rm\s+-rf|rmdir)\s+(['"])(.+)\2$/);
      if (m) {
        const p = m[3];
        await fs.rm(p, { recursive: true, force: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // test -e "path" && echo "exists"
      m = command.match(/^test\s+-e\s+(['"])(.+)\1\s+&&\s+echo\s+\"exists\"$/);
      if (m) {
        const p = m[2];
        const exists = await fs
          .access(p)
          .then(() => true)
          .catch(() => false);
        return { stdout: exists ? 'exists\n' : '', stderr: '', exitCode: exists ? 0 : 1 };
      }

      // stat -c "%F|%s|%Y|%a" "path" or 'path'
      m = command.match(/^stat\s+-c\s+\"%F\|%s\|%Y\|%a\"\s+(['"])(.+)\1$/);
      if (m) {
        const p = m[2];
        const st = await fs.stat(p);
        const type = st.isDirectory() ? 'directory' : 'regular file';
        const size = st.size.toString();
        const mtime = Math.floor(st.mtimeMs / 1000).toString();
        // permissions are not crucial for tests
        return { stdout: `${type}|${size}|${mtime}|755\n`, stderr: '', exitCode: 0 };
      }

      // cp [-r] "src" "dest" or cp [-r] 'src' 'dest'
      m = command.match(/^cp\s+(-r\s+)?(['"])([^'"]+)\2\s+(['"])([^'"]+)\4$/);
      if (m) {
        const recursive = !!m[1];
        const src = m[3];
        const dest = m[5];
        // Node 16+ has fs.cp
        // @ts-expect-error - fs.cp exists in Node 16+ but may not be in type definitions
        await fs.cp(src, dest, { recursive: recursive as any, force: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // mv "src" "dest" or mv 'src' 'dest'
      m = command.match(/^mv\s+(['"])([^'"]+)\1\s+(['"])([^'"]+)\3$/);
      if (m) {
        const src = m[2];
        const dest = m[4];
        await fs.rename(src, dest);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // find "searchPath" -name "pattern" or find 'searchPath' -name 'pattern'
      m = command.match(/^find\s+(['"])([^'"]+)\1\s+-name\s+(['"])([^'"]+)\3/);
      if (m) {
        const base = m[2];
        const pattern = m[4].replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        const out: string[] = [];
        async function walk(dir: string) {
          const ents = await fs.readdir(dir, { withFileTypes: true });
          for (const ent of ents) {
            const full = nodepath.join(dir, ent.name);
            if (ent.isDirectory()) {
              await walk(full);
            } else {
              if (regex.test(ent.name)) out.push(toPosix(full));
            }
          }
        }
        try {
          await walk(base);
          return { stdout: out.join('\n'), stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: e.message, exitCode: 2 };
        }
      }

      // grep [-ri] "pattern" "filePath" or grep [-ri] 'pattern' 'filePath'
      m = command.match(/^grep\s+(-[ri]+\s+)?(['"])([^'"]+)\2\s+(['"])([^'"]+)\4/);
      if (m) {
        const flags = m[1] || '';
        const pattern = m[3];
        const filePath = m[5];
        const ignoreCase = flags.includes('i');
        const recursive = flags.includes('r');
        const regex = new RegExp(pattern, ignoreCase ? 'i' : undefined);
        const out: string[] = [];
        async function grepFile(fp: string) {
          try {
            const data = await fs.readFile(fp, 'utf-8');
            const lines = data.split(/\r?\n/);
            lines.forEach((line) => {
              if (regex.test(line)) out.push(line);
            });
          } catch {}
        }
        if (recursive && fssync.existsSync(filePath) && fssync.statSync(filePath).isDirectory()) {
          const walk = async (dir: string) => {
            const ents = await fs.readdir(dir, { withFileTypes: true });
            for (const ent of ents) {
              const full = nodepath.join(dir, ent.name);
              if (ent.isDirectory()) await walk(full);
              else await grepFile(full);
            }
          };
          await walk(filePath);
        } else {
          await grepFile(filePath);
        }
        // exitCode 1 means no matches
        return { stdout: out.join('\n'), stderr: '', exitCode: out.length ? 0 : 1 };
      }

      // default: unsupported
      return { stdout: '', stderr: `Unsupported command: ${command}`, exitCode: 127 };
    } catch (e: any) {
      return { stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  const fakeClient = {
    isConnected: () => true,
    exec: async (params: { command: string; timeout?: number }) => {
      return execLocal(params.command);
    },
    readFile: async (params: { path: string }) => {
      const data = await fs.readFile(params.path, 'utf-8');
      return { content: data, size: Buffer.byteLength(data), truncated: false };
    },
    writeFile: async (params: { path: string; content: string; mkdirp?: boolean }) => {
      if (params.mkdirp) {
        await fs.mkdir(nodepath.dirname(params.path), { recursive: true });
      }
      await fs.writeFile(params.path, params.content, 'utf-8');
    },
    fileExists: async (params: { path: string }) => {
      try {
        const st = await fs.stat(params.path);
        return { exists: true, isFile: st.isFile(), isDirectory: st.isDirectory() };
      } catch {
        return { exists: false, isFile: false, isDirectory: false };
      }
    },
    stat: async (params: { path: string }) => {
      const st = await fs.stat(params.path);
      return {
        size: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        isSymlink: st.isSymbolicLink(),
        permissions: '755',
      };
    },
    listDir: async (params: { path: string }) => {
      const entries = await fs.readdir(params.path, { withFileTypes: true });
      return {
        entries: await Promise.all(
          entries.map(async (ent) => {
            const full = nodepath.join(params.path, ent.name);
            const st = await fs.stat(full);
            return {
              name: ent.name,
              type: ent.isDirectory() ? 'directory' : 'file',
              size: st.size,
              mtime: new Date(st.mtimeMs).toISOString(),
            };
          }),
        ),
      };
    },
  };

  return {
    remoteRPCManager: {
      getClient: async () => fakeClient,
      cleanup: () => {},
      cleanupAll: () => {},
    },
  };
});

import { RemoteFileSystemService } from '../main/remote-file-system.service';

describe('RemoteFileSystemService (with SSH mock)', () => {
  const baseRoot = nodepath.join(tmpdir(), 'remote-fs-tests-');
  let basePath: string;
  const connId = 'test-conn';

  beforeAll(async () => {
    basePath = await fs.mkdtemp(baseRoot);
    // Ensure POSIX style for service basePath
    basePath = toPosix(basePath);
  });

  beforeEach(async () => {
    // clean basePath contents between tests
    const entries = await fs.readdir(basePath).catch(() => []);
    for (const name of entries) {
      await fs.rm(nodepath.join(basePath, name), { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await fs.rm(basePath, { recursive: true, force: true });
  });

  it('can write, read, append and delete files', async () => {
    const svc = new RemoteFileSystemService({
      workspaceId: connId,
      basePath,
    });
    await svc.initialize();

    await svc.writeFile('dir/file.txt', 'Hello');
    expect(await svc.readFile('dir/file.txt')).toBe('Hello');

    await svc.appendFile('dir/file.txt', '\nWorld');
    expect(await svc.readFile('dir/file.txt')).toBe('Hello\nWorld');

    expect(await svc.exists('dir/file.txt')).toBe(true);
    const st = await svc.stat('dir/file.txt');
    expect(st.isFile).toBe(true);

    const list = await svc.readdir('dir');
    expect(list.map((f) => f.name)).toContain('file.txt');

    await svc.deleteFile('dir/file.txt');
    expect(await svc.exists('dir/file.txt')).toBe(false);

    await svc.disconnect();
  });

  it('supports mkdir/rmdir and copy/move/find/grep', async () => {
    const svc = new RemoteFileSystemService({
      workspaceId: connId,
      basePath,
    });
    await svc.initialize();

    await svc.mkdir('a/b/c', true);
    await svc.writeFile('a/b/c/one.txt', 'alpha\nbeta\ngamma');

    await svc.copy('a/b/c/one.txt', 'a/b/c/two.txt');
    expect(await svc.exists('a/b/c/two.txt')).toBe(true);

    await svc.move('a/b/c/two.txt', 'a/b/c/three.txt');
    expect(await svc.exists('a/b/c/three.txt')).toBe(true);
    expect(await svc.exists('a/b/c/two.txt')).toBe(false);

    const found = await svc.find('*.txt', 'a');
    expect(found.some((p) => p.endsWith('one.txt'))).toBe(true);

    const matches = await svc.grep('beta', 'a/b');
    expect(matches.length).toBeGreaterThanOrEqual(1);

    await svc.rmdir('a', true);
    expect(await svc.exists('a')).toBe(false);

    await svc.disconnect();
  });
});
