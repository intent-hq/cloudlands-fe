type AppUiTargetCategory = 'navigation' | 'settings' | 'workspace' | 'specialist';

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

function settingsTarget(target: AppUiTarget): AppUiTarget {
  return { category: 'settings', ...target };
}

const APP_UI_TARGETS: AppUiTarget[] = [
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
    tab: 'agent-behavior',
    // The hash is UI-only, so the pre-rename alias stays resolvable for chat
    // NavLinks and bookmarks minted before monorepo#1729.
    hashAliases: [
      'default-model',
      'global-instructions',
      'quickActions.defaultModel',
      'backgroundAgents.defaultModel',
    ],
    scrollSelector: '#global-instructions',
    highlightSelector: '[data-highlight-id="quickActions.defaultModel"]',
    label: 'Settings: Default model',
    route: '/settings?tab=agent-behavior#global-instructions',
    description: 'Default AI behavior model selection.',
  }),
  settingsTarget({
    id: 'agents',
    tab: 'agent-behavior',
    hashAliases: ['agents', 'specialists', 'all-agents'],
    scrollSelector: '#global-instructions',
    highlightSelector: '[data-highlight-id="quickActions.defaultModel"]',
    label: 'Settings: Agent Behavior',
    route: '/settings?tab=agent-behavior#global-instructions',
    description: 'Global agent instructions and defaults.',
  }),
  settingsTarget({
    id: 'create-specialist',
    tab: 'specialists',
    hashAliases: ['create-specialist'],
    scrollSelector: '#create-specialist',
    highlightSelector: '[data-highlight-id="create-specialist"]',
    label: 'Settings: Create specialist',
    route: '/settings?tab=specialists&view=create-specialist#create-specialist',
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
  settingsTarget({
    id: 'devices',
    tab: 'devices',
    hashAliases: ['devices', 'machines'],
    scrollSelector: '#devices',
    highlightSelector: '#devices',
    label: 'Settings: Devices',
    route: '/settings?tab=devices#devices',
    description: 'Saved remote device settings.',
  }),
  ...[
    ['voice', 'Voice Dictation', 'Voice dictation settings.', 'input'],
    ['keyboard-shortcuts', 'Keyboard Shortcuts', 'Keyboard shortcuts reference.', 'input'],
    ['mcp-servers', 'MCP Servers', 'MCP server configuration.', 'connections'],
    ['git-workspace', 'Git & Workspace', 'Git and workspace defaults.', 'setup'],
    ['git', 'Git', 'Git defaults.', 'setup'],
    ['shell', 'Shell', 'Shell and CLI optimization settings.', 'setup'],
    ['workspace', 'Workspace', 'Workspace defaults.', 'setup'],
    ['cli-optimization', 'CLI Optimization', 'RTK/CLI optimization settings.', 'setup'],
    ['workspace-api', 'Workspace API', 'Workspace API output settings.', 'advanced'],
    ['utility-default-model', 'Quick Actions', 'Utility/default model settings.', 'providers'],
    ['notifications', 'Notifications', 'Notification preferences.', 'app-behavior'],
    ['updates', 'Updates', 'Application update preferences.', 'app-behavior'],
    ['open-in', 'Open In', 'External editor/app launch preferences.', 'app-behavior'],
    [
      'github-link-action',
      'GitHub Links',
      'GitHub issue and pull request link behavior.',
      'app-behavior',
    ],
    ['agent-features', 'Agent Features', 'Agent feature settings.', 'agent-behavior'],
    ['font-style', 'Font style', 'Font style settings.', 'display'],
    ['language', 'Language', 'Application language settings.', 'display'],
    ['agent-backend', 'Agent Backend', 'Agent backend settings.', 'advanced'],
    ['websocket-api', 'WebSocket API', 'WebSocket API settings.', 'advanced'],
    ['connection', 'Connection', 'Daemon connection details.', 'advanced'],
    ['hardware', 'Hardware', 'Hardware integration settings.', 'advanced'],
    ['developer', 'Developer', 'Development-only settings.', 'advanced'],
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
    tab: 'display',
    hashAliases: ['appearance', 'theme'],
    scrollSelector: '#theme',
    highlightSelector: '[data-highlight-id="appearance"]',
    label: 'Settings: Appearance',
    route: '/settings?tab=display#theme',
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
      tab: 'display',
      hashAliases: [id],
      scrollSelector: `#${id}`,
      highlightSelector: `[data-highlight-id="${id}"]`,
      label: `Settings: ${label}`,
      route: `/settings?tab=display#${id}`,
      description,
    }),
  ),
  settingsTarget({
    id: 'general',
    tab: 'advanced',
    hashAliases: ['general', 'reset'],
    scrollSelector: '#reset',
    highlightSelector: '[data-highlight-id="general"]',
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
    tab: 'specialists',
    highlightSelector: '[data-highlight-id^="specialist-"]',
    label: 'Specialist entry',
    route: '/settings?tab=specialists&specialist={specialistId}#specialist-{specialistId}',
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesIdPattern(value: string, pattern: string): boolean {
  const placeholders = pattern.match(/\{[^}]+\}/g);
  if (!placeholders?.length) return value === pattern;
  const source = pattern
    .split(/\{[^}]+\}/g)
    .map(escapeRegExp)
    .join('[^/]+');
  return new RegExp(`^${source}$`).test(value);
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
  const exactTarget = APP_UI_TARGETS.find(
    (target) => target.id === normalized || target.hashAliases?.includes(normalized),
  );
  if (exactTarget) return exactTarget;

  const dynamicTarget = APP_UI_TARGETS.find(
    (target) =>
      target.route &&
      target.dynamic &&
      target.idPattern &&
      matchesIdPattern(normalized, target.idPattern),
  );
  return dynamicTarget ? { ...dynamicTarget, id: normalized } : undefined;
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
  const target = resolveHashToTarget(hash);
  return target?.dynamic ? hash : (target?.id ?? hash);
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
