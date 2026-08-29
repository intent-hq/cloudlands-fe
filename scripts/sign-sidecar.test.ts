import { describe, expect, it } from 'vitest';
import {
  SHARED_KEYCHAIN_GROUP_SUFFIX,
  buildHelperEntitlementsPlist,
  parseKeychainAccessGroupsFromXml,
  parsePlutilRawArrayLength,
  resolveKeychainAccessGroups,
  sharedKeychainGroupGuardrailError,
} from './sign-sidecar.js';

/**
 * Keychain-helper entitlement composition (scripts/sign-sidecar.js): the
 * shared cross-app access group is included ONLY when the provisioning
 * profile authorizes it, and the default app-identifier group always stays
 * first so legacy items remain readable for migration.
 */

const TEAM = 'TEAM12345X';
const APP_GROUP = `${TEAM}.dev.intentapp.cloudlands-fe.keychain-helper`;
const SHARED_GROUP = `${TEAM}.${SHARED_KEYCHAIN_GROUP_SUFFIX}`;

describe('resolveKeychainAccessGroups', () => {
  it('keeps only the app-identifier group when the profile does not authorize the shared group', () => {
    expect(resolveKeychainAccessGroups(TEAM, [APP_GROUP])).toEqual([APP_GROUP]);
    expect(resolveKeychainAccessGroups(TEAM, [])).toEqual([APP_GROUP]);
    expect(resolveKeychainAccessGroups(TEAM, undefined as unknown as string[])).toEqual([
      APP_GROUP,
    ]);
  });

  it('adds the shared group when the profile lists it explicitly', () => {
    expect(resolveKeychainAccessGroups(TEAM, [APP_GROUP, SHARED_GROUP])).toEqual([
      APP_GROUP,
      SHARED_GROUP,
    ]);
  });

  it('adds the shared group when the profile carries the team wildcard', () => {
    expect(resolveKeychainAccessGroups(TEAM, [`${TEAM}.*`])).toEqual([APP_GROUP, SHARED_GROUP]);
  });

  it('ignores another team\u2019s groups and wildcards', () => {
    expect(
      resolveKeychainAccessGroups(TEAM, [
        'OTHERTEAM1.*',
        `OTHERTEAM1.${SHARED_KEYCHAIN_GROUP_SUFFIX}`,
      ]),
    ).toEqual([APP_GROUP]);
  });

  it('always lists the app-identifier group first (migration reads legacy items)', () => {
    const groups = resolveKeychainAccessGroups(TEAM, [SHARED_GROUP]);
    expect(groups[0]).toBe(APP_GROUP);
  });
});

describe('buildHelperEntitlementsPlist', () => {
  it('renders single-group entitlements identical in shape to the pre-shared-group plist', () => {
    const plist = buildHelperEntitlementsPlist(TEAM, [APP_GROUP]);
    expect(plist).toContain(
      `<key>com.apple.application-identifier</key>\n  <string>${APP_GROUP}</string>`,
    );
    expect(plist).toContain(
      `<key>com.apple.developer.team-identifier</key>\n  <string>${TEAM}</string>`,
    );
    expect(plist).toContain(`    <string>${APP_GROUP}</string>`);
    expect(plist).not.toContain(SHARED_GROUP);
  });

  it('renders both groups when the shared group is authorized', () => {
    const plist = buildHelperEntitlementsPlist(TEAM, [APP_GROUP, SHARED_GROUP]);
    const appIndex = plist.indexOf(
      `<string>${APP_GROUP}</string>`,
      plist.indexOf('keychain-access-groups'),
    );
    const sharedIndex = plist.indexOf(`<string>${SHARED_GROUP}</string>`);
    expect(appIndex).toBeGreaterThan(-1);
    expect(sharedIndex).toBeGreaterThan(appIndex);
  });
});

describe('parsePlutilRawArrayLength', () => {
  it('parses the element count plutil prints for an array in raw mode', () => {
    expect(parsePlutilRawArrayLength('2\n')).toBe(2);
    expect(parsePlutilRawArrayLength('  0  ')).toBe(0);
    expect(parsePlutilRawArrayLength('17')).toBe(17);
  });

  it('rejects anything that is not a plain non-negative integer', () => {
    expect(parsePlutilRawArrayLength('')).toBeNull();
    expect(parsePlutilRawArrayLength('abc')).toBeNull();
    expect(parsePlutilRawArrayLength('-1')).toBeNull();
    expect(parsePlutilRawArrayLength('2.5')).toBeNull();
    expect(parsePlutilRawArrayLength(`${TEAM}.*`)).toBeNull();
  });
});

describe('parseKeychainAccessGroupsFromXml', () => {
  const profileXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Entitlements</key>
\t<dict>
\t\t<key>com.apple.application-identifier</key>
\t\t<string>${APP_GROUP}</string>
\t\t<key>keychain-access-groups</key>
\t\t<array>
\t\t\t<string>${TEAM}.*</string>
\t\t\t<string>${SHARED_GROUP}</string>
\t\t</array>
\t</dict>
\t<key>TeamIdentifier</key>
\t<array>
\t\t<string>${TEAM}</string>
\t</array>
</dict>
</plist>
`;

  it('extracts the group strings from a decoded profile converted to xml1', () => {
    expect(parseKeychainAccessGroupsFromXml(profileXml)).toEqual([`${TEAM}.*`, SHARED_GROUP]);
  });

  it('returns null when the profile carries no keychain-access-groups array', () => {
    expect(parseKeychainAccessGroupsFromXml('<plist><dict></dict></plist>')).toBeNull();
    expect(parseKeychainAccessGroupsFromXml('')).toBeNull();
  });

  it('returns an empty list for an empty array', () => {
    const xml = '<key>keychain-access-groups</key>\n<array>\n</array>';
    expect(parseKeychainAccessGroupsFromXml(xml)).toEqual([]);
  });

  it('returns an empty list for the self-closing <array/> form plutil emits', () => {
    expect(parseKeychainAccessGroupsFromXml('<key>keychain-access-groups</key><array/>')).toEqual(
      [],
    );
    expect(
      parseKeychainAccessGroupsFromXml('<key>keychain-access-groups</key>\n\t<array />'),
    ).toEqual([]);
  });

  it('decodes XML entities in group values', () => {
    const xml =
      '<key>keychain-access-groups</key><array><string>TEAM12345X.a&amp;b</string></array>';
    expect(parseKeychainAccessGroupsFromXml(xml)).toEqual(['TEAM12345X.a&b']);
  });
});

describe('sharedKeychainGroupGuardrailError', () => {
  it('is inert when REQUIRE_SHARED_KEYCHAIN_GROUP is not "1"', () => {
    expect(sharedKeychainGroupGuardrailError(TEAM, [APP_GROUP], undefined)).toBeNull();
    expect(sharedKeychainGroupGuardrailError(TEAM, [APP_GROUP], '')).toBeNull();
    expect(sharedKeychainGroupGuardrailError(TEAM, [APP_GROUP], '0')).toBeNull();
  });

  it('passes when the resolved groups include the shared group', () => {
    expect(sharedKeychainGroupGuardrailError(TEAM, [APP_GROUP, SHARED_GROUP], '1')).toBeNull();
  });

  it('fails the build when the shared group is missing and the flag is set', () => {
    const error = sharedKeychainGroupGuardrailError(TEAM, [APP_GROUP], '1');
    expect(error).toContain(SHARED_GROUP);
    expect(error).toContain('REQUIRE_SHARED_KEYCHAIN_GROUP=1');
  });
});
