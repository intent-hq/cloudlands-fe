<script lang="ts">
  import { logger } from '../../shared/logger';

  import { page } from '$app/state';
  import { autoUpdateStore } from '$features/auto-update/auto-update.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import ProviderSelector from '$lib/components/settings/ProviderSelector.svelte';
  import AIBehaviorEditor from '$lib/components/settings/AIBehaviorEditor.svelte';
  import AIBehaviorSidebar, {
    type AIBehaviorView,
  } from '$lib/components/settings/AIBehaviorSidebar.svelte';
  import ConnectionsSettings from '$lib/components/settings/ConnectionsSettings.svelte';
  import GitWorkspaceSettings from '$lib/components/settings/GitWorkspaceSettings.svelte';
  import McpServersSettings from '$lib/components/settings/McpServersSettings.svelte';
  import BackgroundAgentSettings from '$lib/components/settings/BackgroundAgentSettings.svelte';
  import ColorThemeSettings from '$lib/components/settings/ColorThemeSettings.svelte';
  import NotificationSettings from '$lib/components/settings/NotificationSettings.svelte';
  import RtkSettings from '$lib/components/settings/RtkSettings.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectIsProviderActive } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { resetNotificationSettings } from '$lib/store/slices/notification-settings/notification-settings-slice';
  import { setNoteFontStyle } from '$lib/store/slices/font-settings/font-settings-slice';
  import { selectNoteFontStyle, selectIsNoteMonospace } from '$lib/store/slices/font-settings/font-settings-selectors';
  import { setAgentFontStyle, type AgentFontStyle } from '$lib/store/slices/font-settings/font-settings-slice';
  import { selectAgentFontStyle } from '$lib/store/slices/font-settings/font-settings-selectors';
  import { getDispatch } from '$lib/store/utils/utils';
  import { setCodeFontFamily } from '$lib/store/slices/font-settings/font-settings-slice';
  import { selectCodeFontFamily, selectCodeFontFamilyCSS, selectCodeFontFamilyLabel, selectCodeFontOptions } from '$lib/store/slices/font-settings/font-settings-selectors';
  import { Select } from '$lib/components/ui/select';

  import { isMacPlatform } from '$lib/utils/shortcuts';
  import type { Theme } from '$lib/utils/theme';
  import { themeManager } from '$lib/utils/theme';
  import { track } from '$lib/services/analytics';
  import { flashCopied } from '$lib/components/ui/tooltip/link-tooltip-state.svelte';
  import {
    getSettingsPreviousPath,
    navigateBackFromSettings,
  } from '$lib/utils/workspace-navigation';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  const settingsDispatch = getDispatch();
  const noteFontStyle = selectNoteFontStyle();
  const isNoteMonospace = selectIsNoteMonospace();
  const agentFontStyle = selectAgentFontStyle();
  const codeFontFamily = selectCodeFontFamily();
  const codeFontFamilyCSS = selectCodeFontFamilyCSS();
  const codeFontFamilyLabel = selectCodeFontFamilyLabel();
  const codeFontOptions = selectCodeFontOptions();

  // Tab types
  type SettingsTab = 'accounts' | 'agents' | 'setup' | 'fonts-colors' | 'general';

  // Valid tab IDs for validation
  const validTabs: SettingsTab[] = ['accounts', 'agents', 'setup', 'fonts-colors', 'general'];

  // Legacy tab mapping for backwards compatibility with old URLs
  const legacyTabMap: Record<string, SettingsTab> = {
    connections: 'accounts',
    'interface-system': 'fonts-colors',
  };

  // Get initial tab from URL or default to Accounts
  function getInitialTab(): SettingsTab {
    const tabParam = page.url.searchParams.get('tab');
    if (tabParam && validTabs.includes(tabParam as SettingsTab)) {
      return tabParam as SettingsTab;
    }
    // Handle legacy tab IDs
    if (tabParam && legacyTabMap[tabParam]) {
      return legacyTabMap[tabParam];
    }
    return 'accounts';
  }

  // Current active tab - initialized from URL or default to Agents
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

  // Tab definitions
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'accounts', label: 'Accounts' },
    { id: 'agents', label: 'Agents' },
    { id: 'setup', label: 'Workspace Setup' },
    { id: 'fonts-colors', label: 'Fonts & Colors' },
    { id: 'general', label: 'General' },
  ];

  // Get specialist ID from URL query parameter for auto-selecting
  const initialSpecialistId = $derived(page.url.searchParams.get('specialist'));
  // Get view parameter for direct navigation (e.g., ?view=create-specialist)
  const initialView = $derived(page.url.searchParams.get('view'));

  // Agents sidebar view state
  let aiBehaviorView = $state<AIBehaviorView>({ type: 'system-prompt' });

  // Initialize view from URL parameter if present (only on initial load)
  let hasInitializedFromUrl = false;
  $effect(() => {
    if (hasInitializedFromUrl) return;
    if (initialView === 'create-specialist') {
      setActiveTab('agents');
      aiBehaviorView = { type: 'create-specialist' };
      hasInitializedFromUrl = true;
    } else if (initialSpecialistId) {
      setActiveTab('agents');
      aiBehaviorView = { type: 'specialist', id: initialSpecialistId };
      hasInitializedFromUrl = true;
    }
  });

  // Check if we're in development mode
  const isDevMode = import.meta.env.DEV;
  const isMac = isMacPlatform();

  // Get back label - show workspace title if coming from a workspace
  const backLabel = $derived.by(() => {
    const prevPath = getSettingsPreviousPath();
    logger.debug('[Settings] prevPath for back button:', prevPath);
    if (prevPath === '/' || prevPath === '') return 'Home';
    if (prevPath.startsWith('/workspace/')) {
      // Extract workspace ID from path like /workspace/{id} or /workspace/{id}/...
      const pathParts = prevPath.split('/');
      const workspaceId = pathParts[2]; // ['', 'workspace', '{id}', ...]
      logger.debug('[Settings] Extracted workspaceId:', workspaceId);
      if (workspaceId) {
        const workspace = workspaceStore.findById(
          workspaceId as import('$shared/types').WorkspaceId,
        );
        logger.debug('[Settings] Found workspace:', workspace?.title);
        return workspace?.title || 'Space';
      }
    }
    return 'Back';
  });

  // Interface & System state
  let theme = $state<Theme>('system');
  let sentryTestStatus = $state('');

  // Component refs for reset functionality
  let gitWorkspaceSettingsRef: GitWorkspaceSettings | undefined = $state();
  let colorThemeSettingsRef: ColorThemeSettings | undefined = $state();

  // Check if the active provider is Auggie (only Auggie supports integrations and MCP servers)
  const isAuggieProvider$ = selectIsProviderActive('auggie');

  // Theme options
  const themeOptions = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  // Font style options
  const fontStyleOptions = [
    { value: 'sans', label: 'Sans-serif' },
    { value: 'monospace', label: 'Mono' },
  ];

  function handleNoteFontChange(value: string | boolean) {
    settingsDispatch(setNoteFontStyle(value as 'sans' | 'monospace'));
  }

  function handleAgentFontChange(value: string | boolean) {
    settingsDispatch(setAgentFontStyle(value as AgentFontStyle));
  }

  function handleCodeFontChange(value: string) {
    settingsDispatch(setCodeFontFamily(value));
  }

  // App version from Electron
  let appVersion = $state('');

  // Map hash targets to their respective tabs
  const hashToTab: Record<string, SettingsTab> = {
    'default-model': 'agents',
    specialists: 'agents',
    providers: 'accounts',
    integrations: 'accounts',
    'mcp-servers': 'setup',
    'git-workspace': 'setup',
    'utility-default-model': 'setup',
    notifications: 'setup',
  };

  onMount(async () => {
    // Load theme from ThemeManager
    theme = themeManager.getTheme();

    // Get app version from Electron
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.invoke('app:version', undefined);
        appVersion = result?.data || 'unknown';
      } catch {
        appVersion = 'unknown';
      }
    }

    // Handle hash-based navigation on initial load
    handleHashNavigation();
  });

  // Listen for hash changes while already on the settings page
  $effect(() => {
    window.addEventListener('hashchange', handleHashNavigation);
    return () => {
      window.removeEventListener('hashchange', handleHashNavigation);
    };
  });

  /** Navigate to the correct tab and scroll to the hash target */
  function handleHashNavigation() {
    if (typeof window === 'undefined' || !window.location.hash) return;
    const targetId = window.location.hash.slice(1);

    // Switch to the correct tab if needed
    const targetTab = hashToTab[targetId];
    if (targetTab && targetTab !== activeTab) {
      setActiveTab(targetTab);
    }

    // Scroll to hash target after tab switch
    setTimeout(() => {
      const targetEl = document.getElementById(targetId);
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
    const previousTheme = theme;
    theme = newTheme as Theme;
    themeManager.setTheme(theme);
    track('Changed Theme', {
      theme: theme,
      previous_theme: previousTheme,
      source: 'toggle',
    });
  }

  async function handleTestSentryError() {
    sentryTestStatus = 'Sending test error to Sentry...';
    try {
      const Sentry = await import('@sentry/electron/renderer');
      const testError = new Error(
        `[Test] Sentry test error from Settings page at ${new Date().toISOString()}`,
      );
      Sentry.captureException(testError);
      sentryTestStatus = '✅ Test error sent to Sentry! Check your Sentry dashboard.';
      logger.info('[Settings] Sentry test error sent');
    } catch (error) {
      sentryTestStatus = `❌ Failed to send test error: ${error}`;
      logger.error('[Settings] Failed to send Sentry test error:', error);
    }
  }

  function handleResetInterfaceSystem() {
    // Reset theme
    theme = 'system';
    themeManager.setTheme('system');
    // Clear custom color theme
    colorThemeSettingsRef?.clearTheme();
    // Reset font styles
    settingsDispatch(setNoteFontStyle('sans'));
    settingsDispatch(setAgentFontStyle('sans'));
    // Reset notification settings
    settingsDispatch(resetNotificationSettings());
    // Reset Git & Workspace settings
    gitWorkspaceSettingsRef?.resetToDefaults();
  }
</script>

<div class="h-full grid grid-rows-[min-content_1fr_min-content]">
  <!-- Sticky header with back button and tabs -->
  <div class="bg-sidebar px-6 pt-8 pb-0">
    <div class="max-w-5xl mx-auto px-6">
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

      <h1 class="mt-3 mb-4 text-3xl font-semibold tracking-[-0.02em] text-foreground">Settings</h1>

      <!-- Tab Bar -->
      <div class="flex gap-1 border-b border-border -mx-6 px-6">
        {#each tabs as tab (tab.id)}
          <button
            type="button"
            onclick={() => setActiveTab(tab.id)}
            class="px-4 py-2.5 text-sm font-medium transition-colors relative cursor-pointer
              {activeTab === tab.id
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {tab.label}
            {#if activeTab === tab.id}
              <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full"></span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="overflow-auto h-full">
    <div class="min-h-[calc(100%-2rem)] flex flex-col max-w-5xl mx-auto mt-6 px-6 pb-8">
      <!-- Accounts Tab -->
      {#if activeTab === 'accounts'}
        <div class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Model Providers
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <ProviderSelector />
            </section>
          </div>
          <p class="text-xs text-subtle mt-2">
            You can sign in or switch accounts using your model provider in the terminal.
          </p>
        </div>

        <!-- Connections -->
        <div id="integrations" class="mb-6 scroll-mt-20">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Connections
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <ConnectionsSettings />
            </section>
          </div>
        </div>
      {/if}

      <!-- Agents Tab -->
      {#if activeTab === 'agents'}
        <div class="grid grid-cols-[min-content_1fr] gap-6 grow">
          <AIBehaviorSidebar
            activeView={aiBehaviorView}
            onSelect={(view) => (aiBehaviorView = view)}
          />
          <AIBehaviorEditor
            activeView={aiBehaviorView}
            onSpecialistCreated={(id) => (aiBehaviorView = { type: 'specialist', id })}
            onSpecialistDeleted={() => (aiBehaviorView = { type: 'system-prompt' })}
            onDiscard={() => (aiBehaviorView = { type: 'system-prompt' })}
          />
        </div>
      {/if}

      <!-- Setup Tab -->
      {#if activeTab === 'setup'}
        <!-- Git & Workspace -->
        <div class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Git & Workspace
          </h2>
          <GitWorkspaceSettings bind:this={gitWorkspaceSettingsRef} />
        </div>

        <!-- Notifications -->
        <div id="notifications" class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Notifications
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <NotificationSettings />
            </section>
          </div>
        </div>

        <!-- RTK -->
        <div class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            CLI Optimization
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <RtkSettings />
            </section>
          </div>
        </div>

        <!-- MCP Servers -->
        <div id="mcp-servers" class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            MCP Servers
          </h2>
          <McpServersSettings isAuggieProvider={$isAuggieProvider$} />
        </div>

        <!-- Quick Actions -->
        <div id="utility-default-model" class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Quick Actions
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <BackgroundAgentSettings />
            </section>
          </div>
        </div>
      {/if}

      <!-- Fonts & Colors Tab -->
      {#if activeTab === 'fonts-colors'}
        <!-- Theme -->
        <div class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Appearance
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-foreground">Theme</p>
                <Toggle
                  variant="group"
                  options={themeOptions}
                  value={theme}
                  onChange={handleThemeChange}
                  size="sm"
                />
              </div>
            </section>
            <section class="px-6 py-5">
              <ColorThemeSettings bind:this={colorThemeSettingsRef} />
            </section>
          </div>
        </div>

        <!-- Font Style -->
        <div class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Font Style
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-foreground">Notes</p>
                  <p
                    class="text-xs text-subtle mt-0.5 transition-all duration-200"
                    class:font-mono={$isNoteMonospace}
                  >
                    The typeface used for your notes, specs, and documents. Monospace can feel more
                    focused for technical writing.
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
            <section class="px-6 py-5">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-foreground">Agent Chat</p>
                  <p
                    class="text-xs text-subtle mt-0.5 transition-all duration-200"
                    class:font-mono={$agentFontStyle === 'monospace'}
                  >
                    The typeface used for agent conversation messages, including code references and
                    explanations.
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
            <section class="px-6 py-5">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-foreground">Font</p>
                  <p class="text-xs text-subtle mt-0.5">
                    The monospace font used in code editors, diffs, and syntax-highlighted blocks.
                  </p>
                </div>
                <div class="w-[180px] flex-shrink-0">
                  <Select.Root
                    value={$codeFontFamily}
                    onchange={handleCodeFontChange}
                  >
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
      {/if}

      <!-- General Tab -->
      {#if activeTab === 'general'}
        <!-- Reset -->
        <div class="mb-12">
          <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Reset
          </h2>
          <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
            <section class="px-6 py-5">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-foreground">Reset Settings</p>
                  <p class="text-xs text-subtle">
                    Restore theme, notifications, git settings, and update preferences to defaults
                  </p>
                </div>
                <Button variant="outline" size="sm" onclick={handleResetInterfaceSystem}>
                  Reset to Defaults
                </Button>
              </div>
            </section>
          </div>
        </div>

        <!-- Developer Section (only in dev mode) -->
        {#if isDevMode}
          <div class="mb-12">
            <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Developer
            </h2>
            <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
              <section class="px-6 py-5">
                <div class="flex items-center gap-4">
                  <Button variant="destructive" size="sm" onclick={handleTestSentryError}>
                    Test Sentry Error
                  </Button>
                  {#if sentryTestStatus}
                    <span class="text-sm text-subtle">{sentryTestStatus}</span>
                  {/if}
                </div>
              </section>
              <section class="px-6 py-5">
                <div class="flex flex-col gap-2">
                  <span class="text-sm font-medium">Update Toast Simulation</span>
                  <div class="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => autoUpdateStore.simulateUpdateFlow()}
                    >
                      Simulate Update Flow
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => autoUpdateStore.simulateNoUpdate()}
                    >
                      Simulate No Update
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => autoUpdateStore.simulateReset()}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Global Footer -->
  <div class="px-6 py-4 border-t border-border bg-sidebar">
    <div class="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div class="text-sm text-subtle">
        <strong class="text-foreground">Intent by Augment</strong>
        <span class="ml-2">
          v{appVersion || '...'}
          {#if autoUpdateStore.isReadyToInstall}
            <span class="mx-2">·</span>
            <button
              class="font-medium underline text-primary hover:text-primary/80 cursor-pointer bg-transparent border-none p-0"
              onclick={() => autoUpdateStore.installUpdate()}
            >
              Update available
            </button>
          {:else if autoUpdateStore.status === 'not-available' || autoUpdateStore.status === 'idle'}
            <span class="mx-2">·</span>
            <span class="text-subtle">Up to date</span>
          {/if}
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-x-1 gap-y-2">
        <a
          href="mailto:intentfeedback@augmentcode.com"
          onclick={async (e) => {
            e.preventDefault();
            const anchor = e.currentTarget as HTMLAnchorElement;
            const isCmdClick = isMacPlatform() ? e.metaKey : e.ctrlKey;
            if (isCmdClick) {
              await navigator.clipboard.writeText('intentfeedback@augmentcode.com');
              flashCopied(anchor);
            } else {
              try {
                await window.electronAPI?.invoke('shell:openExternal', {
                  url: 'mailto:intentfeedback@augmentcode.com',
                });
              } catch {
                // Fallback: copy to clipboard if mailto fails
                await navigator.clipboard.writeText('intentfeedback@augmentcode.com');
                flashCopied(anchor);
              }
            }
          }}
          class="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >Feedback?</a
        >
      </div>
    </div>
  </div>
</div>
