import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { matchesSettingsSearchText } from '$lib/components/patterns/settings';
import type { SettingsTab } from '$lib/components/patterns/settings';
import { SETTINGS_NAV_GROUPS } from '$lib/components/settings/settings-nav-items';
import { SETTINGS_SEARCH_TERMS } from './settings-search-terms';

/** Search text for each row lives in `SETTINGS_SEARCH_TERMS` under the row id. */
interface SettingsSearchRow {
  id: string;
}

export interface SettingsSearchSection {
  /** Anchor id of the rendered section; also its render key on the settings page. */
  id: string;
  tab: SettingsTab;
  title: () => string;
  /** Rows the settings page can show on their own inside this section. */
  rows?: readonly SettingsSearchRow[];
}

/** In tab order, then in page order within each tab. */
export const SETTINGS_SEARCH_SECTIONS: readonly SettingsSearchSection[] = [
  {
    id: 'providers',
    tab: 'providers',
    title: () => m.settings_sidebar_providers_label(),
  },
  {
    id: 'utility-default-model',
    tab: 'providers',
    title: () => m.settings_section_defaults(),
  },
  {
    id: 'global-instructions',
    tab: 'agent-behavior',
    title: () => m.settings_section_globalInstructions(),
  },
  {
    id: 'integrations',
    tab: 'connections',
    title: () => m.settings_tab_accounts(),
  },
  {
    id: 'mcp-servers',
    tab: 'connections',
    title: () => m.settings_section_mcpServers(),
  },
  {
    id: 'plugins',
    tab: 'connections',
    title: () => m.settings_section_plugins(),
  },
  {
    id: 'cli-optimization',
    tab: 'token-savings',
    title: () => m.settings_section_cliOptimization(),
  },
  {
    id: 'workspace-api',
    tab: 'token-savings',
    title: () => m.settings_section_workspaceApi(),
  },
  {
    id: 'agent-features',
    tab: 'token-savings',
    title: () => m.settings_section_agentFeatures(),
  },
  {
    id: 'devices',
    tab: 'devices',
    title: () => m.settings_sidebar_devices_label(),
  },
  {
    id: 'mobile',
    tab: 'mobile',
    title: () => m.settings_sidebar_mobile_label(),
  },
  {
    id: 'collaboration',
    tab: 'collaboration',
    title: () => m.settings_sidebar_guestSessions_label(),
  },
  {
    id: 'updates',
    tab: 'app-behavior',
    title: () => m.settings_section_updates(),
    rows: [{ id: 'update-channel' }, { id: 'share-update-statistics' }],
  },
  {
    id: 'open-in',
    tab: 'app-behavior',
    title: () => m.settings_section_openIn(),
  },
  {
    id: 'github-link-action',
    tab: 'app-behavior',
    title: () => m.settings_githubLinks_section_title(),
  },
  {
    id: 'notifications',
    tab: 'app-behavior',
    title: () => m.settings_section_notifications(),
  },
  {
    id: 'licenses',
    tab: 'app-behavior',
    title: () => m.settings_licenses_title_label(),
  },
  {
    id: 'theme',
    tab: 'display',
    title: () => m.settings_section_appearance(),
    rows: [
      {
        id: 'theme-preference',
      },
      { id: 'color-theme' },
      {
        id: 'chat-appearance',
      },
      { id: 'menu-bar-auto-hide' },
      { id: 'machine-rail' },
    ],
  },
  {
    id: 'sidebar-icons',
    tab: 'display',
    title: () => m.settings_sidebarIcons_label(),
  },
  {
    id: 'font-style',
    tab: 'display',
    title: () => m.settings_section_fontStyle(),
    rows: [{ id: 'note-font' }, { id: 'agent-chat-font' }, { id: 'code-font' }],
  },
  {
    id: 'language',
    tab: 'display',
    title: () => m.settings_language_section_title(),
  },
  {
    id: 'performance',
    tab: 'performance',
    title: () => m.settings_section_animationsAndEffects(),
    rows: [
      { id: 'chat-aurora' },
      { id: 'translucent-window' },
      { id: 'reduce-motion-on-battery' },
      {
        id: 'pause-animations-when-unfocused',
      },
    ],
  },
  {
    id: 'agent-backend',
    tab: 'performance',
    title: () => m.settings_section_agentBackend(),
  },
  {
    id: 'dock-lab',
    tab: 'input',
    title: () => m.settings_dockLab_label(),
  },
  {
    id: 'voice',
    tab: 'input',
    title: () => m.settings_section_voice(),
  },
  {
    id: 'autocomplete',
    tab: 'input',
    title: () => m.settings_section_autocomplete(),
  },
  {
    id: 'keyboard-shortcuts',
    tab: 'input',
    title: () => m.settings_section_keyboardShortcuts(),
  },
  {
    id: 'hardware',
    tab: 'input',
    title: () => m.settings_section_hardware(),
  },
  {
    id: 'passkeys',
    tab: 'passkeys',
    title: () => m.settings_sidebar_passkeys_label(),
  },
  {
    id: 'git-workspace',
    tab: 'setup',
    title: () => m.settings_sidebar_setup_label(),
  },
  {
    id: 'labs',
    tab: 'advanced',
    title: () => m.settings_section_labs(),
  },
  {
    id: 'intent-apps',
    tab: 'advanced',
    title: () => m.settings_section_intentApps(),
  },
  {
    id: 'tunnel-relay',
    tab: 'advanced',
    title: () => m.settings_tunnel_relay_label(),
  },
  {
    id: 'connection',
    tab: 'advanced',
    title: () => m.settings_section_connection(),
  },
  {
    id: 'reset',
    tab: 'advanced',
    title: () => m.settings_section_reset(),
  },
];

export interface SettingsSearchHit {
  section: SettingsSearchSection;
  /** Rows to show; `null` shows the whole section. */
  rows: readonly string[] | null;
  /** Query for nested settings forms; empty when the section itself matched. */
  rowQuery: string;
}

export interface SettingsSearchGroup {
  tab: SettingsTab;
  label: string;
  hits: SettingsSearchHit[];
}

let textCache: { locale: string; texts: Map<string, string> } | undefined;

/** Search text for a section or row id, cached per locale. */
function termsText(id: string): string {
  const locale = getLocale();
  if (textCache?.locale !== locale) textCache = { locale, texts: new Map() };
  let text = textCache.texts.get(id);
  if (text === undefined) {
    text = SETTINGS_SEARCH_TERMS[id]?.().join('\n') ?? '';
    textCache.texts.set(id, text);
  }
  return text;
}

function tabLabels(): Map<SettingsTab, string> {
  return new Map(
    SETTINGS_NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.label])),
  );
}

/**
 * Settings sections that match `query`, grouped by tab. A match on the tab or section
 * title shows the whole section; otherwise only the matching rows, when it has any.
 */
export function searchSettings(
  query: string,
  isAvailable: (id: string) => boolean,
  sections: readonly SettingsSearchSection[] = SETTINGS_SEARCH_SECTIONS,
): SettingsSearchGroup[] {
  if (!query.trim()) return [];
  const labels = tabLabels();
  const groups: SettingsSearchGroup[] = [];

  for (const section of sections) {
    if (!isAvailable(section.id)) continue;
    const tabLabel = labels.get(section.tab) ?? section.tab;
    const rows = section.rows?.filter((row) => isAvailable(row.id)) ?? [];
    let hit: SettingsSearchHit | undefined;

    if (matchesSettingsSearchText(`${tabLabel}\n${section.title()}`, query)) {
      hit = { section, rows: null, rowQuery: '' };
    } else {
      const matchedRows = rows
        .filter((row) => matchesSettingsSearchText(termsText(row.id), query))
        .map((row) => row.id);
      if (matchedRows.length > 0) {
        hit = { section, rows: matchedRows, rowQuery: query };
      } else if (matchesSettingsSearchText(termsText(section.id), query)) {
        hit = { section, rows: null, rowQuery: query };
      }
    }
    if (!hit) continue;

    const group = groups.at(-1);
    if (group?.tab === section.tab) group.hits.push(hit);
    else groups.push({ tab: section.tab, label: tabLabel, hits: [hit] });
  }
  return groups;
}
