import * as messages from '$shared/paraglide/messages.js';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { matchesSettingsSearchText } from '$lib/components/patterns/settings';
import type { SettingsTab } from '$lib/components/patterns/settings';
import { SETTINGS_NAV_GROUPS } from '$lib/components/settings/settings-nav-items';

/**
 * Message keys whose text makes a section or row findable. A key that ends in `_`
 * is a prefix: it takes every label, title, description and info message under it.
 */
type SearchKeys = readonly string[];

interface SettingsSearchRow {
  id: string;
  keys: SearchKeys;
}

export interface SettingsSearchSection {
  /** Anchor id of the rendered section; also its render key on the settings page. */
  id: string;
  tab: SettingsTab;
  title: () => string;
  keys?: SearchKeys;
  /** Rows the settings page can show on their own inside this section. */
  rows?: readonly SettingsSearchRow[];
}

/** In tab order, then in page order within each tab. */
export const SETTINGS_SEARCH_SECTIONS: readonly SettingsSearchSection[] = [
  {
    id: 'providers',
    tab: 'providers',
    title: () => m.settings_sidebar_providers_label(),
    keys: [
      'settings_providers_',
      'settings_providerProfiles_',
      'settings_providerPath_',
      'settings_providerDefault_',
    ],
  },
  {
    id: 'utility-default-model',
    tab: 'providers',
    title: () => m.settings_section_defaults(),
    keys: [
      'settings_section_quickActions',
      'settings_aiBehavior_defaultModel_',
      'settings_backgroundAgent_',
      'settings_backgroundAgents_',
    ],
  },
  {
    id: 'global-instructions',
    tab: 'agent-behavior',
    title: () => m.settings_section_globalInstructions(),
    keys: ['settings_agentRules_', 'settings_agentBehavior_'],
  },
  {
    id: 'integrations',
    tab: 'connections',
    title: () => m.settings_tab_accounts(),
    keys: ['settings_connections_'],
  },
  {
    id: 'mcp-servers',
    tab: 'connections',
    title: () => m.settings_section_mcpServers(),
    keys: ['settings_mcpServers_', 'settings_mcp_'],
  },
  {
    id: 'plugins',
    tab: 'connections',
    title: () => m.settings_section_plugins(),
    keys: ['settings_plugins_'],
  },
  {
    id: 'cli-optimization',
    tab: 'token-savings',
    title: () => m.settings_section_cliOptimization(),
    keys: ['settings_rtk_'],
  },
  {
    id: 'workspace-api',
    tab: 'token-savings',
    title: () => m.settings_section_workspaceApi(),
    keys: ['settings_workspaceApi_'],
  },
  {
    id: 'agent-features',
    tab: 'token-savings',
    title: () => m.settings_section_agentFeatures(),
    keys: ['settings_agentFeatures_', 'settings_toolApprovals_', 'settings_section_toolApprovals'],
  },
  {
    id: 'devices',
    tab: 'devices',
    title: () => m.settings_sidebar_devices_label(),
    keys: ['settings_devices_'],
  },
  {
    id: 'backend-sync',
    tab: 'devices',
    title: () => m.settings_section_backendSync(),
    keys: ['settings_backendSync_'],
  },
  {
    id: 'mobile',
    tab: 'mobile',
    title: () => m.settings_sidebar_mobile_label(),
    keys: [
      'settings_personalDevices_',
      'settings_wsApi_',
      'settings_listenTargets_',
      'settings_push_',
      'settings_section_remoteAccess',
      'settings_section_network',
    ],
  },
  {
    id: 'collaboration',
    tab: 'collaboration',
    title: () => m.settings_sidebar_guestSessions_label(),
    keys: ['settings_guestSessions_', 'settings_collaboration_', 'settings_machineName_'],
  },
  {
    id: 'updates',
    tab: 'app-behavior',
    title: () => m.settings_section_updates(),
    rows: [
      { id: 'update-channel', keys: ['settings_updateChannel_'] },
      { id: 'share-update-statistics', keys: ['settings_shareUpdateStatistics_'] },
    ],
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
    keys: ['settings_githubLinks_'],
  },
  {
    id: 'notifications',
    tab: 'app-behavior',
    title: () => m.settings_section_notifications(),
    keys: ['settings_notifications_'],
  },
  {
    id: 'licenses',
    tab: 'app-behavior',
    title: () => m.settings_licenses_title_label(),
    keys: ['settings_licenses_'],
  },
  {
    id: 'theme',
    tab: 'display',
    title: () => m.settings_section_appearance(),
    rows: [
      {
        id: 'theme-preference',
        keys: [
          'settings_theme_label',
          'settings_theme_light',
          'settings_theme_dark',
          'settings_theme_system',
        ],
      },
      { id: 'color-theme', keys: ['settings_colorTheme_'] },
      {
        id: 'chat-appearance',
        keys: ['settings_appearance_chatContentWidth_', 'settings_appearance_collapseToolRuns_'],
      },
      { id: 'menu-bar-auto-hide', keys: ['settings_appearance_menuBarAutoHide_'] },
      { id: 'machine-rail', keys: ['settings_machineRail_'] },
    ],
  },
  {
    id: 'font-style',
    tab: 'display',
    title: () => m.settings_section_fontStyle(),
    rows: [
      { id: 'note-font', keys: ['settings_font_notes_'] },
      { id: 'agent-chat-font', keys: ['settings_font_agentChat_'] },
      { id: 'code-font', keys: ['settings_font_code_'] },
    ],
  },
  {
    id: 'language',
    tab: 'display',
    title: () => m.settings_language_section_title(),
    keys: ['settings_language_'],
  },
  {
    id: 'performance',
    tab: 'performance',
    title: () => m.settings_section_animationsAndEffects(),
    rows: [
      { id: 'chat-aurora', keys: ['settings_appearance_chatAurora_'] },
      { id: 'translucent-window', keys: ['settings_appearance_translucentWindow_'] },
      { id: 'reduce-motion-on-battery', keys: ['settings_appearance_reduceMotionOnBattery_'] },
      {
        id: 'pause-animations-when-unfocused',
        keys: ['settings_appearance_pauseAnimationsWhenUnfocused_'],
      },
    ],
  },
  {
    id: 'agent-backend',
    tab: 'performance',
    title: () => m.settings_section_agentBackend(),
    keys: ['settings_agentBackend_'],
  },
  {
    id: 'dock-lab',
    tab: 'input',
    title: () => m.settings_dockLab_label(),
    keys: ['settings_dockLab_'],
  },
  {
    id: 'voice',
    tab: 'input',
    title: () => m.settings_section_voice(),
    keys: ['settings_voice_'],
  },
  {
    id: 'autocomplete',
    tab: 'input',
    title: () => m.settings_section_autocomplete(),
    keys: ['settings_autocomplete_'],
  },
  {
    id: 'keyboard-shortcuts',
    tab: 'input',
    title: () => m.settings_section_keyboardShortcuts(),
    keys: ['settings_keyboardShortcuts_'],
  },
  {
    id: 'hardware',
    tab: 'input',
    title: () => m.settings_section_hardware(),
    keys: ['settings_hardware_'],
  },
  {
    id: 'passkeys',
    tab: 'passkeys',
    title: () => m.settings_sidebar_passkeys_label(),
    keys: ['passkeys_settings_'],
  },
  {
    id: 'git-workspace',
    tab: 'setup',
    title: () => m.settings_sidebar_setup_label(),
    keys: [
      'settings_gitWorkspace_',
      'settings_section_git',
      'settings_section_shell',
      'settings_section_workspace',
      'settings_section_archiving',
    ],
  },
  {
    id: 'labs',
    tab: 'advanced',
    title: () => m.settings_section_labs(),
    keys: ['settings_labs_'],
  },
  {
    id: 'tunnel-relay',
    tab: 'advanced',
    title: () => m.settings_tunnel_relay_label(),
    keys: ['settings_tunnel_'],
  },
  {
    id: 'connection',
    tab: 'advanced',
    title: () => m.settings_section_connection(),
    keys: ['settings_connection_socket_label'],
  },
  {
    id: 'reset',
    tab: 'advanced',
    title: () => m.settings_section_reset(),
    keys: ['settings_reset_'],
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

const SEARCHABLE_KEY = /_(label|title|description|info)$/;
const NO_INPUTS = new Proxy({}, { get: () => '' });
const catalog = messages as unknown as Record<string, unknown>;

function render(key: string): string {
  const message = catalog[key];
  if (typeof message !== 'function') return '';
  try {
    return String((message as (inputs: unknown) => unknown)(NO_INPUTS));
  } catch {
    return '';
  }
}

/** @internal Message keys a search key list resolves to, in catalog order. */
export function resolveSearchKeys(keys: SearchKeys): string[] {
  return keys.flatMap((key) =>
    key.endsWith('_')
      ? Object.keys(catalog).filter((name) => name.startsWith(key) && SEARCHABLE_KEY.test(name))
      : key in catalog
        ? [key]
        : [],
  );
}

let textCache: { locale: string; texts: Map<string, string> } | undefined;

function keysText(cacheKey: string, keys: SearchKeys | undefined): string {
  const locale = getLocale();
  if (textCache?.locale !== locale) textCache = { locale, texts: new Map() };
  let text = textCache.texts.get(cacheKey);
  if (text === undefined) {
    text = keys ? resolveSearchKeys(keys).map(render).join('\n') : '';
    textCache.texts.set(cacheKey, text);
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
        .filter((row) =>
          matchesSettingsSearchText(keysText(`${section.id}/${row.id}`, row.keys), query),
        )
        .map((row) => row.id);
      if (matchedRows.length > 0) {
        hit = { section, rows: matchedRows, rowQuery: query };
      } else if (matchesSettingsSearchText(keysText(section.id, section.keys), query)) {
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
