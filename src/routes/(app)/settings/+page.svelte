<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import {
    selectIsReadyToInstall,
    selectAutoUpdateStatus,
  } from '$store/renderer/slices/auto-update/auto-update-selectors';
  import {
    installUpdate,
    simulateSetState,
  } from '$store/renderer/slices/auto-update/auto-update-slice';
  import ProviderSelector from '$lib/components/settings/ProviderSelector.svelte';
  import AIBehaviorEditor from '$lib/components/settings/AIBehaviorEditor.svelte';
  import AIBehaviorSidebar, {
    type AIBehaviorView,
  } from '$lib/components/settings/AIBehaviorSidebar.svelte';
  import SettingsSidebarNav from '$lib/components/settings/SettingsSidebarNav.svelte';
  import ConnectionsSettings from '$lib/components/settings/ConnectionsSettings.svelte';
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import BackendSyncSettings from '$lib/components/settings/BackendSyncSettings.svelte';
  import VoiceSettings from '$lib/components/settings/VoiceSettings.svelte';
  import GitWorkspaceSettings from '$lib/components/settings/GitWorkspaceSettings.svelte';
  import OpenInAppsSettings from '$lib/components/settings/OpenInAppsSettings.svelte';
  import LanguageSettings from '$lib/components/settings/LanguageSettings.svelte';
  import GitHubLinkSettings from '$lib/components/settings/GitHubLinkSettings.svelte';
  import KeyboardShortcutsSettings from '$lib/components/settings/KeyboardShortcutsSettings.svelte';
  import McpServersSettings from '$lib/components/settings/McpServersSettings.svelte';
  import BackgroundAgentSettings from '$lib/components/settings/BackgroundAgentSettings.svelte';
  import ColorThemeSettings from '$lib/components/settings/ColorThemeSettings.svelte';
  import NotificationSettings from '$lib/components/settings/NotificationSettings.svelte';
  import RtkSettings from '$lib/components/settings/RtkSettings.svelte';
  import HardwareConsoleSettings from '$lib/components/settings/HardwareConsoleSettings.svelte';
  import WebSocketApiSettings from '$lib/components/settings/WebSocketApiSettings.svelte';
  import WorkspaceApiSettings from '$lib/components/settings/WorkspaceApiSettings.svelte';
  import AgentBackendSettings from '$lib/components/settings/AgentBackendSettings.svelte';
  import AgentFeaturesSettings from '$lib/components/settings/AgentFeaturesSettings.svelte';
  import DefaultAgentModelSettings from '$lib/components/settings/DefaultAgentModelSettings.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectDaemonTransport } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { selectThemePreference } from '$store/renderer/slices/theme/theme-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemePreference } from '$store/renderer/slices/theme/theme-types';
  import {
    resetNotificationSettings,
    setAgentFontStyle,
    setCodeFontFamily,
    setNoteFontStyle,
    setUpdateChannel,
    type AgentFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectAgentFontStyle,
    selectCodeFontFamily,
    selectCodeFontFamilyCSS,
    selectCodeFontFamilyLabel,
    selectCodeFontOptions,
    selectIsNoteMonospace,
    selectNoteFontStyle,
    selectUpdateChannel,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { isUpdateChannel } from '$features/auto-update/types';

  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import { resolveHashToTarget } from '$shared/app-ui-targets';

  import { isMacPlatform } from '$lib/utils/shortcuts';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { getNavigatorHid } from '$features/hardware-console/device/platform';
  import { watchSupportedDevicePresence } from '$features/hardware-console/device/presence';
  import { getHardwareConsoleManager } from '$features/hardware-console/instance';
  import { navigateBackFromSettings } from '$lib/utils/workspace-navigation';
  import { workspaceIdFromRouteParam } from '$lib/utils/workspace-route-context';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { onMount, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';

  const isReadyToInstall$ = selectIsReadyToInstall();
  const autoUpdateStatus$ = selectAutoUpdateStatus();
  const updateChannel$ = selectUpdateChannel();
  const noteFontStyle = selectNoteFontStyle();
  const isNoteMonospace = selectIsNoteMonospace();
  const agentFontStyle = selectAgentFontStyle();
  const codeFontFamily = selectCodeFontFamily();
  const codeFontFamilyCSS = selectCodeFontFamilyCSS();
  const codeFontFamilyLabel = selectCodeFontFamilyLabel();
  const codeFontOptions = selectCodeFontOptions();
  const themePreference = selectThemePreference();
  const daemonTransport$ = selectDaemonTransport();

  // UDS socket path of the connected intentd; null hides the Connection section
  // (external-ws, unknown transport, or missing target).
  const udsSocketPath = $derived(
    $daemonTransport$ &&
      ($daemonTransport$.mode === 'sidecar-uds' || $daemonTransport$.mode === 'external-uds') &&
      $daemonTransport$.target
      ? $daemonTransport$.target
      : null,
  );

  type SettingsTab =
    | 'display'
    | 'app-behavior'
    | 'agent-behavior'
    | 'providers'
    | 'connections'
    | 'devices'
    | 'setup'
    | 'advanced'
    | 'input'
    | 'specialists';

  const validTabs: SettingsTab[] = [
    'display',
    'app-behavior',
    'agent-behavior',
    'providers',
    'connections',
    'devices',
    'setup',
    'advanced',
    'input',
    'specialists',
  ];

  function isSettingsTab(tab: string): tab is SettingsTab {
    return validTabs.includes(tab as SettingsTab);
  }

  const hashToTab: Record<string, SettingsTab> = {
    'default-model': 'agent-behavior',
    'global-instructions': 'agent-behavior',
    specialists: 'agent-behavior',
    agents: 'agent-behavior',
    'all-agents': 'agent-behavior',
    'create-specialist': 'specialists',
    'quickActions.defaultModel': 'agent-behavior',
    'backgroundAgents.defaultModel': 'agent-behavior',
    providers: 'providers',
    integrations: 'connections',
    devices: 'devices',
    machines: 'devices',
    'backend-sync': 'devices',
    voice: 'input',
    'keyboard-shortcuts': 'input',
    'git-workspace': 'setup',
    git: 'setup',
    shell: 'setup',
    workspace: 'setup',
    notifications: 'app-behavior',
    updates: 'app-behavior',
    language: 'display',
    theme: 'display',
    appearance: 'display',
    'font-style': 'display',
    'color-theme': 'display',
    'note-font': 'display',
    'agent-chat-font': 'display',
    'code-font': 'display',
    'open-in': 'app-behavior',
    'github-link-action': 'app-behavior',
    'mcp-servers': 'connections',
    'cli-optimization': 'setup',
    'workspace-api': 'advanced',
    'agent-features': 'agent-behavior',
    'agent-backend': 'advanced',
    'utility-default-model': 'providers',
    hardware: 'advanced',
    'websocket-api': 'advanced',
    connection: 'advanced',
    reset: 'advanced',
    general: 'advanced',
    developer: 'advanced',
  };

  function resolveHashTab(targetId: string): SettingsTab | undefined {
    const targetTab = hashToTab[targetId] ?? resolveHashToTarget(targetId)?.tab;
    return targetTab && isSettingsTab(targetTab) ? targetTab : undefined;
  }

  function resolveLegacyTab(tabParam: string): SettingsTab | undefined {
    if (tabParam === 'accounts') return 'providers';
    if (
      tabParam === 'general' ||
      tabParam === 'appearance' ||
      tabParam === 'fonts-colors' ||
      tabParam === 'interface-system'
    )
      return 'display';
    if (tabParam === 'behavior' || tabParam === 'notifications') return 'app-behavior';
    if (tabParam === 'agents') return 'agent-behavior';
    if (tabParam === 'machines') return 'devices';
    if (tabParam === 'system' || tabParam === 'tools' || tabParam === 'git-workspace')
      return 'setup';
  }

  function resolveTabFromUrl(tabParam: string | null, targetId: string): SettingsTab {
    const targetTab = resolveHashTab(targetId);
    if (targetTab) return targetTab;
    if (tabParam && isSettingsTab(tabParam)) return tabParam;
    return (tabParam && resolveLegacyTab(tabParam)) || 'display';
  }

  function getInitialTab(): SettingsTab {
    return resolveTabFromUrl(page.url.searchParams.get('tab'), page.url.hash.slice(1));
  }

  let activeTab = $state<SettingsTab>(getInitialTab());

  // Update URL when tab changes
  function setActiveTab(tab: SettingsTab) {
    activeTab = tab;
    // Update URL with the new tab, preserving other params
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    }
  }

  // Keep the rendered pane in sync when SvelteKit navigates within the mounted settings page.
  $effect(() => {
    const tabParam = page.url.searchParams.get('tab');
    const targetId = page.url.hash.slice(1);
    const nextTab = resolveTabFromUrl(tabParam, targetId);

    untrack(() => {
      if (nextTab !== activeTab) activeTab = nextTab;
      handleHashNavigation();
    });
  });

  // Get specialist ID from URL query parameter for auto-selecting
  const specialistIdFromUrl = $derived(page.url.searchParams.get('specialist'));
  const settingsWorkspaceId = $derived(
    workspaceIdFromRouteParam(page.url.searchParams.get('workspaceId') ?? undefined),
  );
  // Get view parameter for direct navigation (e.g., ?view=create-specialist)
  const viewFromUrl = $derived(page.url.searchParams.get('view'));

  // Agents sidebar view state
  let aiBehaviorView = $state<AIBehaviorView>({ type: 'system-prompt' });

  function selectAiBehaviorView(view: AIBehaviorView) {
    aiBehaviorView = view;
    const tab = view.type === 'system-prompt' ? 'agent-behavior' : 'specialists';
    activeTab = tab;

    if (browser) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      url.searchParams.delete('specialist');
      url.searchParams.delete('view');

      if (view.type === 'specialist') {
        url.searchParams.set('specialist', view.id);
        url.hash = `specialist-${view.id}`;
      } else if (view.type === 'create-specialist') {
        url.searchParams.set('view', 'create-specialist');
        url.hash = 'create-specialist';
      } else {
        url.hash = 'global-instructions';
      }

      window.history.replaceState(window.history.state, '', url.toString());
    }
  }

  function showGlobalInstructions() {
    selectAiBehaviorView({ type: 'system-prompt' });
  }

  // Keep canonical Specialists query views in sync across mounted navigations.
  $effect(() => {
    const nextView: AIBehaviorView | undefined =
      viewFromUrl === 'create-specialist'
        ? { type: 'create-specialist' }
        : specialistIdFromUrl
          ? { type: 'specialist', id: specialistIdFromUrl }
          : undefined;
    if (!nextView) return;

    untrack(() => {
      if (activeTab !== 'specialists') setActiveTab('specialists');
      const isCurrentView =
        nextView.type === 'specialist'
          ? aiBehaviorView.type === 'specialist' && aiBehaviorView.id === nextView.id
          : aiBehaviorView.type === nextView.type;
      if (!isCurrentView) aiBehaviorView = nextView;
    });
  });

  // Check if we're in development mode
  const isDevMode = import.meta.env.DEV;
  const isMac = isMacPlatform();

  // Hardware section: hidden where WebHID is missing entirely. In Electron
  // (silent grants, so getDevices() reflects physical presence) it is further
  // gated on device presence — keyed off presence rather than the manager's
  // connected status so toggling the integration off (manager.stop()) keeps
  // the section visible. Web builds always show it so the user can grant a
  // device via the Connect button.
  const webHidAvailable = getNavigatorHid() !== null;
  let hardwareDevicePresent = $state(false);
  const showHardwareSection = $derived(
    webHidAvailable && (!isElectronPlatform() || hardwareDevicePresent),
  );

  const backLabel = $derived(m.settings_back_back());

  // Component refs for reset functionality
  let gitWorkspaceSettingsRef: GitWorkspaceSettings | undefined = $state();
  let colorThemeSettingsRef: ColorThemeSettings | undefined = $state();

  // Theme options
  const themeOptions = [
    { value: 'light', label: m.settings_theme_light() },
    { value: 'dark', label: m.settings_theme_dark() },
    { value: 'system', label: m.settings_theme_system() },
  ];

  // Font style options
  const fontStyleOptions = [
    { value: 'sans', label: m.settings_fontStyle_sans() },
    { value: 'monospace', label: m.settings_fontStyle_mono() },
  ];

  function handleNoteFontChange(value: string | boolean) {
    appStore.dispatch(setNoteFontStyle(value as 'sans' | 'monospace'));
  }

  function handleAgentFontChange(value: string | boolean) {
    appStore.dispatch(setAgentFontStyle(value as AgentFontStyle));
  }

  function handleCodeFontChange(value: string) {
    appStore.dispatch(setCodeFontFamily(value));
  }

  // App version from Electron
  let appVersion = $state('');

  onMount(() => {
    // Build-time constant — the app version is FE-only (audit row 11), not a
    // daemon surface.
    appVersion = __APP_VERSION__;
  });

  // Track supported-device presence for the Hardware section gate.
  onMount(() => {
    if (!webHidAvailable) return;
    return watchSupportedDevicePresence(
      getHardwareConsoleManager(),
      (present) => (hardwareDevicePresent = present),
    );
  });

  // Listen for hash changes while already on the settings page
  let hashScrollTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    window.addEventListener('hashchange', handleHashNavigation);
    return () => {
      window.removeEventListener('hashchange', handleHashNavigation);
      if (hashScrollTimer !== undefined) clearTimeout(hashScrollTimer);
    };
  });

  /** Navigate to the correct tab and scroll to the hash target */
  function handleHashNavigation() {
    if (hashScrollTimer !== undefined) {
      clearTimeout(hashScrollTimer);
      hashScrollTimer = undefined;
    }
    if (typeof window === 'undefined' || !window.location.hash) return;
    const targetId = window.location.hash.slice(1);

    // Switch to the correct tab if needed
    const targetTab = resolveHashTab(targetId);
    if (targetTab && targetTab !== activeTab) {
      activeTab = targetTab;
    }

    // Scroll to hash target after tab switch
    hashScrollTimer = setTimeout(() => {
      hashScrollTimer = undefined;
      const target = resolveHashToTarget(targetId);
      const targetEl = target?.scrollSelector
        ? document.querySelector<HTMLElement>(target.scrollSelector)
        : document.getElementById(targetId);
      if (targetEl) {
        const scrollContainer = targetEl.closest('.overflow-auto');
        if (scrollContainer) {
          const headerOffset = 20;
          const elementPosition = targetEl.offsetTop;
          scrollContainer.scrollTo({
            top: elementPosition - headerOffset,
            behavior: 'smooth',
          });
        } else {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 100);
  }

  function handleThemeChange(newTheme: string | boolean) {
    const theme = newTheme as ThemePreference;
    appStore.dispatch(requestThemePreferenceChange(theme));
  }

  const updateChannelOptions = [
    {
      value: 'stable',
      get label() {
        return m.settings_updateChannel_stable_label();
      },
    },
    {
      value: 'beta',
      get label() {
        return m.settings_updateChannel_beta_label();
      },
    },
    {
      value: 'alpha',
      get label() {
        return m.settings_updateChannel_alpha_label();
      },
    },
    {
      value: 'disabled',
      get label() {
        return m.settings_updateChannel_disabled_label();
      },
    },
  ];

  const updateChannelLabel = $derived(
    updateChannelOptions.find((option) => option.value === $updateChannel$)?.label ??
      m.settings_updateChannel_stable_label(),
  );

  function handleUpdateChannelChange(value: string) {
    if (!isUpdateChannel(value)) return;
    // Dispatch only: the update-channel persistence saga is the single
    // owner of the SET_CHANNEL write (persist + feed switch). A direct
    // setChannel call here would issue a duplicate write.
    appStore.dispatch(setUpdateChannel(value));
  }

  function handleResetInterfaceSystem() {
    // Reset theme
    appStore.dispatch(requestThemePreferenceChange('system'));
    // Clear custom color theme
    colorThemeSettingsRef?.clearTheme();
    // Reset font styles
    appStore.dispatch(setNoteFontStyle('sans'));
    appStore.dispatch(setAgentFontStyle('sans'));
    // Reset notification settings
    appStore.dispatch(resetNotificationSettings());
    // Reset Git & Workspace settings
    gitWorkspaceSettingsRef?.resetToDefaults();
  }
</script>

<div class="flex h-full min-w-0">
  <aside
    class="flex h-full w-60 shrink-0 flex-col border-r border-border dark:border-border bg-sidebar"
  >
    <div class="px-5 pt-8 pb-3">
      <!-- Back button with keyboard shortcut -->
      <button
        onclick={navigateBackFromSettings}
        class="group flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <Fa icon={faArrowLeft} class="text-xs opacity-50 mr-1" />
        <span>{backLabel}</span>
        <kbd
          class="ml-2 px-1.5 py-0.5 text-ui font-medium bg-muted text-muted-foreground border border-border rounded opacity-60 group-hover:opacity-100 transition-opacity"
        >
          {isMac ? '⌘' : 'Ctrl'},
        </kbd>
      </button>
    </div>

    <SettingsSidebarNav {activeTab} onSelect={setActiveTab}>
      {#snippet agentsNavigation()}
        <AIBehaviorSidebar
          activeView={aiBehaviorView}
          onSelect={selectAiBehaviorView}
          isActive={activeTab === 'specialists'}
        />
      {/snippet}
    </SettingsSidebarNav>

    <div class="shrink-0 border-t border-border dark:border-border px-5 py-4 text-xs text-subtle">
      <div class="flex w-full items-baseline justify-between gap-2">
        <div class="flex items-baseline gap-1.5">
          <!-- i18n-ignore (brand name) -->
          <strong class="text-foreground">Intent</strong>
          <span>v{appVersion || '...'}</span>
        </div>
        {#if $isReadyToInstall$}
          <button
            class="cursor-pointer border-none bg-transparent p-0 font-medium text-primary underline hover:text-primary/80"
            onclick={() => appStore.dispatch(installUpdate())}
          >
            {m.settings_footer_updateAvailable()}
          </button>
        {:else if $autoUpdateStatus$ === 'not-available' || $autoUpdateStatus$ === 'idle'}
          <span>{m.settings_footer_upToDate()}</span>
        {/if}
      </div>
      <a
        href="https://www.intentapp.dev/docs"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-1.5 block cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        >{m.settings_footer_support()}</a
      >
      <!-- tailcat ships bundled (resources/tailcat, BSD-3-Clause); its license
           text is packaged next to the binary as tailcat.LICENSE. -->
      <a
        href="https://github.com/tailscale/tailcat/blob/main/LICENSE"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-1 block cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        >{m.settings_footer_tailcatAttribution()}</a
      >
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-auto">
      <main
        class="mx-auto flex min-h-full {activeTab === 'specialists'
          ? 'max-w-6xl xl:h-full xl:min-h-0 xl:py-8'
          : 'max-w-4xl'} flex-col pr-8 pl-6 py-12"
        aria-labelledby="settings-page-title"
      >
        <h1 id="settings-page-title" class="sr-only">{m.settings_page_title()}</h1>
        <!-- Providers -->
        {#if activeTab === 'providers'}
          <div
            id="providers"
            data-highlight-id="providers"
            use:highlightTarget
            class="mb-12 scroll-mt-20"
          >
            <ProviderSelector />
          </div>
          <div
            id="utility-default-model"
            data-highlight-id="utility-default-model"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_defaults()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5"><DefaultAgentModelSettings /></section>
              <section class="px-6 py-5">
                <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-5">
                  {m.settings_section_quickActions()}
                </h3>
                <BackgroundAgentSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- Connections -->
        {#if activeTab === 'connections'}
          <div
            id="integrations"
            data-highlight-id="integrations"
            use:highlightTarget
            class="mb-6 scroll-mt-20"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_tab_accounts()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <ConnectionsSettings />
              </section>
            </div>
          </div>

          <div id="mcp-servers" data-highlight-id="mcp-servers" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_mcpServers()}
            </h2>
            <McpServersSettings />
          </div>
        {/if}

        <!-- Devices -->
        {#if activeTab === 'devices'}
          <div id="devices" class="mb-12 scroll-mt-20">
            <DevicesSettings />
          </div>

          <!-- Backend sync (iCloud Keychain) -->
          <div id="backend-sync" class="mb-6 scroll-mt-20">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_backendSync()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <BackendSyncSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- Hidden specialist editor destination -->
        {#if activeTab === 'specialists'}
          <div class="min-w-0 grow xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <div
              id="specialist-editor"
              class="min-w-0 grow xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
            >
              <AIBehaviorEditor
                activeView={aiBehaviorView}
                workspaceId={settingsWorkspaceId}
                onSpecialistCreated={(id) => selectAiBehaviorView({ type: 'specialist', id })}
                onSpecialistDeleted={showGlobalInstructions}
                onDiscard={showGlobalInstructions}
              />
            </div>
          </div>
        {/if}

        <!-- Setup -->
        {#if activeTab === 'setup'}
          <div id="git-workspace" data-highlight-id="git-workspace" use:highlightTarget>
            <GitWorkspaceSettings bind:this={gitWorkspaceSettingsRef}>
              {#snippet shellAdditions()}
                <div id="cli-optimization" data-highlight-id="cli-optimization" use:highlightTarget>
                  <h3
                    class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
                  >
                    {m.settings_section_cliOptimization()}
                  </h3>
                  <RtkSettings />
                </div>
              {/snippet}
            </GitWorkspaceSettings>
          </div>
        {/if}

        <!-- Display -->
        {#if activeTab === 'display'}
          <!-- Theme -->
          <div id="theme" data-highlight-id="appearance" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_appearance()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-medium text-foreground">{m.settings_theme_label()}</p>
                  <Toggle
                    variant="group"
                    options={themeOptions}
                    value={$themePreference}
                    onChange={handleThemeChange}
                    size="sm"
                  />
                </div>
              </section>
              <section
                id="color-theme"
                data-highlight-id="color-theme"
                use:highlightTarget
                class="px-6 py-5"
              >
                <ColorThemeSettings bind:this={colorThemeSettingsRef} />
              </section>
            </div>
          </div>

          <!-- Font Style -->
          <div id="font-style" data-highlight-id="font-style" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_fontStyle()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section
                id="note-font"
                data-highlight-id="note-font"
                use:highlightTarget
                class="px-6 py-5"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-foreground">
                      {m.settings_font_notes_label()}
                    </p>
                    <p
                      class="text-xs text-subtle mt-0.5 transition-all duration-200"
                      class:font-mono={$isNoteMonospace}
                    >
                      {m.settings_font_notes_description()}
                    </p>
                  </div>
                  <Toggle
                    variant="group"
                    options={fontStyleOptions}
                    value={$noteFontStyle}
                    onChange={handleNoteFontChange}
                    size="sm"
                  />
                </div>
              </section>
              <section
                id="agent-chat-font"
                data-highlight-id="agent-chat-font"
                use:highlightTarget
                class="px-6 py-5"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-foreground">
                      {m.settings_font_agentChat_label()}
                    </p>
                    <p
                      class="text-xs text-subtle mt-0.5 transition-all duration-200"
                      class:font-mono={$agentFontStyle === 'monospace'}
                    >
                      {m.settings_font_agentChat_description()}
                    </p>
                  </div>
                  <Toggle
                    variant="group"
                    options={fontStyleOptions}
                    value={$agentFontStyle}
                    onChange={handleAgentFontChange}
                    size="sm"
                  />
                </div>
              </section>
              <section
                id="code-font"
                data-highlight-id="code-font"
                use:highlightTarget
                class="px-6 py-5"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-foreground">
                      {m.settings_font_code_label()}
                    </p>
                    <p class="text-xs text-subtle mt-0.5">
                      {m.settings_font_code_description()}
                    </p>
                  </div>
                  <div class="w-[180px] flex-shrink-0">
                    <Select.Root value={$codeFontFamily} onchange={handleCodeFontChange}>
                      <Select.Trigger>
                        <span class="truncate" style:font-family={$codeFontFamilyCSS}>
                          {$codeFontFamilyLabel}
                        </span>
                      </Select.Trigger>
                      <Select.Content portal class="max-h-[300px] w-[180px]">
                        {#each $codeFontOptions as option}
                          <Select.Item value={option.value}>
                            <span class="truncate" style:font-family={option.fontFamily}>
                              {option.label}
                            </span>
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <!-- Language -->
          <div id="language" data-highlight-id="language" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_language_section_title()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <LanguageSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- App Behavior -->
        {#if activeTab === 'app-behavior'}
          <!-- Updates -->
          <div id="updates" data-highlight-id="updates" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_updates()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-foreground">
                      {m.settings_updateChannel_label()}
                    </p>
                    <p class="text-xs text-subtle mt-0.5">
                      {m.settings_updateChannel_description()}
                    </p>
                  </div>
                  <div class="w-45 flex-shrink-0">
                    <Select.Root value={$updateChannel$} onchange={handleUpdateChannelChange}>
                      <Select.Trigger aria-label={m.settings_updateChannel_ariaLabel()}>
                        <span class="truncate">{updateChannelLabel}</span>
                      </Select.Trigger>
                      <Select.Content portal class="max-h-75 w-45">
                        {#each updateChannelOptions as option (option.value)}
                          <Select.Item value={option.value}>
                            <span class="truncate">{option.label}</span>
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div id="open-in" data-highlight-id="open-in" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_openIn()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5"><OpenInAppsSettings /></section>
            </div>
          </div>
          <div
            id="github-link-action"
            data-highlight-id="github-link-action"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_githubLinks_section_title()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5"><GitHubLinkSettings /></section>
            </div>
          </div>
          <div
            id="notifications"
            data-highlight-id="notifications"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_notifications()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5"><NotificationSettings /></section>
            </div>
          </div>
        {/if}

        <!-- Agent Behavior -->
        {#if activeTab === 'agent-behavior'}
          <div
            id="global-instructions"
            data-highlight-id="quickActions.defaultModel"
            use:highlightTarget
            class="mb-12 min-w-0"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_globalInstructions()}
            </h2>
            <AIBehaviorEditor
              activeView={{ type: 'system-prompt' }}
              workspaceId={settingsWorkspaceId}
            />
          </div>

          <div
            id="agent-features"
            data-highlight-id="agent-features"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_agentFeatures()}
            </h2>
            <AgentFeaturesSettings />
          </div>
        {/if}

        <!-- Input -->
        {#if activeTab === 'input'}
          <div
            id="keyboard-shortcuts"
            data-highlight-id="keyboard-shortcuts"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_keyboardShortcuts()}
            </h2>
            <div class="rounded-xl bg-card px-6 py-5">
              <KeyboardShortcutsSettings />
            </div>
          </div>

          <div id="voice" data-highlight-id="voice" use:highlightTarget class="mb-12 scroll-mt-20">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_voice()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <VoiceSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- Advanced -->
        {#if activeTab === 'advanced'}
          <!-- Agent Backend -->
          <div
            id="agent-backend"
            data-highlight-id="agent-backend"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_agentBackend()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <AgentBackendSettings />
              </section>
            </div>
          </div>

          <!-- WebSocket API -->
          <div
            id="websocket-api"
            data-highlight-id="websocket-api"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_websocketApi()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <WebSocketApiSettings />
              </section>
            </div>
          </div>

          <!-- Workspace API Output -->
          <div
            id="workspace-api"
            data-highlight-id="workspace-api"
            use:highlightTarget
            class="mb-12"
          >
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_workspaceApi()}
            </h2>
            <WorkspaceApiSettings />
          </div>

          <!-- Connection (UDS only; hidden for WS/unknown transports) -->
          {#if udsSocketPath}
            <div id="connection" data-highlight-id="connection" use:highlightTarget class="mb-12">
              <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                {m.settings_section_connection()}
              </h2>
              <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
                <section class="px-6 py-5">
                  <div class="flex items-center justify-between gap-4">
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-foreground">
                        {m.settings_connection_socket_label()}
                      </p>
                      <p class="text-xs text-subtle mt-0.5 font-mono select-text break-all">
                        {udsSocketPath}
                      </p>
                    </div>
                    <CopyButton text={udsSocketPath} class="shrink-0" />
                  </div>
                </section>
              </div>
            </div>
          {/if}

          <!-- Hardware / Creator Micro (only when a supported device is detectable) -->
          {#if showHardwareSection}
            <div id="hardware" data-highlight-id="hardware" use:highlightTarget class="mb-12">
              <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                {m.settings_section_hardware()}
              </h2>
              <HardwareConsoleSettings />
            </div>
          {/if}

          <!-- Reset -->
          <div id="reset" data-highlight-id="general" use:highlightTarget class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {m.settings_section_reset()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-foreground">
                      {m.settings_reset_label()}
                    </p>
                    <p class="text-xs text-subtle">
                      {m.settings_reset_description()}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onclick={handleResetInterfaceSystem}>
                    {m.settings_reset_button()}
                  </Button>
                </div>
              </section>
            </div>
          </div>

          <!-- Developer Section (only in dev mode; dev-only UI is not translated) -->
          {#if isDevMode}
            <div id="developer" data-highlight-id="developer" use:highlightTarget class="mb-12">
              <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                <!-- i18n-ignore (dev-only) -->
                Developer
              </h2>
              <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
                <section class="px-6 py-5">
                  <div class="flex flex-col gap-2">
                    <!-- i18n-ignore (dev-only) -->
                    <span class="text-sm font-medium">Update Toast Simulation</span>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() =>
                          appStore.dispatch(
                            simulateSetState({
                              toastVisible: true,
                              status: 'downloading',
                              updateInfo: {
                                version: '99.0.0',
                                releaseDate: new Date().toISOString(),
                                releaseNotes: 'Simulated',
                              },
                              progress: {
                                percent: 50,
                                bytesPerSecond: 2500000,
                                transferred: 25000000,
                                total: 50000000,
                              },
                              error: null,
                            }),
                          )}
                      >
                        <!-- i18n-ignore (dev-only) -->
                        Simulate Update Flow
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() =>
                          appStore.dispatch(
                            simulateSetState({
                              toastVisible: true,
                              status: 'not-available',
                              currentVersion: '1.0.0-dev',
                            }),
                          )}
                      >
                        <!-- i18n-ignore (dev-only) -->
                        Simulate No Update
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() =>
                          appStore.dispatch(
                            simulateSetState({
                              toastVisible: false,
                              status: 'idle',
                              currentVersion: '1.0.0-dev',
                              updateInfo: null,
                              progress: null,
                              error: null,
                              channel: 'stable',
                            }),
                          )}
                      >
                        <!-- i18n-ignore (dev-only) -->
                        Reset
                      </Button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          {/if}
        {/if}
      </main>
    </div>
  </div>
</div>
