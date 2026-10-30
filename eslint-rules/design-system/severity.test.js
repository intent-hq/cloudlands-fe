// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { baselineFiles, loadBaseline } from '../lib/baseline-ratchet.js';
import { designSystemRules } from './index.js';

const root = process.cwd();
// A new, non-baselined Svelte component: the shape that slipped through on
// cloudlands-fe#3870, where a `warn` severity let `size="xs"` pass the changed-files lint
// and only the whole-repo baseline ratchet (CI Unit Tests) caught it.
const newSvelteFile = 'src/lib/components/__design-system-severity-probe__.svelte';

const severityOf = (entry) => {
  const level = Array.isArray(entry) ? entry[0] : entry;
  return { 0: 'off', 1: 'warn', 2: 'error' }[level] ?? level;
};

async function resolvedRules(file) {
  const config = await new ESLint({ cwd: root }).calculateConfigForFile(file);
  return config.rules ?? {};
}

describe('design-system ESLint severity', () => {
  it('reports every design-system rule as an error on new source files', async () => {
    const rules = await resolvedRules(newSvelteFile);
    const configured = Object.keys(designSystemRules)
      .map((rule) => `intent/${rule}`)
      .filter((ruleId) => ruleId in rules);

    expect(configured).toContain('intent/no-button-compatibility-aliases');
    const nonErrors = Object.fromEntries(
      configured
        .map((ruleId) => [ruleId, severityOf(rules[ruleId])])
        .filter(([, severity]) => severity !== 'error'),
    );
    expect(nonErrors).toEqual({});
  });

  it('keeps baselined files exempt from no-button-compatibility-aliases', async () => {
    const rule = 'no-button-compatibility-aliases';
    const baseline = loadBaseline({ cwd: root, rules: [rule] });
    const [baselinedFile] = baselineFiles(baseline[rule]);
    expect(baselinedFile).toBeDefined();

    const rules = await resolvedRules(baselinedFile);
    expect(severityOf(rules[`intent/${rule}`])).toBe('off');
  });
});
