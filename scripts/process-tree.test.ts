// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  descendantsOf,
  formatProcessTree,
  listProcesses,
  parseProcessList,
  redactCommand,
} from './process-tree.mjs';

const PS = `
    1     0     1  10-01:00:00 Ss   /sbin/launchd
  100     1   100     30:00 S    node scripts/run-until-notarizing.mjs --minutes 30 -- pnpm run dist:mac
  200   100   200     29:59 S    pnpm run dist:mac --arm64
  300   200   200     17:02 S    node electron-builder --mac --arm64
  400   300   200     17:01 S    xcrun actool /tmp/Intent.icon --compile build/macos-icon
  401   400   200     17:01 U    /Applications/Xcode.app/usr/bin/actool /tmp/Intent.icon
  500     1   200     17:00 S    /usr/libexec/ibtoold --reparented
  600     1   600     01:00 S    unrelated
`;

describe('process tree', () => {
  const processes = parseProcessList(PS);

  it('parses ps output, keeping spaces in commands', () => {
    expect(processes).toHaveLength(8);
    expect(processes[4]).toEqual({
      pid: 400,
      ppid: 300,
      pgid: 200,
      etime: '17:01',
      stat: 'S',
      command: 'xcrun actool /tmp/Intent.icon --compile build/macos-icon',
    });
  });

  it('walks descendants parents-first', () => {
    expect(descendantsOf(200, processes).map((p) => p.pid)).toEqual([200, 300, 400, 401]);
    expect(descendantsOf(999, processes)).toEqual([]);
  });

  it('formats an indented tree and lists reparented group members', () => {
    expect(formatProcessTree(200, processes)).toEqual([
      '200 (ppid 100, pgid 200, 29:59, S) pnpm run dist:mac --arm64',
      '  300 (ppid 200, pgid 200, 17:02, S) node electron-builder --mac --arm64',
      '    400 (ppid 300, pgid 200, 17:01, S) xcrun actool /tmp/Intent.icon --compile build/macos-icon',
      '      401 (ppid 400, pgid 200, 17:01, U) /Applications/Xcode.app/usr/bin/actool /tmp/Intent.icon',
      '500 (ppid 1, pgid 200, 17:00, S) /usr/libexec/ibtoold --reparented [same process group, reparented]',
    ]);
  });

  it('redacts passwords from command lines', () => {
    expect(
      redactCommand(
        '/usr/bin/security import /tmp/4.p12 -k /tmp/x.keychain -T /usr/bin/codesign -P hunter2',
      ),
    ).toBe(
      '/usr/bin/security import /tmp/4.p12 -k /tmp/x.keychain -T /usr/bin/codesign -P <redacted>',
    );
    expect(redactCommand('security unlock-keychain -p s3cret kc')).toBe(
      'security unlock-keychain -p <redacted> kc',
    );
    expect(redactCommand('xcrun notarytool submit --password=abc x.zip')).toBe(
      'xcrun notarytool submit --password=<redacted> x.zip',
    );
    expect(redactCommand('env CSC_KEY_PASSWORD=abc node x')).toBe(
      'env CSC_KEY_PASSWORD=<redacted> node x',
    );
  });

  it('lists the real host processes, including this one', () => {
    expect(listProcesses().some((p) => p.pid === process.pid)).toBe(true);
  });
});
