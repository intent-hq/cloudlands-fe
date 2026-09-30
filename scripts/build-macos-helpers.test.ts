// @vitest-environment node
// @verify-changed-triggers: scripts/build-speech-helper.cjs, scripts/build-keychain-helper.cjs,
//   scripts/ensure-native-deps.cjs

import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import native from './macos-native.cjs';

const realRequire = createRequire(import.meta.url);

describe('native Mac helper staging', () => {
  for (const helper of ['speech', 'keychain']) {
    for (const hostArch of ['x64', 'arm64']) {
      it.each([true, false])(
        `${helper} on ${hostArch} reuses only its own CPU cache (same=%s)`,
        (sameArch) => {
          const root = mkdtempSync(join(tmpdir(), 'mac-helper-cache-'));
          const script = `build-${helper}-helper.cjs`;
          const sourceName = helper === 'speech' ? 'transcribe.swift' : 'sync-helper.swift';
          const binaryPath =
            helper === 'speech'
              ? 'resources/speech-helper/intent-speech-helper'
              : 'resources/keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper';
          const put = (name: string, data: string | Buffer) => {
            const file = join(root, name);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, data);
            return file;
          };
          const archBinary = (arch: string) =>
            readFileSync(`node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`);
          const exited = Symbol('process exited');
          try {
            for (const file of [
              `scripts/${script}`,
              `resources/${helper}/${sourceName}`,
              `resources/${helper}/helper-info.plist`,
            ]) {
              utimesSync(put(file, 'fixture'), 1, 1);
            }
            if (helper === 'keychain') {
              put(
                'resources/keychain-helper/intent-keychain-helper.app/Contents/Info.plist',
                'fixture',
              );
            }
            const wrongArch = hostArch === 'x64' ? 'arm64' : 'x64';
            put(binaryPath, archBinary(sameArch ? hostArch : wrongArch));
            const execute = vi.fn((command: string, args: string[]) => {
              if (command === 'xcrun' && args[0] === 'swiftc') {
                writeFileSync(args[args.indexOf('-o') + 1], archBinary(hostArch));
              }
            });
            try {
              runInNewContext(readFileSync(resolve('scripts', script), 'utf8'), {
                __dirname: join(root, 'scripts'),
                __filename: join(root, 'scripts', script),
                process: {
                  platform: 'darwin',
                  arch: hostArch,
                  exit: () => {
                    throw exited;
                  },
                },
                console: { log: () => {}, warn: () => {} },
                require: (name: string) =>
                  name === 'child_process'
                    ? { execFileSync: execute }
                    : name === './macos-native.cjs'
                      ? native
                      : realRequire(name),
              });
            } catch (error) {
              if (error !== exited) throw error;
            }
            expect(
              execute.mock.calls.filter(
                ([command, args]) => command === 'xcrun' && args[0] === 'swiftc',
              ),
            ).toHaveLength(sameArch ? 0 : 1);
            expect(native.binaryArchitectures(join(root, binaryPath))).toEqual([hostArch]);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        },
      );
    }
  }

  it.each(['x64', 'arm64'])('rebuilds node-pty for the native Electron CPU %s', (arch) => {
    const execute = vi.fn();
    runInNewContext(readFileSync('scripts/ensure-native-deps.cjs', 'utf8'), {
      __dirname: resolve('scripts'),
      process: { platform: 'darwin', arch },
      console: { log: () => {}, error: () => {} },
      require: (name: string) =>
        name === 'child_process' ? { execSync: execute } : realRequire(name),
    });
    expect(execute).toHaveBeenCalledWith(
      `npx @electron/rebuild -f -o node-pty --arch ${arch}`,
      expect.any(Object),
    );
  });
});
