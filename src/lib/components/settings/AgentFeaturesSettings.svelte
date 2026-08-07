<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * Agent Features Settings Component
   *
   * Reads/writes the daemon-owned `agentFeatures.*` settings via
   * settings.list / settings.update (PROTOCOL §5.12), following the
   * WorkspaceApiSettings pattern. Nine booleans, all default true:
   * backgroundHooks, hostExec, scripts, terminalAccess, browserAutomation,
   * richChatBlocks, structuredQuestions, attentionRequests, stateSnapshot.
   *
   * Toggles are captured at agent-session creation, so changes apply to
   * newly created sessions only — existing sessions keep the surface they
   * were created with. `stateSnapshot` is the documented exception: the
   * daemon reads it live per turn, so it also affects existing sessions.
   */
  import { onMount } from 'svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { toast } from '$lib/components/ui/toast';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';

  // i18n-ignore (wire setting paths, not user-facing text)
  const FEATURE_PATHS = [
    'agentFeatures.backgroundHooks',
    'agentFeatures.hostExec',
    'agentFeatures.scripts',
    'agentFeatures.terminalAccess',
    'agentFeatures.browserAutomation',
    'agentFeatures.richChatBlocks',
    'agentFeatures.structuredQuestions',
    'agentFeatures.attentionRequests',
    'agentFeatures.stateSnapshot',
  ] as const;

  type FeaturePath = (typeof FEATURE_PATHS)[number];

  const FEATURES: { path: FeaturePath; label: () => string; description: () => string }[] = [
    {
      path: 'agentFeatures.backgroundHooks',
      label: () => m.settings_agentFeatures_backgroundHooks_label(),
      description: () => m.settings_agentFeatures_backgroundHooks_description(),
    },
    {
      path: 'agentFeatures.hostExec',
      label: () => m.settings_agentFeatures_hostExec_label(),
      description: () => m.settings_agentFeatures_hostExec_description(),
    },
    {
      path: 'agentFeatures.scripts',
      label: () => m.settings_agentFeatures_scripts_label(),
      description: () => m.settings_agentFeatures_scripts_description(),
    },
    {
      path: 'agentFeatures.terminalAccess',
      label: () => m.settings_agentFeatures_terminalAccess_label(),
      description: () => m.settings_agentFeatures_terminalAccess_description(),
    },
    {
      path: 'agentFeatures.browserAutomation',
      label: () => m.settings_agentFeatures_browserAutomation_label(),
      description: () => m.settings_agentFeatures_browserAutomation_description(),
    },
    {
      path: 'agentFeatures.richChatBlocks',
      label: () => m.settings_agentFeatures_richChatBlocks_label(),
      description: () => m.settings_agentFeatures_richChatBlocks_description(),
    },
    {
      path: 'agentFeatures.structuredQuestions',
      label: () => m.settings_agentFeatures_structuredQuestions_label(),
      description: () => m.settings_agentFeatures_structuredQuestions_description(),
    },
    {
      path: 'agentFeatures.attentionRequests',
      label: () => m.settings_agentFeatures_attentionRequests_label(),
      description: () => m.settings_agentFeatures_attentionRequests_description(),
    },
    {
      path: 'agentFeatures.stateSnapshot',
      label: () => m.settings_agentFeatures_stateSnapshot_label(),
      description: () => m.settings_agentFeatures_stateSnapshot_description(),
    },
  ];

  let loading = $state(true);
  // All features default to on (PROTOCOL §5.12: nine booleans, default true)
  let values = $state<Record<FeaturePath, boolean>>(
    Object.fromEntries(FEATURE_PATHS.map((path) => [path, true])) as Record<FeaturePath, boolean>,
  );

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const settings = await appClient.settings.list();
      for (const path of FEATURE_PATHS) {
        const entry = settings.find((s: { path: string; value: unknown }) => s.path === path);
        values[path] = entry?.value !== false;
      }
    } catch (error) {
      toast.error(
        m.settings_agentFeatures_loadError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loading = false;
    }
  }

  async function handleToggle(path: FeaturePath, checked: boolean) {
    try {
      const result = await appClient.settings.update([{ path, value: checked }]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find((r: { path: string; value: unknown }) => r.path === path);
      if (applied && applied.value !== checked) {
        toast.error(m.settings_agentFeatures_rollbackError());
        values[path] = applied.value !== false;
        return;
      }

      values[path] = checked;
    } catch (error) {
      toast.error(
        m.settings_agentFeatures_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      values[path] = !checked;
    }
  }
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- New-sessions-only note -->
  <section class="px-6 py-4">
    <p class="text-xs text-amber-500/90">
      {m.settings_agentFeatures_newSessionsNote()}
    </p>
  </section>

  {#each FEATURES as feature (feature.path)}
    <section class="px-6 py-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-foreground">{feature.label()}</p>
          <p class="text-xs text-subtle mt-1">{feature.description()}</p>
        </div>
        <Toggle
          pressed={values[feature.path]}
          onclick={() => handleToggle(feature.path, !values[feature.path])}
          variant="indicator"
          size="xs"
          class="mb-auto"
          disabled={loading}
          ariaLabel={feature.label()}
        />
      </div>
    </section>
  {/each}
</div>
