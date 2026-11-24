<script lang="ts">
  import { SettingsDisclosure, SettingsSection } from '$lib/components/patterns/settings';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { selectIsReadyToInstall } from '$store/renderer/slices/auto-update/auto-update-selectors';
  import { installUpdate } from '$store/renderer/slices/auto-update/auto-update-slice';
  import { showReleaseNotes } from '$store/renderer/slices/release-notes/release-notes-slice';
  import AdministratorSettings from '$lib/components/settings/AdministratorSettings.svelte';
  import AIBehaviorEditor from '$lib/components/settings/AIBehaviorEditor.svelte';
  import AIBehaviorSidebar, {
    type AIBehaviorView,
  } from '$lib/components/settings/AIBehaviorSidebar.svelte';
  import { SettingsPage, type SettingsTab } from '$lib/components/patterns/settings';
  import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
  import MobileSettings from '$features/settings/MobileSettings.svelte';
  import GuestSessionsSettings from '$lib/components/settings/GuestSessionsSettings.svelte';
  import VoiceSettings from '$lib/components/settings/VoiceSettings.svelte';
  import AutocompleteSettings from '$lib/components/settings/AutocompleteSettings.svelte';
  import GitWorkspaceSettings from '$lib/components/settings/GitWorkspaceSettings.svelte';
  import OpenInAppsSettings from '$lib/components/settings/OpenInAppsSettings.svelte';
  import LanguageSettings from '$lib/components/settings/LanguageSettings.svelte';
  import GitHubLinkSettings from '$lib/components/settings/GitHubLinkSettings.svelte';
  import KeyboardShortcutsSettings from '$lib/components/settings/KeyboardShortcutsSettings.svelte';
  import NotificationSettings from '$lib/components/settings/NotificationSettings.svelte';
  import RtkSettings from '$lib/components/settings/RtkSettings.svelte';
  import HardwareConsoleSettings from '$lib/components/settings/HardwareConsoleSettings.svelte';
  import WorkspaceApiSettings from '$lib/components/settings/WorkspaceApiSettings.svelte';
  import AgentBackendSettings from '$lib/components/settings/AgentBackendSettings.svelte';
  import AgentFeaturesSettings from '$lib/components/settings/AgentFeaturesSettings.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { selectDaemonTransport } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { selectHostManagesConnections } from '$store/renderer/slices/connections/connections-selectors';
  import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectAgentPluginsSupported,
    selectPrincipalActionContext,
    selectHostAdministrationDenied,
  } from '$store/renderer/slices/principal/principal-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import {
    resetNotificationSettings,
    setAgentFontStyle,
    setNoteFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import DevicePasskeysSettings from '$features/passkeys/DevicePasskeysSettings.svelte';
  import {
    selectDevicePasskeys,
    selectDevicePasskeysAvailable,
  } from '$store/renderer/slices/device-passkeys/device-passkeys-selectors';
  import {
    devicePasskeyDeleteRequested,
    devicePasskeysRequested,
  } from '$store/renderer/slices/device-passkeys/device-passkeys-slice';
  import { m } from '$shared/paraglide/messages.js';
  import { resolveHashToTarget } from '$shared/app-ui-targets';
  import { isSettingsTab, resolveHashTab } from './settings-hash-tab';

  import SettingsSidebarBack from '$lib/components/settings/SettingsSidebarBack.svelte';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import DockLabSettings from '$lib/components/settings/DockLabSettings.svelte';
  import { isDockLabAvailable } from '$lib/dock-lab';
  import LabsSettings from '$lib/components/settings/LabsSettings.svelte';
  import TunnelRelaySettings from '$lib/components/settings/TunnelRelaySettings.svelte';
  import { getNavigatorHid } from '$features/hardware-console/device/platform';
  import { watchSupportedDevicePresence } from '$features/hardware-console/device/presence';
  import { getHardwareConsoleManager } from '$features/hardware-console/instance';
  import { navigateBackFromSettings } from '$lib/utils/workspace-navigation';
  import { workspaceIdFromRouteParam } from '$lib/utils/workspace-route-context';
  import AppearanceSettingsSection from '$features/settings/sections/AppearanceSettingsSection.svelte';
  import FontSettingsSection from '$features/settings/sections/FontSettingsSection.svelte';
  import UpdatesSettingsSection from '$features/settings/sections/UpdatesSettingsSection.svelte';
  import AnimationsSettingsSection from '$features/settings/sections/AnimationsSettingsSection.svelte';
  import DeveloperSettingsSection from '$features/settings/sections/DeveloperSettingsSection.svelte';
  import SettingsSearchField from '$features/settings/search/SettingsSearchField.svelte';
  import SettingsSearchResults from '$features/settings/search/SettingsSearchResults.svelte';
  import {
    SETTINGS_SEARCH_SECTIONS,
    searchSettings,
  } from '$features/settings/search/settings-search-index';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { store as appStore } from '$store/renderer/store';

  const isReadyToInstall$ = selectIsReadyToInstall();
  const daemonTransport$ = selectDaemonTransport();
  const isCollaboratorOnlyClient$ = selectIsCollaboratorOnlyClient();
  const collaborationContext$ = selectPrincipalActionContext();
  const hostAdministrationDenied$ = selectHostAdministrationDenied();
  const labsMultiplayerEnabled$ = selectLabsMultiplayerEnabled();
  const pluginsSupported$ = selectAgentPluginsSupported();
  // intent-web serves this page and owns the machines list: there is no
  // keychain sync and no mobile pairing on that host.
  const hostManagesConnections$ = selectHostManagesConnections();
  const devicePasskeys$ = selectDevicePasskeys();
  const devicePasskeysAvailable$ = selectDevicePasskeysAvailable();

  // UDS socket path of the connected intentd; null hides the Connection section
  // (external-ws, unknown transport, or missing target).
  const udsSocketPath = $derived(
    $daemonTransport$ &&
      ($daemonTransport$.mode === 'sidecar-uds' || $daemonTransport$.mode === 'external-uds') &&
      $daemonTransport$.target
      ? $daemonTransport$.target
      : null,
  );

  function resolveLegacyTab(tabParam: string): SettingsTab | undefined {
    if (tabParam === 'guest-sessions' || tabParam === 'sharing') return 'collaboration';
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

  function resolveTabFromUrl(tabParam: string | null, targetId: string): SettingsTab | null {
    const targetTab = resolveHashTab(targetId);
    if (targetTab) return targetTab;
    if (tabParam && isSettingsTab(tabParam)) return tabParam;
    return (tabParam && resolveLegacyTab(tabParam)) || null;
  }

  function getInitialTab(): SettingsTab | null {
    return resolveTabFromUrl(page.url.searchParams.get('tab'), page.url.hash.slice(1));
  }

  // With no destination in the URL, Providers opens only once the window is a
  // confirmed owner; otherwise Instructions, which every principal can see.
  let requestedTab = $state<SettingsTab | null>(getInitialTab());
  const activeTab = $derived<SettingsTab>(
    requestedTab ?? ($isCollaboratorOnlyClient$ ? 'agent-behavior' : 'providers'),
  );
  let contentScroll: HTMLDivElement;

  function resetContentScroll() {
    contentScroll?.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Update URL when tab changes
  function setActiveTab(tab: SettingsTab) {
    if (tab !== activeTab) {
      if (hashScrollTimer !== undefined) clearTimeout(hashScrollTimer);
      hashScrollTimer = undefined;
      resetContentScroll();
    }
    requestedTab = tab;
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
  // redirect waits for the connected principal: during boot the
  // collaborator-only default is a safe placeholder, not an answer, and
  // redirecting on it would drop a `?tab=providers` deep link for an
  // administrator (intent-hq/intent#5514).
  const hiddenTabs = $derived.by(() => {
    const tabs: SettingsTab[] = $isCollaboratorOnlyClient$ ? ['providers', 'connections'] : [];
    if (!$labsMultiplayerEnabled$) tabs.push('collaboration');
    if ($hostManagesConnections$) tabs.push('mobile');
    if (!$devicePasskeysAvailable$) tabs.push('passkeys');
    return tabs;
  });
  $effect(() => {
    if (
      hiddenTabs.includes(activeTab) &&
      (activeTab === 'collaboration' ||
        activeTab === 'mobile' ||
        (activeTab === 'passkeys' && $devicePasskeys$.status === 'unavailable') ||
        $hostAdministrationDenied$)
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
      if (nextTab !== requestedTab) {
        requestedTab = nextTab;
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
    searchQuery = '';
    aiBehaviorView = view;
    const tab = view.type === 'system-prompt' ? 'agent-behavior' : 'specialists';
    requestedTab = tab;

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
  let appearanceSectionRef: AppearanceSettingsSection | undefined = $state();

  // App version from Electron
  let appVersion = $state('');

  onMount(() => {
    // Build-time constant — the app version is FE-only (audit row 11), not a
    // daemon surface.
    appVersion = __APP_VERSION__;
  });

  // Device passkeys (Linux browser panel): the list also decides whether the tab shows.
  onMount(() => {
    if (isElectronPlatform() && /linux/i.test(navigator.userAgent)) {
      appStore.dispatch(devicePasskeysRequested());
    }
  });

  // Track supported-device presence for the Hardware section gate.
  onMount(() => {
    if (!webHidAvailable) return;
    return watchSupportedDevicePresence(
      getHardwareConsoleManager(),
      (present) => (hardwareDevicePresent = present),
    );
  });

  // Hash targets rendered inside the collapsed Inputs › Hardware "Creator Micro" disclosure.
  const HARDWARE_TARGETS = new Set(['hardware', 'hardware-encoder']);
  let hardwareOpen = $state(false);

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
    searchQuery = '';

    // Switch to the correct tab if needed
    const targetTab = resolveHashTab(targetId);
    if (targetTab && targetTab !== activeTab) {
      requestedTab = targetTab;
    }
    if (HARDWARE_TARGETS.has(targetId)) hardwareOpen = true;

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

  function handleResetInterfaceSystem() {
    // Reset theme
    appStore.dispatch(requestThemePreferenceChange('system'));
    // Clear custom color theme
    appearanceSectionRef?.clearTheme();
    // Reset font styles
    appStore.dispatch(setNoteFontStyle('sans'));
    appStore.dispatch(setAgentFontStyle('sans'));
    // Reset notification settings
    appStore.dispatch(resetNotificationSettings());
    // Reset Git & Workspace settings
    gitWorkspaceSettingsRef?.resetToDefaults();
  }
  // Settings search: one section registry drives the tab panes and the results.
  let searchQuery = $state('');
  const searching = $derived(searchQuery.trim().length > 0);

  function isAvailable(id: string): boolean {
    const section = SETTINGS_SEARCH_SECTIONS.find((entry) => entry.id === id);
    if (section && hiddenTabs.includes(section.tab)) return false;
    switch (id) {
      case 'menu-bar-auto-hide':
        return isElectronPlatform() && !isMacPlatform();
      case 'machine-rail':
        return isElectronPlatform();
      case 'dock-lab':
        return isDockLabAvailable();
      case 'plugins':
        return $pluginsSupported$;
      case 'tunnel-relay':
        return !$hostManagesConnections$;
      case 'hardware':
        return showHardwareSection;
      case 'connection':
        return udsSocketPath !== null;
      default:
        return true;
    }
  }

  const searchGroups = $derived(searching ? searchSettings(searchQuery, isAvailable) : []);
  const tabSections = $derived(
    SETTINGS_SEARCH_SECTIONS.filter((entry) => entry.tab === activeTab && isAvailable(entry.id)),
  );

  $effect(() => {
    if (searching) untrack(resetContentScroll);
  });
  $effect(() => {
    if (searchGroups.some((group) => group.hits.some((hit) => hit.section.id === 'hardware'))) {
      untrack(() => (hardwareOpen = true));
    }
  });

  function selectTab(tab: SettingsTab) {
    searchQuery = '';
    setActiveTab(tab);
  }

  function openSearchResult(tab: SettingsTab, sectionId: string) {
    selectTab(tab);
    const url = new URL(window.location.href);
    url.hash = sectionId;
    window.history.replaceState({}, '', url.toString());
    handleHashNavigation();
  }
</script>

{#snippet sidebarHeader()}
  <SettingsSidebarBack onBack={navigateBackFromSettings} />
  <SettingsSearchField value={searchQuery} onchange={(value) => (searchQuery = value)} />
{/snippet}

{#snippet agentsNavigation()}
  <AIBehaviorSidebar
    workspaceId={settingsWorkspaceId ?? undefined}
    activeView={aiBehaviorView}
    onSelect={selectAiBehaviorView}
    isActive={activeTab === 'specialists' && !searching}
  />
{/snippet}

{#snippet sidebarFooter()}
  <div
    class="shrink-0 border-t border-border dark:border-border px-5 py-4 type-caption text-subtle"
  >
    <div class="flex w-full items-baseline justify-between gap-2">
      <Button
        variant="plain"
        class="h-auto items-baseline gap-1.5 hover:text-foreground"
        tooltip={m.releaseNotes_modal_title_generic()}
        onclick={() => appStore.dispatch(showReleaseNotes())}
      >
        <strong class="text-foreground">Intent</strong><!-- i18n-ignore (brand name) -->
        <span>v{appVersion || '...'}</span>
      </Button>
      <a
        href="https://www.intentapp.dev/docs"
        target="_blank"
        rel="noopener noreferrer"
        class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        >{m.settings_footer_support()}</a
      >
    </div>
    {#if $isReadyToInstall$}
      <Button
        variant="plain"
        class="type-caption mt-1.5 h-auto cursor-pointer border-none bg-transparent p-0 font-medium text-primary-ink underline hover:text-primary-ink/80"
        onclick={() => appStore.dispatch(installUpdate())}
      >
        {m.settings_footer_restartToUpdate_label()}
      </Button>
    {/if}
  </div>
{/snippet}

{#snippet titledCard(id: string, title: string, body: Snippet)}
  <div {id} data-highlight-id={id} use:highlightTarget>
    <h2 class="type-title mb-3 text-foreground">{title}</h2>
    <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
      <section data-slot="settings-section-body" class="px-6 py-4">{@render body()}</section>
    </div>
  </div>
{/snippet}

{#snippet openInBody()}<OpenInAppsSettings />{/snippet}
{#snippet githubLinksBody()}<GitHubLinkSettings />{/snippet}
{#snippet languageBody()}<LanguageSettings />{/snippet}
{#snippet agentBackendBody()}<AgentBackendSettings />{/snippet}
{#snippet rtkBody()}<RtkSettings />{/snippet}

<!-- Every searchable section; `show` picks the rows of sections that have them. -->
{#snippet settingsSection(id: string, show: (row: string) => boolean)}
  {#if id === 'providers' || id === 'utility-default-model'}
    <AdministratorSettings tab="providers" only={id} workspaceId={settingsWorkspaceId} />
  {:else if id === 'integrations' || id === 'mcp-servers' || id === 'plugins'}
    <AdministratorSettings tab="connections" only={id} workspaceId={settingsWorkspaceId} />
  {:else if id === 'devices'}
    <div id="devices" class="scroll-mt-20">
      <DevicesSettings />
    </div>
  {:else if id === 'mobile'}
    <div id="mobile" data-highlight-id="mobile" use:highlightTarget class="scroll-mt-20">
      <div id="websocket-api" data-highlight-id="websocket-api" use:highlightTarget>
        <MobileSettings />
      </div>
    </div>
  {:else if id === 'collaboration'}
    <!-- Guest sessions (multiplayer w4: hosting roster + joined hosts) -->
    <div id="collaboration" class="scroll-mt-20">
      {#key $collaborationContext$}<GuestSessionsSettings />{/key}
    </div>
  {:else if id === 'passkeys'}
    <div id="passkeys" class="scroll-mt-20">
      <DevicePasskeysSettings
        passkeys={$devicePasskeys$}
        onRetry={() => appStore.dispatch(devicePasskeysRequested())}
        onDelete={(credentialId) => appStore.dispatch(devicePasskeyDeleteRequested(credentialId))}
      />
    </div>
  {:else if id === 'git-workspace'}
    <div id="git-workspace" data-highlight-id="git-workspace" use:highlightTarget>
      <GitWorkspaceSettings bind:this={gitWorkspaceSettingsRef} />
    </div>
  {:else if id === 'theme'}
    <AppearanceSettingsSection bind:this={appearanceSectionRef} {show} />
  {:else if id === 'font-style'}
    <FontSettingsSection {show} />
  {:else if id === 'language'}
    {@render titledCard('language', m.settings_language_section_title(), languageBody)}
  {:else if id === 'updates'}
    <UpdatesSettingsSection {show} />
  {:else if id === 'open-in'}
    {@render titledCard('open-in', m.settings_section_openIn(), openInBody)}
  {:else if id === 'github-link-action'}
    {@render titledCard(
      'github-link-action',
      m.settings_githubLinks_section_title(),
      githubLinksBody,
    )}
  {:else if id === 'notifications'}
    <NotificationSettings />
  {:else if id === 'licenses'}
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
  {:else if id === 'global-instructions'}
    <div
      id="global-instructions"
      data-highlight-id="global-instructions"
      use:highlightTarget
      class="min-w-0"
    >
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_globalInstructions()}
      </h2>
      <AIBehaviorEditor activeView={{ type: 'system-prompt' }} workspaceId={settingsWorkspaceId} />
    </div>
  {:else if id === 'performance'}
    <AnimationsSettingsSection {show} />
  {:else if id === 'agent-backend'}
    {@render titledCard('agent-backend', m.settings_section_agentBackend(), agentBackendBody)}
  {:else if id === 'cli-optimization'}
    {@render titledCard('cli-optimization', m.settings_section_cliOptimization(), rtkBody)}
  {:else if id === 'workspace-api'}
    <!-- Tool Output & Retention (anchor id kept as workspace-api for deep links) -->
    <div id="workspace-api" data-highlight-id="workspace-api" use:highlightTarget>
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_workspaceApi()}
      </h2>
      <WorkspaceApiSettings />
    </div>
  {:else if id === 'agent-features'}
    <AgentFeaturesSettings />
  {:else if id === 'dock-lab'}
    <div id="dock-lab" class="scroll-mt-20">
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_dockLab_label()}
      </h2>
      <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
        <DockLabSettings />
      </div>
    </div>
  {:else if id === 'voice'}
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
  {:else if id === 'autocomplete'}
    <AutocompleteSettings />
  {:else if id === 'keyboard-shortcuts'}
    <div id="keyboard-shortcuts" data-highlight-id="keyboard-shortcuts" use:highlightTarget>
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_keyboardShortcuts()}
      </h2>
      <div data-slot="settings-section-body" class="rounded-xl bg-card px-6 py-4">
        <KeyboardShortcutsSettings />
      </div>
    </div>
  {:else if id === 'hardware'}
    <!-- Hardware (only when a supported device is detectable) -->
    <div id="hardware" data-highlight-id="hardware" use:highlightTarget>
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_section_hardware()}
      </h2>
      <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
        <section data-slot="settings-section-body" class="px-6 py-2">
          <SettingsDisclosure
            label={m.settings_hardware_creatorMicro_label()}
            flush
            bind:open={hardwareOpen}
          >
            <div class="type-body -mr-8 -mb-5 -ml-6 mt-2 border-t border-border text-foreground">
              <HardwareConsoleSettings embedded />
            </div>
          </SettingsDisclosure>
        </section>
      </div>
    </div>
  {:else if id === 'labs'}
    <LabsSettings />
  {:else if id === 'tunnel-relay'}
    <!-- Shown where Mobile is; a host that manages connections owns the relay too. -->
    <TunnelRelaySettings />
  {:else if id === 'connection' && udsSocketPath}
    <!-- Connection (UDS only; hidden for WS/unknown transports) -->
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
  {:else if id === 'reset'}
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
  {/if}
{/snippet}

<SettingsPage
  title={m.settings_page_title()}
  {activeTab}
  onSelect={selectTab}
  {searching}
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
        class="mx-auto flex min-h-full {activeTab === 'specialists' && !searching
          ? 'max-w-6xl xl:h-full xl:min-h-0 xl:py-8'
          : 'max-w-4xl'} flex-col gap-6 pr-8 pl-6 py-6"
        aria-labelledby="settings-page-title"
      >
        <h1 id="settings-page-title" class="sr-only">{m.settings_page_title()}</h1>
        {#if searching}
          <SettingsSearchResults groups={searchGroups} onOpen={openSearchResult}>
            {#snippet section(hit)}
              {@render settingsSection(
                hit.section.id,
                (row) => isAvailable(row) && (hit.rows === null || hit.rows.includes(row)),
              )}
            {/snippet}
          </SettingsSearchResults>
        {:else if activeTab === 'providers' || activeTab === 'connections'}
          <!-- Administrator-owned; withheld from collaborator-only clients -->
          {#if !hiddenTabs.includes(activeTab)}
            <AdministratorSettings tab={activeTab} workspaceId={settingsWorkspaceId} />
          {/if}
        {:else if activeTab === 'specialists'}
          <!-- Hidden specialist editor destination -->
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
        {:else}
          {#each tabSections as entry (entry.id)}
            {@render settingsSection(entry.id, isAvailable)}
          {/each}
          <!-- Developer section (dev mode only; never searchable) -->
          {#if activeTab === 'advanced' && isDevMode}
            <DeveloperSettingsSection />
          {/if}
        {/if}
      </main>
    </div>
  </div>
</SettingsPage>
