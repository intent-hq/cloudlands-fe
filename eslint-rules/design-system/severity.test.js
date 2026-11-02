// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { loadBaseline } from '../lib/baseline-ratchet.js';
import { designSystemRules } from './index.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ruleIds = Object.keys(designSystemRules).map((rule) => `intent/${rule}`);
// New, non-baselined source files: the shape that slipped through on cloudlands-fe#3870,
// where a `warn` severity let `size="xs"` pass the changed-files lint and only the
// whole-repo baseline ratchet (CI Unit Tests) caught it.
const newSourceFiles = [
  'src/lib/components/__design-system-severity-probe__.svelte',
  'src/routes/__design-system-severity-probe__/+page.svelte',
  'src/features/__design-system-severity-probe__/Probe.svelte',
  'src/lib/__design-system-severity-probe__.ts',
];

const severityOf = (entry) => {
  const level = Array.isArray(entry) ? entry[0] : entry;
  return { 0: 'off', 1: 'warn', 2: 'error' }[level] ?? level;
};

// Mirrors `designSystemBaselineOverrides` in eslint.config.js: only whole-file entries
// (`files`) switch a rule off; per-file `counts` caps keep it enabled.
const wholeFileExemptions = (rule) =>
  (loadBaseline({ cwd: root, rules: [rule] })[rule] ?? []).flatMap((entry) => entry.files ?? []);

describe('design-system ESLint severity', () => {
  const eslint = new ESLint({ cwd: root });
  const resolvedRules = async (file) => (await eslint.calculateConfigForFile(file)).rules ?? {};

  it('reports every design-system rule as an error on new source files', async () => {
    const nonErrors = {};
    const configured = new Set();
    for (const file of newSourceFiles) {
      const rules = await resolvedRules(file);
      for (const ruleId of ruleIds.filter((id) => id in rules)) {
        configured.add(ruleId);
        const severity = severityOf(rules[ruleId]);
        if (severity !== 'error') nonErrors[`${file}: ${ruleId}`] = severity;
      }
    }

    expect(nonErrors).toEqual({});
    expect(ruleIds.filter((ruleId) => !configured.has(ruleId))).toEqual([]);
  });

  const exempt = wholeFileExemptions('no-button-compatibility-aliases');
  it.skipIf(exempt.length === 0)(
    'keeps baselined files exempt from no-button-compatibility-aliases',
    async () => {
      const rules = await resolvedRules(exempt[0]);
      expect(severityOf(rules['intent/no-button-compatibility-aliases'])).toBe('off');
    },
  );
});
