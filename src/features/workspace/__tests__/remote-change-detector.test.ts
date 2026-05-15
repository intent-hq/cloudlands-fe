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
import { tmpdir } from 'os';

// Same SSH mock as in remote-fs tests (kept minimal here)
vi.mock('$shared/main/ssh-manager', () => {
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

      m = command.match(/^rm\s+-f\s+(['"])(.+)\1$/);
      if (m) {
        const p = m[2];
        await fs.rm(p, { force: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      m = command.match(/^ls\s+-la\s+--time-style=long-iso\s+(['"])(.+)\1.*$/);
      if (m) {
        const dir = m[2];
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const stats = await Promise.all(
            entries.map(async (ent) => {
              const full = nodepath.join(dir, ent.name);
              const st = await fs.stat(full);
              const perms = `${ent.isDirectory() ? 'd' : '-'}rwxr-xr-x`;
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
                '0',
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

      m = command.match(/^mkdir\s+(-p\s+)?(['"])(.+)\2$/);
      if (m) {
        const p = m[3];
        await fs.mkdir(p, { recursive: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      m = command.match(/^(rm\s+-rf|rmdir)\s+(['"])(.+)\2$/);
      if (m) {
        const p = m[3];
        await fs.rm(p, { recursive: true, force: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      m = command.match(/^test\s+-e\s+(['"])(.+)\1\s+&&\s+echo\s+\"exists\"$/);
      if (m) {
        const p = m[2];
        const exists = await fs
          .access(p)
          .then(() => true)
          .catch(() => false);
        return { stdout: exists ? 'exists\n' : '', stderr: '', exitCode: exists ? 0 : 1 };
      }

      m = command.match(/^stat\s+-c\s+\"%F\|%s\|%Y\|%a\"\s+(['"])(.+)\1$/);
      if (m) {
        const p = m[2];
        const st = await fs.stat(p);
        const type = st.isDirectory() ? 'directory' : 'regular file';
        const size = st.size.toString();
        const mtime = Math.floor(st.mtimeMs / 1000).toString();
        return { stdout: `${type}|${size}|${mtime}|755\n`, stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `Unsupported: ${command}`, exitCode: 127 };
    } catch (e: any) {
      return { stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  return {
    sshManager: {
      async connect() {},
      async disconnect() {},
      async executeCommand(_id: string, command: string) {
        return execLocal(command);
      },
    },
  };
});

import { RemoteChangeDetector } from '../remote-change-detector';

const toPosix = (p: string) => p.split(nodepath.sep).join(nodepath.posix.sep);

async function waitForChanges(detector: RemoteChangeDetector, timeout = 2000) {
  return await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for changes')), timeout);
    const handler = (diffChunk: any) => {
      clearTimeout(t);
      detector.off('changes', handler);
      resolve(diffChunk);
    };
    detector.on('changes', handler);
  });
}

describe('RemoteChangeDetector (with SSH mock)', () => {
  const baseRoot = nodepath.join(tmpdir(), 'remote-detector-tests-');
  let basePath: string;

  beforeAll(async () => {
    basePath = await fs.mkdtemp(baseRoot);
    basePath = toPosix(basePath);
  });

  beforeEach(async () => {
    // reset contents
    const entries = await fs.readdir(basePath).catch(() => []);
    for (const name of entries) {
      await fs.rm(nodepath.join(basePath, name), { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await fs.rm(basePath, { recursive: true, force: true });
  });

  it('detects added, modified, and deleted files', async () => {
    // seed one file
    await fs.writeFile(nodepath.join(basePath, 'a.txt'), 'one', 'utf-8');

    const detector = new RemoteChangeDetector({
      connectionId: 'conn-1',
      sshConfig: { host: 'localhost', port: 22, username: 'test' } as any,
      basePath,
      debounceDelay: 20,
      pollInterval: 10,
      adaptivePolling: false,
    });

    await detector.start();

    // Add
    await fs.writeFile(nodepath.join(basePath, 'b.txt'), 'two', 'utf-8');
    await detector.forceCheck();
    let diffChunk = await waitForChanges(detector);
    expect(diffChunk.files.some((f: any) => f.action === 'Create' && f.path.endsWith('b.txt'))).toBe(true);

    // Modify
    await fs.writeFile(nodepath.join(basePath, 'a.txt'), 'changed', 'utf-8');
    await detector.forceCheck();
    diffChunk = await waitForChanges(detector);
    expect(diffChunk.files.some((f: any) => f.action === 'Modify' && f.path.endsWith('a.txt'))).toBe(true);

    // Delete
    await fs.rm(nodepath.join(basePath, 'a.txt'));
    await detector.forceCheck();
    diffChunk = await waitForChanges(detector);
    expect(diffChunk.files.some((f: any) => f.action === 'Delete' && f.path.endsWith('a.txt'))).toBe(true);

    await detector.stop();
  });
});
