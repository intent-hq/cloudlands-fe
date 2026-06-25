/**
 * Settings & integrations mock seeder.
 *
 * Pulls user preferences, provider settings, MCP servers, per-workspace settings
 * and background-agent settings from the `AppClient` seam, plus the connected
 * GitHub/Linear/Sentry integration state, and dispatches existing slice actions
 * so the settings panel and connections list render with mock data — replacing
 * the work the settings/auth sagas used to do against the real backend.
 *
 * The MCP advanced editor also reads the raw settings file directly over IPC
 * (`user-mcp:get-settings-*`) and the settings footer reads `app:version`; those
 * channels are registered against the mock IPC router so those panes render.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { mockUserMcpSettingsContent, mockUserMcpSettingsPath } from "$lib/client/mock/fixtures";
import { registerMockSeeder } from "../mock-bootstrap";
import {
  setAgentFontStyle,
  setBetaUpdatesEnabled,
  setCodeFontFamily,
  setGroupByRepo,
  setHasCompletedProviderSetup,
  setNoteFontStyle,
  setNotificationEnabled,
  setShowArchived,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setSpellcheckEnabled,
  setSystemFonts,
  setVolume,
  setZoomFactor,
} from "../slices/user-preferences/user-preferences-slice";
import {
  hydrateActiveProvider,
  loadEnabledProvidersFromStorage,
} from "../slices/provider-settings/provider-settings-slice";
import {
  bulkSetServerStatus,
  setEnabled,
  setServers,
} from "../slices/mcp-settings/mcp-settings-slice";
import type { McpServerStatus } from "../slices/mcp-settings/mcp-settings-types";
import {
  hydrateProviderSettings,
  hydrateSettings,
} from "../slices/background-agent-settings/background-agent-settings-slice";
import { loadAutoCommitSettings } from "../slices/workspace-settings/workspace-settings-slice";
import { setGitHubAuthState } from "../slices/github-auth/github-auth-slice";
import {
  setLinearAuthState,
  setLinearIssues,
} from "../slices/linear-auth/linear-auth-slice";
import {
  setSentryConnected,
  setSentryIssues,
} from "../slices/sentry-auth/sentry-auth-slice";

/** Deterministic Sentry organization for the connected mock state. */
const MOCK_SENTRY_ORG = "acme";

registerMockSeeder("settings-integrations", async ({ store, client }) => {
  // ── User preferences ──
  const prefs = await client.settings.getUserPreferences();
  if (prefs) {
    store.dispatch(setBetaUpdatesEnabled(prefs.betaUpdatesEnabled));
    store.dispatch(setSpellcheckEnabled(prefs.spellcheckEnabled));
    store.dispatch(setZoomFactor(prefs.zoomFactor));
    store.dispatch(setShowArchived(prefs.showArchived));
    store.dispatch(setGroupByRepo(prefs.groupByRepo));
    store.dispatch(setHasCompletedProviderSetup(prefs.hasCompletedProviderSetup));
    store.dispatch(setAgentFontStyle(prefs.agentFontStyle));
    store.dispatch(setNoteFontStyle(prefs.noteFontStyle));
    store.dispatch(setCodeFontFamily(prefs.codeFontFamily));
    store.dispatch(setSystemFonts(prefs.systemFonts));
    store.dispatch(setNotificationEnabled(prefs.enabled));
    store.dispatch(setSoundEnabled(prefs.soundEnabled));
    store.dispatch(setSoundOnlyWhenUnfocused(prefs.soundOnlyWhenUnfocused));
    store.dispatch(setVolume(prefs.volume));
  }

  // ── Provider settings ──
  const providers = await client.settings.getProviderSettings();
  if (providers) {
    store.dispatch(hydrateActiveProvider(providers.activeProviderId));
    store.dispatch(loadEnabledProvidersFromStorage(providers.enabledProviders));
  }

  // ── MCP servers ──
  const servers = await client.settings.getMcpServers();
  store.dispatch(setEnabled(servers.length > 0));
  if (servers.length > 0) {
    store.dispatch(setServers(servers));
    const statusMap: Record<string, McpServerStatus> = {};
    for (const server of servers) {
      statusMap[server.name] = server.type === "stdio" ? "configured" : "connected";
    }
    store.dispatch(bulkSetServerStatus(statusMap));
  }

  // ── Background-agent settings ──
  const bgSettings = await client.settings.getBackgroundAgentSettings();
  if (bgSettings) {
    store.dispatch(
      hydrateSettings({
        defaultModel: bgSettings.defaultModel,
        typeOverrides: bgSettings.typeOverrides,
      }),
    );
    store.dispatch(hydrateProviderSettings(bgSettings.providerSettings));
  }

  // ── Per-workspace settings ──
  const workspaces = await client.workspaces.list();
  for (const workspace of workspaces) {
    const wsId = String(workspace.id);
    const wsSettings = await client.settings.getWorkspaceSettings(wsId);
    if (wsSettings) {
      store.dispatch(loadAutoCommitSettings(wsId, wsSettings.autoCommitEnabled));
    }
  }

  // ── Integrations (GitHub / Linear / Sentry) ──
  const githubUser = await client.integrations.githubUser();
  store.dispatch(
    setGitHubAuthState({
      isAuthenticated: githubUser !== null,
      requiresAugmentAuth: false,
      user: githubUser,
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );

  const linearIssues = await client.integrations.linearIssues();
  store.dispatch(setLinearAuthState(linearIssues.length > 0, false, null));
  if (linearIssues.length > 0) {
    store.dispatch(setLinearIssues(linearIssues));
  }

  const sentryIssues = await client.integrations.sentryIssues();
  if (sentryIssues.length > 0) {
    store.dispatch(setSentryConnected(MOCK_SENTRY_ORG));
    store.dispatch(setSentryIssues(sentryIssues));
  }

  // ── Direct IPC reads (not routed through Redux) ──
  registerMockIpcHandler("user-mcp:get-settings-file", async () => ({
    success: true,
    data: { content: mockUserMcpSettingsContent },
  }));
  registerMockIpcHandler("user-mcp:get-settings-path", async () => ({
    success: true,
    data: mockUserMcpSettingsPath,
  }));
  registerMockIpcHandler("app:version", async () => ({ success: true, data: "0.0.0-mock" }));
});
