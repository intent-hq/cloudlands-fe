export type AppUiTargetCategory = 'navigation' | 'settings' | 'workspace' | 'specialist';

export interface AppUiTarget {
  id: string;
  tab: string;
  hashAliases?: string[];
  scrollSelector?: string;
  highlightSelector?: string;
  label?: string;
  route?: string;
  category?: AppUiTargetCategory;
  description?: string;
  dynamic?: boolean;
  idPattern?: string;
}

export type AppUiHighlightOptions = { durationMs?: number };
export type AppUiNavigateOptions = AppUiHighlightOptions & { highlightId?: string };

export type AppUiNavigatePayload = {
  route: string;
  workspaceId?: string;
  highlightId?: string;
  durationMs?: number;
};

export type AppUiHighlightPayload = {
  id: string;
  workspaceId?: string;
  durationMs?: number;
};

function settingsTarget(target: AppUiTarget): AppUiTarget {
  return { category: 'settings', ...target };
}

export const APP_UI_TARGETS: AppUiTarget[] = [
  {
    id: 'new-workspace',
    tab: '',
    label: 'New workspace',
    route: '/workspace/new',
    category: 'navigation',
    description: 'Create-workspace flow.',
  },
  settingsTarget({
    id: 'quickActions.defaultModel',
    tab: 'agents',
    // The hash is UI-only, so the pre-rename alias stays resolvable for chat
    // NavLinks and bookmarks minted before monorepo#1729.
    hashAliases: ['default-model', 'quickActions.defaultModel', 'backgroundAgents.defaultModel'],
    scrollSelector: '#default-model',
    highlightSelector: '[data-highlight-id="quickActions.defaultModel"]',
    label: 'Settings: Default model',
    route: '/settings?tab=agents#default-model',
    description: 'Default AI behavior model selection.',
  }),
  settingsTarget({
    id: 'agents',
    tab: 'agents',
    hashAliases: ['agents', 'specialists', 'all-agents'],
    scrollSelector: '#specialists',
    highlightSelector: '[data-highlight-id="specialists"]',
    label: 'Settings: Agents',
    route: '/settings?tab=agents#specialists',
    description: 'Agent and specialist settings.',
  }),
  settingsTarget({
    id: 'create-specialist',
    tab: 'agents',
    hashAliases: ['create-specialist'],
    scrollSelector: '#specialists',
    highlightSelector: '[data-highlight-id="specialists"]',
    label: 'Settings: Create specialist',
    route: '/settings?tab=agents&view=create-specialist#create-specialist',
    description: 'Create-specialist entry point.',
  }),
  settingsTarget({
    id: 'providers',
    tab: 'providers',
    hashAliases: ['providers'],
    scrollSelector: '#providers',
    highlightSelector: '[data-highlight-id="providers"]',
    label: 'Settings: AI coding CLIs',
    route: '/settings?tab=providers#providers',
    description: 'Provider/account selector settings.',
  }),
  settingsTarget({
    id: 'integrations',
    tab: 'connections',
    hashAliases: ['integrations'],
    scrollSelector: '#integrations',
    highlightSelector: '[data-highlight-id="integrations"]',
    label: 'Settings: Connections',
    route: '/settings?tab=connections#integrations',
    description: 'Connected integrations settings.',
  }),
  ...[
    ['mcp-servers', 'MCP Servers', 'MCP server configuration.', 'tools'],
    ['git-workspace', 'Git & Workspace', 'Git and workspace defaults.', 'git-workspace'],
    ['cli-optimization', 'CLI Optimization', 'RTK/CLI optimization settings.', 'tools'],
    ['utility-default-model', 'Quick Actions', 'Utility/default model settings.', 'tools'],
    ['notifications', 'Notifications', 'Notification preferences.', 'general'],
    ['open-in', 'Open In', 'External editor/app launch preferences.', 'general'],
    [
      'github-link-action',
      'GitHub Links',
      'GitHub issue and pull request link behavior.',
      'general',
    ],
  ].map(([id, label, description, tab]) =>
    settingsTarget({
      id,
      tab,
      hashAliases: [id],
      scrollSelector: `#${id}`,
      highlightSelector: `[data-highlight-id="${id}"]`,
      label: `Settings: ${label}`,
      route: `/settings?tab=${tab}#${id}`,
      description,
    }),
  ),
  settingsTarget({
    id: 'appearance',
    tab: 'appearance',
    hashAliases: ['appearance', 'theme'],
    scrollSelector: '#theme',
    highlightSelector: '[data-highlight-id="theme"]',
    label: 'Settings: Appearance',
    route: '/settings?tab=appearance#theme',
    description: 'Theme mode controls.',
  }),
  ...[
    ['color-theme', 'Color theme', 'Color theme selection.'],
    ['note-font', 'Notes font', 'Notes/spec font style.'],
    ['agent-chat-font', 'Agent chat font', 'Agent chat font style.'],
    ['code-font', 'Code font', 'Code editor and diff font.'],
  ].map(([id, label, description]) =>
    settingsTarget({
      id,
      tab: 'appearance',
      hashAliases: [id],
      scrollSelector: `#${id}`,
      highlightSelector: `[data-highlight-id="${id}"]`,
      label: `Settings: ${label}`,
      route: `/settings?tab=appearance#${id}`,
      description,
    }),
  ),
  settingsTarget({
    id: 'general',
    tab: 'advanced',
    hashAliases: ['general', 'reset'],
    scrollSelector: '#reset',
    highlightSelector: '[data-highlight-id="reset"]',
    label: 'Settings: Advanced',
    route: '/settings?tab=advanced#reset',
    description: 'Advanced settings and reset controls.',
  }),
  {
    id: 'workspace-card',
    tab: '',
    hashAliases: ['workspace-card'],
    highlightSelector: '[data-highlight-id^="workspace-"]',
    label: 'Workspace card',
    category: 'workspace',
    description: 'A workspace card on workspace list surfaces.',
    dynamic: true,
    idPattern: 'workspace-{workspaceId}',
  },
  {
    id: 'specialist-entry',
    tab: 'agents',
    highlightSelector: '[data-highlight-id^="specialist-"]',
    label: 'Specialist entry',
    route: '/settings?tab=agents&specialist={specialistId}#specialist-{specialistId}',
    category: 'specialist',
    description: 'A specific specialist row in settings.',
    dynamic: true,
    idPattern: 'specialist-{specialistId}',
  },
];

function normalizeHash(hash: string): string {
  const hashIndex = hash.indexOf('#');
  const rawHash = hashIndex >= 0 ? hash.slice(hashIndex + 1) : hash;
  return decodeURIComponent(rawHash.replace(/^#/, '')).trim();
}

function getRouteHash(route: string): string | null {
  try {
    const url = new URL(route, 'app://intent');
    return normalizeHash(url.hash) || null;
  } catch {
    const hashIndex = route.indexOf('#');
    return hashIndex >= 0 ? normalizeHash(route.slice(hashIndex + 1)) || null : null;
  }
}

export function resolveHashToTarget(hash: string): AppUiTarget | undefined {
  const normalized = normalizeHash(hash);
  if (!normalized) return undefined;
  return APP_UI_TARGETS.find(
    (target) => target.id === normalized || target.hashAliases?.includes(normalized),
  );
}

export function getAppUiTargets(): AppUiTarget[] {
  return APP_UI_TARGETS.map((target) => ({
    ...target,
    hashAliases: target.hashAliases ? [...target.hashAliases] : undefined,
  }));
}

export function getHighlightIdFromRoute(route: string): string | null {
  const hash = getRouteHash(route);
  if (!hash) return null;
  return resolveHashToTarget(hash)?.id ?? hash;
}

function getRoutePathname(route: string): string {
  try {
    return new URL(route, 'app://intent').pathname || '/';
  } catch {
    const queryIdx = route.indexOf('?');
    const hashIdx = route.indexOf('#');
    let end = route.length;
    if (queryIdx >= 0) end = Math.min(end, queryIdx);
    if (hashIdx >= 0) end = Math.min(end, hashIdx);
    return route.slice(0, end) || '/';
  }
}

const KNOWN_ROUTE_PATHS: ReadonlySet<string> = new Set(
  APP_UI_TARGETS.flatMap((t) => (t.route ? [getRoutePathname(t.route)] : [])),
);

// SvelteKit dynamic routes that accept an arbitrary id segment.
const DYNAMIC_PATH_PATTERNS: readonly RegExp[] = [/^\/workspace\/[^/]+$/, /^\/agent\/[^/]+$/];

/**
 * Returns true when a NavLink target points at a real app surface.
 *
 * Used by chat NavLink rendering to drop dead links the assistant
 * hallucinated (e.g. /specialists, /workspaces/x) before they reach
 * the user as broken click targets. A target is considered resolvable
 * if any of the following holds:
 *   - it is an intent:// URL (handled by the workspaces link handler),
 *   - its pathname matches a registered APP_UI_TARGETS route, and any
 *     hash present resolves via resolveHashToTarget,
 *   - its pathname matches a known SvelteKit dynamic route pattern.
 *
 * Absolute http(s)/file/etc. URLs are not nav-links and return false.
 */
export function isResolvableNavTarget(target: unknown): boolean {
  if (typeof target !== 'string') return false;
  const trimmed = target.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('intent://')) return true;

  let pathname: string;
  let hash: string;
  try {
    const url = new URL(trimmed, 'app://intent');
    // Reject absolute URLs with foreign schemes (http, https, file, etc.).
    if (url.protocol !== 'app:') return false;
    pathname = url.pathname || '/';
    hash = normalizeHash(url.hash);
  } catch {
    return false;
  }

  if (KNOWN_ROUTE_PATHS.has(pathname)) {
    if (!hash) return true;
    return !!resolveHashToTarget(hash);
  }

  return DYNAMIC_PATH_PATTERNS.some((re) => re.test(pathname));
}
