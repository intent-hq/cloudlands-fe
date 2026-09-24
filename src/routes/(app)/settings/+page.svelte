<script lang="ts">
  import { SettingsFieldRow, SettingsSection } from '$lib/components/patterns/settings';
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
  import AdministratorSettings from '$lib/components/settings/AdministratorSettings.svelte';
  import AIBehaviorEditor from '$lib/components/settings/AIBehaviorEditor.svelte';
  import AIBehaviorSidebar, {
    type AIBehaviorView,
  } from '$lib/components/settings/AIBehaviorSidebar.svelte';
  import { SettingsPage, type SettingsTab } from '$lib/components/patterns/settings';
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import GuestSessionsSettings from '$lib/components/settings/GuestSessionsSettings.svelte';
  import BackendSyncSettings from '$lib/components/settings/BackendSyncSettings.svelte';
  import VoiceSettings from '$lib/components/settings/VoiceSettings.svelte';
  import GitWorkspaceSettings from '$lib/components/settings/GitWorkspaceSettings.svelte';
  import LegacyImportSettings from '$lib/components/settings/LegacyImportSettings.svelte';
  import OpenInAppsSettings from '$lib/components/settings/OpenInAppsSettings.svelte';
  import LanguageSettings from '$lib/components/settings/LanguageSettings.svelte';
  import GitHubLinkSettings from '$lib/components/settings/GitHubLinkSettings.svelte';
  import KeyboardShortcutsSettings from '$lib/components/settings/KeyboardShortcutsSettings.svelte';
  import ColorThemeSettings from '$lib/components/settings/ColorThemeSettings.svelte';
  import ReduceMotionOnBatterySettings from '$lib/components/settings/ReduceMotionOnBatterySettings.svelte';
  import NotificationSettings from '$lib/components/settings/NotificationSettings.svelte';
  import RtkSettings from '$lib/components/settings/RtkSettings.svelte';
  import HardwareConsoleSettings from '$lib/components/settings/HardwareConsoleSettings.svelte';
  import WorkspaceApiSettings from '$lib/components/settings/WorkspaceApiSettings.svelte';
  import AgentBackendSettings from '$lib/components/settings/AgentBackendSettings.svelte';
  import AgentFeaturesSettings from '$lib/components/settings/AgentFeaturesSettings.svelte';
  import { keepToggleSelected } from '$lib/components/settings/utils/keep-toggle-selected';
  import Button from '$lib/components/ui/button/button.svelte';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { Switch } from '$lib/components/ui/switch';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { selectDaemonTransport } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectWindowIdentitySettled } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import { selectThemePreference } from '$store/renderer/slices/theme/theme-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemePreference } from '$store/renderer/slices/theme/theme-types';
  import {
    resetNotificationSettings,
    setAgentFontStyle,
    setChatAuroraEnabled,
    setCodeFontFamily,
    setLabsMultiplayerEnabled,
    setNoteFontStyle,
    setShellTransparencyEnabled,
    setUpdateChannel,
    type AgentFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectAgentFontStyle,
    selectChatAuroraEnabled,
    selectCodeFontFamily,
    selectCodeFontFamilyCSS,
    selectCodeFontOptions,
    selectIsNoteMonospace,
    selectLabsSettingsVisible,
    selectLabsMultiplayerEnabled,
    selectNoteFontStyle,
    selectShellTransparencyEnabled,
    selectUpdateChannel,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { isUpdateChannel } from '$features/auto-update/types';

  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import { resolveHashToTarget } from '$shared/app-ui-targets';

  import SettingsSidebarBack from '$lib/components/settings/SettingsSidebarBack.svelte';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { getNavigatorHid } from '$features/hardware-console/device/platform';
  import { watchSupportedDevicePresence } from '$features/hardware-console/device/presence';
  import { getHardwareConsoleManager } from '$features/hardware-console/instance';
  import { navigateBackFromSettings } from '$lib/utils/workspace-navigation';
  import { workspaceIdFromRouteParam } from '$lib/utils/workspace-route-context';
  import { onMount, untrack } from 'svelte';
  import { store as appStore } from '$store/renderer/store';

  const isReadyToInstall$ = selectIsReadyToInstall();
  const autoUpdateStatus$ = selectAutoUpdateStatus();
  const updateChannel$ = selectUpdateChannel();
  const noteFontStyle = selectNoteFontStyle();
  const isNoteMonospace = selectIsNoteMonospace();
  const agentFontStyle = selectAgentFontStyle();
  const codeFontFamily = selectCodeFontFamily();
  const codeFontFamilyCSS = selectCodeFontFamilyCSS();
  const codeFontOptions = selectCodeFontOptions();
  const chatAuroraEnabled = selectChatAuroraEnabled();
  const shellTransparencyEnabled = selectShellTransparencyEnabled();
  const labsMultiplayerEnabled = selectLabsMultiplayerEnabled();
  const labsSettingsVisible = selectLabsSettingsVisible();
  const themePreference = selectThemePreference();
  const daemonTransport$ = selectDaemonTransport();
  const isCollaboratorOnlyClient$ = selectIsCollaboratorOnlyClient();
  const windowIdentitySettled$ = selectWindowIdentitySettled();

  // UDS socket path of the connected intentd; null hides the Connection section
  // (external-ws, unknown transport, or missing target).
  const udsSocketPath = $derived(
    $daemonTransport$ &&
      ($daemonTransport$.mode === 'sidecar-uds' || $daemonTransport$.mode === 'external-uds') &&
      $daemonTransport$.target
      ? $daemonTransport$.target
      : null,
  );

  const validTabs: SettingsTab[] = [
    'display',
    'app-behavior',
    'agent-behavior',
    'providers',
    'connections',
    'devices',
    'guest-sessions',
    'setup',
    'advanced',
    'labs',
    'input',
    'specialists',
  ];

  function isSettingsTab(tab: string): tab is SettingsTab {
    return validTabs.includes(tab as SettingsTab) && (tab !== 'labs' || $labsSettingsVisible);
  }

  const hashToTab: Record<string, SettingsTab> = {
    'default-model': 'providers',
    'global-instructions': 'agent-behavior',
    specialists: 'agent-behavior',
    agents: 'agent-behavior',
    'all-agents': 'agent-behavior',
    'create-specialist': 'specialists',
    'quickActions.defaultModel': 'providers',
    'backgroundAgents.defaultModel': 'providers',
    providers: 'providers',
    integrations: 'connections',
    devices: 'devices',
    machines: 'devices',
    'backend-sync': 'devices',
    'websocket-api': 'devices',
    'remote-access': 'devices',
    'guest-sessions': 'guest-sessions',
    sharing: 'guest-sessions',
    voice: 'input',
    'keyboard-shortcuts': 'input',
    'git-workspace': 'setup',
    git: 'setup',
    shell: 'setup',
    workspace: 'setup',
    notifications: 'app-behavior',
    licenses: 'app-behavior',
    updates: 'app-behavior',
    language: 'display',
    theme: 'display',
    appearance: 'display',
    'chat-aurora': 'display',
    'translucent-window': 'display',
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
    connection: 'advanced',
    data: 'advanced',
    reset: 'advanced',
    general: 'advanced',
    developer: 'advanced',
    labs: 'labs',
    'labs-multiplayer': 'labs',
    multiplayer: 'labs',
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
  let localSettingsRequested = $state(0);
  let contentScroll: HTMLDivElement;

  function resetContentScroll() {
    contentScroll?.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Update URL when tab changes
  function setActiveTab(tab: SettingsTab) {
    if (tab === 'labs' && !$labsSettingsVisible) tab = 'display';
    if (tab !== activeTab) {
      if (hashScrollTimer !== undefined) clearTimeout(hashScrollTimer);
      hashScrollTimer = undefined;
      resetContentScroll();
    }
    activeTab = tab;
    // Update URL with the new tab, preserving other params
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      url.hash = '';
      window.history.replaceState({}, '', url.toString());
    }
  }

  // Provider keys and GitHub/Linear/Sentry connections are administrator-owned
  // daemon state (multiplayer w3): a collaborator-only client cannot read or
  // change them, so those sections are withheld and their tabs redirect. The
  // redirect waits for the window identity to settle: during boot the
  // collaborator-only default is a safe placeholder, not an answer, and
  // redirecting on it would drop a `?tab=providers` deep link for an
  // administrator (intent-hq/intent#5514).
  const hiddenTabs = $derived<readonly SettingsTab[]>([
    ...($isCollaboratorOnlyClient$ ? (['providers', 'connections'] as const) : []),
    ...(!$labsSettingsVisible ? (['labs'] as const) : []),
  ]);
  $effect(() => {
    if (
      (activeTab === 'labs' && !$labsSettingsVisible) ||
      ($windowIdentitySettled$ && hiddenTabs.includes(activeTab))
    ) {
      setActiveTab('display');
    }
  });

  // Keep the rendered pane in sync when SvelteKit navigates within the mounted settings page.
  $effect(() => {
    const tabParam = page.url.searchParams.get('tab');
    const targetId = page.url.hash.slice(1);
    const nextTab = resolveTabFromUrl(tabParam, targetId);

    untrack(() => {
      if (nextTab !== activeTab) {
        activeTab = nextTab;
        if (!targetId) resetContentScroll();
      }
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

  function handleNoteFontChange(value: string | string[]) {
    appStore.dispatch(setNoteFontStyle(value as 'sans' | 'monospace'));
  }

  function handleAgentFontChange(value: string | string[]) {
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
    if (resolveHashToTarget(targetId)?.id === 'websocket-api') localSettingsRequested += 1;

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

  function handleThemeChange(newTheme: string | string[]) {
    appStore.dispatch(requestThemePreferenceChange(newTheme as ThemePreference));
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

{#snippet sidebarHeader()}
  <SettingsSidebarBack onBack={navigateBackFromSettings} />
{/snippet}

{#snippet agentsNavigation()}
  <AIBehaviorSidebar
    activeView={aiBehaviorView}
    onSelect={selectAiBehaviorView}
    isActive={activeTab === 'specialists'}
  />
{/snippet}

{#snippet sidebarFooter()}
  <div
    class="shrink-0 border-t border-border dark:border-border px-5 py-4 type-caption text-subtle"
  >
    <div class="flex w-full items-baseline justify-between gap-2">
      <div class="flex items-baseline gap-1.5">
        <!-- i18n-ignore (brand name) -->
        <strong class="text-foreground">Intent</strong>
        <span>v{appVersion || '...'}</span>
      </div>
      {#if $isReadyToInstall$}
        <Button
          variant="plain"
          class="type-body cursor-pointer border-none bg-transparent p-0 font-medium text-primary-ink underline hover:text-primary-ink/80"
          onclick={() => appStore.dispatch(installUpdate())}
        >
          {m.settings_footer_updateAvailable()}
        </Button>
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
  </div>
{/snippet}

<SettingsPage
  title={m.settings_page_title()}
  {activeTab}
  onSelect={setActiveTab}
  {agentsNavigation}
  {hiddenTabs}
  {sidebarHeader}
  {sidebarFooter}
>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      bind:this={contentScroll}
      data-slot="settings-page-content-scroll"
      class="min-h-0 flex-1 overflow-auto"
    >
      <main
        class="mx-auto flex min-h-full {activeTab === 'specialists'
          ? 'max-w-6xl xl:h-full xl:min-h-0 xl:py-8'
          : 'max-w-4xl'} flex-col gap-6 pr-8 pl-6 py-6"
        aria-labelledby="settings-page-title"
      >
        <h1 id="settings-page-title" class="sr-only">{m.settings_page_title()}</h1>
        <!-- Providers / Connections (administrator-owned; withheld from collaborator-only clients) -->
        {#if (activeTab === 'providers' || activeTab === 'connections') && !hiddenTabs.includes(activeTab)}
          <AdministratorSettings tab={activeTab} workspaceId={settingsWorkspaceId} />
        {/if}

        <!-- Devices -->
        {#if activeTab === 'devices'}
          <div id="devices" class="scroll-mt-20">
            <div id="websocket-api" data-highlight-id="websocket-api" use:highlightTarget>
              <DevicesSettings bind:localSettingsRequested />
            </div>
          </div>

          <!-- Backend sync (iCloud Keychain) -->
          <div id="backend-sync" class="scroll-mt-20">
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_backendSync()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <BackendSyncSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- Guest sessions (multiplayer w4: hosting roster + joined hosts) -->
        {#if activeTab === 'guest-sessions'}
          <div id="guest-sessions" class="scroll-mt-20">
            <GuestSessionsSettings />
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
                <RtkSettings />
              {/snippet}
            </GitWorkspaceSettings>
          </div>
        {/if}

        <!-- Display -->
        {#if activeTab === 'display'}
          <!-- Theme -->
          <div id="theme" data-highlight-id="appearance" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_appearance()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <SettingsFieldRow id="settings-theme-label-field" label={m.settings_theme_label()}>
                  <ToggleGroup.Root
                    variant="outline"
                    type="single"
                    bind:value={() => $themePreference, handleThemeChange}
                    size="sm"
                    aria-label={m.settings_theme_label()}
                    class="ml-4 shrink-0"
                  >
                    {#each themeOptions as option (option.value)}
                      <ToggleGroup.Item value={option.value} {...keepToggleSelected}>
                        {option.label}
                      </ToggleGroup.Item>
                    {/each}
                  </ToggleGroup.Root>
                </SettingsFieldRow>
              </section>
              <section
                id="color-theme"
                data-highlight-id="color-theme"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <ColorThemeSettings bind:this={colorThemeSettingsRef} />
              </section>
              <section
                id="chat-aurora"
                data-highlight-id="chat-aurora"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <SettingsFieldRow
                  id="settings-appearance-chatAurora-label-field"
                  label={m.settings_appearance_chatAurora_label()}
                  description={m.settings_appearance_chatAurora_description()}
                >
                  <Switch
                    id="chat-aurora-switch"
                    size="sm"
                    class="mb-auto"
                    checked={$chatAuroraEnabled}
                    onCheckedChange={(enabled) => appStore.dispatch(setChatAuroraEnabled(enabled))}
                    ariaLabel={m.settings_appearance_chatAurora_label()}
                  />
                </SettingsFieldRow>
              </section>
              <section
                id="translucent-window"
                data-highlight-id="translucent-window"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <SettingsFieldRow
                  id="settings-appearance-translucentWindow-label-field"
                  label={m.settings_appearance_translucentWindow_label()}
                  description={m.settings_appearance_translucentWindow_description()}
                >
                  <Switch
                    id="translucent-window-switch"
                    size="sm"
                    class="mb-auto"
                    checked={$shellTransparencyEnabled}
                    onCheckedChange={(enabled) =>
                      appStore.dispatch(setShellTransparencyEnabled(enabled))}
                    ariaLabel={m.settings_appearance_translucentWindow_label()}
                  />
                </SettingsFieldRow>
              </section>
              <section
                id="reduce-motion-on-battery"
                data-highlight-id="reduce-motion-on-battery"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <ReduceMotionOnBatterySettings />
              </section>
            </div>
          </div>

          <div id="font-style" data-highlight-id="font-style" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_fontStyle()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section
                id="note-font"
                data-highlight-id="note-font"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <SettingsFieldRow
                  id="settings-font-notes-label-field"
                  label={m.settings_font_notes_label()}
                >
                  {#snippet descriptionContent()}<span
                      class="type-body text-subtle mt-0.5 transition-all duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
                      class:font-mono={$isNoteMonospace}
                    >
                      {m.settings_font_notes_description()}
                    </span>{/snippet}
                  <ToggleGroup.Root
                    variant="outline"
                    type="single"
                    bind:value={() => $noteFontStyle, handleNoteFontChange}
                    size="sm"
                    aria-label={m.settings_font_notes_label()}
                    class="ml-4 shrink-0"
                  >
                    {#each fontStyleOptions as option (option.value)}
                      <ToggleGroup.Item value={option.value} {...keepToggleSelected}>
                        {option.label}
                      </ToggleGroup.Item>
                    {/each}
                  </ToggleGroup.Root>
                </SettingsFieldRow>
              </section>
              <section
                id="agent-chat-font"
                data-highlight-id="agent-chat-font"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <SettingsFieldRow
                  id="settings-font-agentChat-label-field"
                  label={m.settings_font_agentChat_label()}
                >
                  {#snippet descriptionContent()}<span
                      class="type-body text-subtle mt-0.5 transition-all duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
                      class:font-mono={$agentFontStyle === 'monospace'}
                    >
                      {m.settings_font_agentChat_description()}
                    </span>{/snippet}
                  <ToggleGroup.Root
                    variant="outline"
                    type="single"
                    bind:value={() => $agentFontStyle, handleAgentFontChange}
                    size="sm"
                    aria-label={m.settings_font_agentChat_label()}
                    class="ml-4 shrink-0"
                  >
                    {#each fontStyleOptions as option (option.value)}
                      <ToggleGroup.Item value={option.value} {...keepToggleSelected}>
                        {option.label}
                      </ToggleGroup.Item>
                    {/each}
                  </ToggleGroup.Root>
                </SettingsFieldRow>
              </section>
              <section
                id="code-font"
                data-highlight-id="code-font"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <SettingsFieldRow
                  id="settings-font-code-label-field"
                  label={m.settings_font_code_label()}
                  description={m.settings_font_code_description()}
                >
                  {#snippet control({ labelId, descriptionId })}
                    <div class="w-[180px] flex-shrink-0">
                      <Select.Root value={$codeFontFamily} onchange={handleCodeFontChange}>
                        <Select.Trigger aria-labelledby={labelId} aria-describedby={descriptionId}>
                          <span class="truncate" style:font-family={$codeFontFamilyCSS}>
                            {$codeFontOptions.find((option) => option.value === $codeFontFamily)
                              ?.label ?? $codeFontFamily}
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
                  {/snippet}
                </SettingsFieldRow>
              </section>
            </div>
          </div>

          <!-- Language -->
          <div id="language" data-highlight-id="language" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_language_section_title()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <LanguageSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- App Behavior -->
        {#if activeTab === 'app-behavior'}
          <!-- Updates -->
          <div id="updates" data-highlight-id="updates" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_updates()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <SettingsFieldRow
                  id="settings-updateChannel-label-field"
                  label={m.settings_updateChannel_label()}
                  description={m.settings_updateChannel_description()}
                >
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
                </SettingsFieldRow>
              </section>
            </div>
          </div>

          <div id="open-in" data-highlight-id="open-in" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_openIn()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <OpenInAppsSettings />
              </section>
            </div>
          </div>
          <div id="github-link-action" data-highlight-id="github-link-action" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_githubLinks_section_title()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <GitHubLinkSettings />
              </section>
            </div>
          </div>
          <NotificationSettings />

          <SettingsSection id="licenses" title={m.settings_licenses_title_label()}>
            <div class="px-6 py-4">
              <a
                href="https://github.com/tailscale/tailcat/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                class="type-body cursor-pointer text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >{m.settings_licenses_tailcat_description()}</a
              >
            </div>
          </SettingsSection>
        {/if}

        <!-- Agent Behavior -->
        {#if activeTab === 'agent-behavior'}
          <div
            id="global-instructions"
            data-highlight-id="global-instructions"
            use:highlightTarget
            class="min-w-0"
          >
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_globalInstructions()}
            </h2>
            <AIBehaviorEditor
              activeView={{ type: 'system-prompt' }}
              workspaceId={settingsWorkspaceId}
            />
          </div>

          <AgentFeaturesSettings />
        {/if}

        <!-- Input -->
        {#if activeTab === 'input'}
          <div id="keyboard-shortcuts" data-highlight-id="keyboard-shortcuts" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_keyboardShortcuts()}
            </h2>
            <div data-slot="settings-section-body" class="rounded-xl bg-card px-6 py-4">
              <KeyboardShortcutsSettings />
            </div>
          </div>

          <div id="voice" data-highlight-id="voice" use:highlightTarget class="scroll-mt-20">
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_voice()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <VoiceSettings />
              </section>
            </div>
          </div>
        {/if}

        <!-- Advanced -->
        {#if activeTab === 'advanced'}
          <!-- Agent Backend -->
          <div id="agent-backend" data-highlight-id="agent-backend" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_agentBackend()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <AgentBackendSettings />
              </section>
            </div>
          </div>

          <!-- Tool Output & Retention (anchor id kept as workspace-api for deep links) -->
          <div id="workspace-api" data-highlight-id="workspace-api" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_workspaceApi()}
            </h2>
            <WorkspaceApiSettings />
          </div>

          <!-- Connection (UDS only; hidden for WS/unknown transports) -->
          {#if udsSocketPath}
            <div id="connection" data-highlight-id="connection" use:highlightTarget>
              <h2 class="type-title mb-3 text-foreground">
                {m.settings_section_connection()}
              </h2>
              <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
                <section data-slot="settings-section-body" class="px-6 py-4">
                  <div class="flex items-center justify-between gap-4">
                    <div class="min-w-0">
                      <p class="type-body font-medium text-foreground">
                        {m.settings_connection_socket_label()}
                      </p>
                      <p class="type-body text-subtle mt-0.5 font-mono select-text break-all">
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
            <div id="hardware" data-highlight-id="hardware" use:highlightTarget>
              <h2 class="type-title mb-3 text-foreground">
                {m.settings_section_hardware()}
              </h2>
              <HardwareConsoleSettings />
            </div>
          {/if}

          <!-- Data -->
          <div id="data" data-highlight-id="data" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_data()}
            </h2>
            <LegacyImportSettings />
          </div>

          <!-- Reset -->
          <div id="reset" data-highlight-id="general" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_reset()}
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section data-slot="settings-section-body" class="px-6 py-4">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="type-body font-medium text-foreground">
                      {m.settings_reset_label()}
                    </p>
                    <p class="type-body text-subtle">
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
            <div id="developer" data-highlight-id="developer" use:highlightTarget>
              <h2 class="type-title mb-3 text-foreground">
                <!-- i18n-ignore (dev-only) -->
                Developer
              </h2>
              <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
                <section data-slot="settings-section-body" class="px-6 py-4">
                  <div class="flex flex-col gap-2">
                    <!-- i18n-ignore (dev-only) -->
                    <span class="type-body font-medium">Update Toast Simulation</span>
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

        <!-- Labs -->
        {#if activeTab === 'labs' && $labsSettingsVisible}
          <div id="labs" data-highlight-id="labs" use:highlightTarget>
            <h2 class="type-title mb-3 text-foreground">
              {m.settings_section_labs()}
            </h2>
            <p class="type-body text-subtle mb-3">
              {m.settings_labs_disclaimer_description()}
            </p>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section
                id="labs-multiplayer"
                data-highlight-id="labs-multiplayer"
                use:highlightTarget
                data-slot="settings-section-body"
                class="px-6 py-4"
              >
                <SettingsFieldRow
                  id="settings-labs-multiplayer-label-field"
                  label={m.settings_labs_multiplayer_label()}
                  description={m.settings_labs_multiplayer_description()}
                  experimental
                >
                  <Switch
                    id="labs-multiplayer-switch"
                    size="sm"
                    class="mb-auto"
                    checked={$labsMultiplayerEnabled}
                    onCheckedChange={(enabled) =>
                      appStore.dispatch(setLabsMultiplayerEnabled(enabled))}
                    ariaLabel={m.settings_labs_multiplayer_label()}
                  />
                </SettingsFieldRow>
              </section>
            </div>
          </div>
        {/if}
      </main>
    </div>
  </div>
</SettingsPage>
