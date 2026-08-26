import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  'src/lib/components/settings/McpServersSettings.svelte',
  'utf8',
);
const pageSource = readFileSync('src/routes/(app)/settings/+page.svelte', 'utf8');
const locales = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW'];
const providerNeutralKeys = [
  'settings_mcpServers_title',
  'settings_mcpServers_description',
  'settings_mcpServers_sectionTitle',
  'settings_mcpServers_emptyTitle',
  'settings_mcpServers_emptyDescription',
];

describe('McpServersSettings presentation contract', () => {
  it('keeps the toggle and all enabled-only details in one divided card well', () => {
    expect(componentSource.match(/bg-card rounded-xl/g)).toHaveLength(1);
    expect(componentSource).toContain(
      '<section class="bg-card rounded-xl divide-y divide-border overflow-hidden">',
    );

    const enabledStart = componentSource.indexOf('{#if $enabled$}');
    const enabledEnd = componentSource.indexOf('<!-- Import success toast -->');
    const disabledRegion = componentSource.slice(
      componentSource.indexOf('</script>'),
      enabledStart,
    );
    const enabledRegion = componentSource.slice(enabledStart, enabledEnd);

    expect(disabledRegion).toContain('<div class="px-6 py-5">');
    expect(disabledRegion).toContain('<Toggle');
    expect(disabledRegion).toContain(
      '<p class="text-xs text-subtle">{m.settings_mcpServers_description()}</p>\n        <p class="text-xs text-subtle">{m.settings_mcpServers_newAgentsOnlyNote()}</p>',
    );
    expect(disabledRegion).not.toContain('settings_mcpServers_learnMore');
    expect(disabledRegion).not.toContain('https://docs.augmentcode.com/setup-augment/mcp');
    expect(enabledRegion).toContain('class="px-6 py-5 space-y-6"');
    expect(enabledRegion).not.toContain('settings_mcpServers_newAgentsOnlyNote');
    expect(enabledRegion).not.toContain(
      'mx-0 px-3 py-2 bg-muted/50 rounded-md border border-border',
    );
    expect(enabledRegion).toContain('settings_mcpServers_sectionTitle');
    expect(enabledRegion).toContain('settings_mcpServers_quickInstall');
    expect(enabledRegion).toContain('settings_mcpServers_advancedTitle');
    expect(enabledRegion.match(/<section>/g)).toHaveLength(2);
    expect(enabledRegion).not.toContain('rounded-lg border border-border overflow-hidden');
    expect(enabledRegion.match(/\bpx-6\b/g)).toHaveLength(1);
    expect(enabledRegion).toContain('class="flex items-center justify-between py-4"');
    expect(enabledRegion).not.toContain(
      'class="flex items-center justify-between py-4 border-b border-border"',
    );
    expect(enabledRegion.match(/class="pt-4"/g)).toHaveLength(2);
    expect(enabledRegion).not.toContain('class="pt-4 border-t border-border"');
    expect(enabledRegion).toContain(
      'transition:slide={{ duration: 200 }} class="border-b border-border"',
    );
    expect(enabledRegion).toContain(
      'transition:slide={{ duration: 200 }} class="border-b border-border bg-muted/20"',
    );
    expect(enabledRegion).toContain('class="pb-4 space-y-3 border-t border-border pt-4"');
    expect(enabledRegion.trimEnd()).toMatch(/\{\/if\}\s*<\/section>$/);
  });

  it('removes the provider gate and uses provider-neutral MCP copy in every locale', () => {
    expect(componentSource).not.toContain('isAuggieProvider');
    expect(pageSource).not.toContain('selectIsProviderActive');

    for (const locale of locales) {
      const catalog = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as Record<
        string,
        string
      >;
      expect(catalog).not.toHaveProperty('settings_mcpServers_auggieOnlyNote');
      expect(catalog).not.toHaveProperty('settings_mcpServers_learnMore');
      expect(providerNeutralKeys.map((key) => catalog[key]).join(' ')).not.toMatch(/Auggie/i);
    }

    const english = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Record<string, string>;
    expect(english.settings_mcpServers_title).toBe('MCP Servers');
    expect(english.settings_mcpServers_sectionTitle).toBe('Configured MCP Servers');
    expect(english.settings_mcpServers_emptyTitle).toBe('No MCP servers configured yet.');
  });
});
