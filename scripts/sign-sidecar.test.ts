import { describe, expect, it } from 'vitest';
import {
  SHARED_KEYCHAIN_GROUP_SUFFIX,
  buildHelperEntitlementsPlist,
  resolveKeychainAccessGroups,
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
