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

  it.each([
    [
      '/usr/bin/security import /tmp/4.p12 -k /tmp/x.keychain -T /usr/bin/codesign -P hunter2',
      '/usr/bin/security import /tmp/4.p12 -k /tmp/x.keychain -T /usr/bin/codesign -P <redacted>',
    ],
    // ps joins argv with spaces, so a value's own spaces are indistinguishable from
    // argument boundaries: everything after the flag goes.
    ['security import c.p12 -P my pass phrase -k kc', 'security import c.p12 -P <redacted>'],
    ['security import c.p12 -P  leading space', 'security import c.p12 -P <redacted>'],
    ['security import c.p12 -P "quoted pass" -A', 'security import c.p12 -P <redacted>'],
    ["security import c.p12 -P 'single quoted' -A", 'security import c.p12 -P <redacted>'],
    ['security unlock-keychain -p s3cret kc', 'security unlock-keychain -p <redacted>'],
    [
      'xcrun notarytool submit --password=abc def x.zip',
      'xcrun notarytool submit --password=<redacted>',
    ],
    [
      'xcrun notarytool submit --password abc x.zip',
      'xcrun notarytool submit --password <redacted>',
    ],
    ['env CSC_KEY_PASSWORD=two words node x', 'env CSC_KEY_PASSWORD=<redacted>'],
    [
      '/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k pass with space /tmp/x.keychain',
      '/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k <redacted>',
    ],
    ['security import c.p12 -P', 'security import c.p12 -P <redacted>'],
  ])('redacts the secret in %j', (command, redacted) => {
    expect(redactCommand(command)).toBe(redacted);
  });

  it('leaves command lines without secrets intact', () => {
    for (const command of [
      '/usr/bin/security import /tmp/4.p12 -k /tmp/x.keychain',
      'xcrun actool /tmp/Intent.icon --compile build/macos-icon --platform macosx',
      'node electron-builder --mac --arm64 --publish never',
    ])
      expect(redactCommand(command)).toBe(command);
  });

  it('lists the real host processes with untruncated command lines', () => {
    const self = listProcesses().find((p) => p.pid === process.pid);
    expect(self?.command).toContain(process.argv[1] ?? process.execPath);
  });
});
