// @vitest-environment node
// @verify-changed-triggers: .github/dependabot.yml, package.json
/**
 * Dependabot's grouped npm update failed on every run with
 * ERR_PNPM_UNUSED_PATCH because the bits-ui patch was keyed to one exact
 * version, so any bump orphaned it. Patches are now keyed by package name;
 * these checks keep that safe for Dependabot and for the patched code.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const pnpmConfig = pkg.pnpm ?? {};
const patched: Record<string, string> = pnpmConfig.patchedDependencies ?? {};

type DependabotConfig = {
  updates: Array<{
    'package-ecosystem': string;
    groups?: Record<string, { 'exclude-patterns'?: string[] }>;
  }>;
};
const dependabot = load(
  readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'),
) as DependabotConfig;

/** Patch keys without a version (`name`, not `name@1.2.3`) follow upgrades. */
const nameKeyedPatches = Object.keys(patched).filter((key) => !/^(@[^/]+\/)?[^@]+@\d/.test(key));

describe('patched dependencies stay compatible with Dependabot', () => {
  it('keys the bits-ui patch by package name so bumps do not orphan it', () => {
    expect(nameKeyedPatches).toContain('bits-ui');
  });

  it('fails install when a name-keyed patch no longer applies', () => {
    // pnpm only warns for a failing non-exact patch unless this is false,
    // which would silently ship the upstream code without our fixes.
    expect(pnpmConfig.ignorePatchFailures).toBe(false);
  });

  it('keeps name-keyed patched packages out of grouped npm updates', () => {
    const npm = dependabot.updates.find((u) => u['package-ecosystem'] === 'npm');
    expect(npm?.groups).toBeDefined();
    for (const [name, group] of Object.entries(npm!.groups!)) {
      for (const dep of nameKeyedPatches) {
        expect(group['exclude-patterns'] ?? [], `group ${name}`).toContain(dep);
      }
    }
  });
});
