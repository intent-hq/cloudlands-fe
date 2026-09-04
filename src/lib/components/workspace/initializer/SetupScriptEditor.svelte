<script lang="ts">
  import Fa from 'svelte-fa';
  import { faTerminal, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import SetupScriptAgent from './SetupScriptAgent.svelte';
  import { slide } from 'svelte/transition';
  import { untrack } from 'svelte';
  import {
    SETUP_SCRIPT_TEMPLATES,
    SETUP_SCRIPT_VARIABLES,
    getTemplateContent,
    getLastUsedSetupScript,
    REPO_CONFIG_SCRIPT_ID,
    REPO_CONFIG_SCRIPT_NAME,
    setupScriptDisplayName,
    type ProjectType,
    type SetupScriptNameSource,
  } from '$features/setup-scripts';

  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    repoPath?: string;
    /**
     * Source URL for GitHub selections — their `repoPath` is only the clone
     * destination, which two different repos can share, so the last-used
     * lookup keys on path + URL.
     */
    githubUrl?: string | null;
    projectType?: ProjectType;
    /** Setup script committed in the repo's `.intent/config.json`, if any */
    repoConfigScript?: string | null;
    value?: string;
    expanded?: boolean;
    scriptName?: string;
    /** True identity of `scriptName` — drives display-label localization. */
    scriptNameSource?: SetupScriptNameSource;
    isCustomScript?: boolean;
    compact?: boolean;
    triggerClass?: string;
    contentOnly?: boolean;
    contentClass?: string;
    onchange?: (value: string) => void;
  }

  let {
    repoPath = '',
    githubUrl = null,
    projectType = undefined,
    repoConfigScript = null,
    value = $bindable(''),
    expanded = $bindable(false),
    scriptName = $bindable(m.workspace_setupScriptEditor_custom_name()),
    scriptNameSource = $bindable('named'),
    isCustomScript = $bindable(false),
    compact = false,
    triggerClass = '',
    contentOnly = false,
    contentClass = '',
    onchange,
  }: Props = $props();

  // Agent panel state
  let showAgentPanel = $state(false);

  let codeEditorRef: ReturnType<typeof CodeEditor> | undefined = $state();
  let selectedScriptId = $state('');
  let hasUserEdited = $state(false);
  let customName = $state(scriptName);
  let customNameSource = $state<SetupScriptNameSource>(scriptNameSource);

  // Track programmatic value changes to avoid false "user edited" detection
  let isProgrammaticChange = $state(false);

  // Script-list entry id for the localStorage last-used script (not a template)
  const LAST_USED_SCRIPT_ID = 'last-used';

  // Last-used setup script for this repo (localStorage; read on repo change)
  const lastUsedScript = $derived(
    repoPath ? getLastUsedSetupScript(repoPath, githubUrl) : undefined,
  );

  // Build a map of script id -> content, label, and name source for quick lookup
  const scriptMap = $derived.by(() => {
    const map = new Map<
      string,
      { content: string; label: string; source: SetupScriptNameSource }
    >();

    if (repoConfigScript) {
      map.set(REPO_CONFIG_SCRIPT_ID, {
        content: repoConfigScript,
        label: REPO_CONFIG_SCRIPT_NAME,
        source: 'repo-config',
      });
    }

    if (lastUsedScript) {
      map.set(LAST_USED_SCRIPT_ID, {
        content: lastUsedScript.content,
        label: lastUsedScript.name,
        source: lastUsedScript.nameSource,
      });
    }

    SETUP_SCRIPT_TEMPLATES.forEach((t) => {
      map.set(`template-${t.id}`, {
        content: getTemplateContent(t),
        label: t.name,
        source: 'named',
      });
    });

    return map;
  });

  // Variables accordion state
  let wordWrap = $state(true);

  // Get display label for trigger button (localized via the entry's true
  // identity — a saved script literally named "Custom" keeps its own name)
  const displayLabel = $derived.by(() => {
    if (hasUserEdited) return setupScriptDisplayName(customName, customNameSource);
    if (!selectedScriptId) return m.workspace_setupScriptEditor_custom_name();
    const script = scriptMap.get(selectedScriptId);
    return script
      ? setupScriptDisplayName(script.label, script.source)
      : m.workspace_setupScriptEditor_custom_name();
  });

  function handleScriptSelect(scriptId: string) {
    selectedScriptId = scriptId;
    hasUserEdited = false;
    isProgrammaticChange = true;

    const script = scriptMap.get(scriptId);
    if (script) {
      value = script.content;
      customName = script.label;
      customNameSource = script.source;
      onchange?.(value);
    }
    requestAnimationFrame(() => codeEditorRef?.focus());
  }

  function handleEditorChange(newValue: string) {
    // Check if user edited the content away from selected script
    if (selectedScriptId && selectedScriptId !== 'none') {
      const script = scriptMap.get(selectedScriptId);
      if (script) {
        hasUserEdited = newValue !== script.content;
      }
    } else if (newValue) {
      // No template selected but has content - treat as custom
      hasUserEdited = true;
    } else {
      // Empty content with no template - not custom
      hasUserEdited = false;
    }
  }

  // Clear editor content
  function handleClear() {
    value = '';
    customName = m.workspace_setupScriptEditor_custom_name();
    customNameSource = 'named';
    hasUserEdited = false;
    selectedScriptId = '';
    onchange?.('');
  }

  // Find "Copy config files only" template ID (it's the 'generic' template)
  const COPY_CONFIG_TEMPLATE_ID = (() => {
    const template = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic');
    return template ? `template-${template.id}` : '';
  })();

  // Track previous repo path to detect changes
  let previousRepoPath = $state<string | null>(null);

  // Auto-select script when repoPath changes or on mount
  // Fallback order: 1. Repo config (.intent/config.json), 2. Last used for this repo, 3. "Copy config files only"
  // BUT: If value is already set (e.g., from restored form state), treat it as user-edited
  $effect(() => {
    // Read repoPath to create dependency
    const currentRepo = repoPath;

    // Only run when repo actually changes (null means first run)
    if (currentRepo === previousRepoPath) return;

    // Check if value was pre-populated (e.g., from restored form state)
    const hasPrePopulatedValue = previousRepoPath === null && value && value.trim().length > 0;

    // Update tracking variable without triggering effect
    previousRepoPath = currentRepo;

    // If we have a pre-populated value on initial mount, try to match it against known scripts
    if (hasPrePopulatedValue) {
      untrack(() => {
        // Try matching pre-populated content against known scripts in scriptMap
        let matched = false;
        const trimmedValue = value.trim();
        for (const [id, entry] of scriptMap.entries()) {
          if (trimmedValue === entry.content.trim()) {
            selectedScriptId = id;
            customName = entry.label;
            customNameSource = entry.source;
            hasUserEdited = false;
            matched = true;
            break;
          }
        }

        if (!matched) {
          // No match found — preserve customName from the scriptName prop
          hasUserEdited = true;
          if (!customName) {
            customName = scriptName || m.workspace_setupScriptEditor_custom_name();
            customNameSource = scriptName ? scriptNameSource : 'named';
          }
        }

        isProgrammaticChange = true;
      });
      return;
    }

    // Priority: repo-committed config script, then last used script for this repo
    const hasRepoConfig = !!repoConfigScript;
    const lastUsed = currentRepo ? getLastUsedSetupScript(currentRepo, githubUrl) : undefined;

    // Use untrack only for internal state mutations to avoid infinite loops
    // But keep value assignment tracked so UI updates
    untrack(() => {
      hasUserEdited = false;
      isProgrammaticChange = true;

      if (hasRepoConfig) {
        // Use the script committed in the repo's .intent/config.json
        selectedScriptId = REPO_CONFIG_SCRIPT_ID;
        customName = REPO_CONFIG_SCRIPT_NAME;
        customNameSource = 'repo-config';
      } else if (lastUsed) {
        // Use last used script for this repo (localStorage)
        selectedScriptId = LAST_USED_SCRIPT_ID;
        customName = lastUsed.name; // Set to last used script's name
        customNameSource = lastUsed.nameSource;
      } else if (COPY_CONFIG_TEMPLATE_ID) {
        // Fallback to "Copy config files only" template
        selectedScriptId = COPY_CONFIG_TEMPLATE_ID;
        const script = scriptMap.get(COPY_CONFIG_TEMPLATE_ID);
        customName = script?.label || m.workspace_setupScriptEditor_custom_name();
        customNameSource = 'named';
      } else {
        customName = m.workspace_setupScriptEditor_custom_name();
        customNameSource = 'named';
      }
    });

    // Set value outside untrack so it triggers reactive updates
    if (hasRepoConfig && repoConfigScript) {
      value = repoConfigScript;
      onchange?.(value);
    } else if (lastUsed) {
      value = lastUsed.content;
      onchange?.(value);
    } else if (COPY_CONFIG_TEMPLATE_ID) {
      const script = scriptMap.get(COPY_CONFIG_TEMPLATE_ID);
      if (script) {
        value = script.content;
        onchange?.(value);
      }
    }
  });

  // Track manual edits to the editor
  $effect(() => {
    // Skip if this was a programmatic change
    if (isProgrammaticChange) {
      isProgrammaticChange = false;
      return;
    }

    // Only check for user edits if there's content
    if (value !== undefined) {
      handleEditorChange(value);
    }
  });

  // Sync internal state with bindable props for parent component access
  $effect(() => {
    scriptName = customName;
    scriptNameSource = customNameSource;
    isCustomScript = hasUserEdited;
  });
</script>

{#snippet expandedContentSnippet()}
  <!-- Two-column layout: sources on left, editor on right -->
  <div class="flex flex-1 min-h-0">
    <!-- Left column: script sources -->
    <div class="flex flex-col flex-[2] min-w-0 overflow-y-auto pl-10 pt-6 pb-6 pr-5">
      <!-- Auto-generate -->
      <div class="mb-4">
        <h4
          class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2"
        >
          {m.workspace_setupScriptEditor_generate_label()}
        </h4>
        <p class="text-xs text-subtle px-2 mb-2">
          {m.workspace_setupScriptEditor_generate_description()}
        </p>
        {#if showAgentPanel && repoPath}
          <div transition:slide={{ duration: 200 }}>
            <SetupScriptAgent
              {repoPath}
              onScriptGenerated={(script) => {
                isProgrammaticChange = true;
                selectedScriptId = '';
                value = script.content;
                customName = script.name;
                hasUserEdited = true;
                onchange?.(value);
                showAgentPanel = false;
                requestAnimationFrame(() => codeEditorRef?.focus());
              }}
              onClose={() => (showAgentPanel = false)}
            />
          </div>
        {:else}
          <Button
            variant="ghost"
            size="sm"
            class="w-full justify-start text-subtle"
            onclick={() => (showAgentPanel = true)}
            disabled={!repoPath}
          >
            <Fa icon={faWandMagicSparkles} class="mr-1.5" />
            {m.workspace_setupScriptEditor_autoGenerate_label()}
          </Button>
        {/if}
      </div>

      <!-- Repo-committed script from .intent/config.json -->
      {#if repoConfigScript}
        <div class="mb-4">
          <h4
            class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2"
          >
            {m.workspace_setupScriptEditor_repoConfig_label()}
          </h4>
          <button
            class="w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors {selectedScriptId ===
            REPO_CONFIG_SCRIPT_ID
              ? 'bg-background text-foreground ring-1 ring-border'
              : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}"
            onclick={() => handleScriptSelect(REPO_CONFIG_SCRIPT_ID)}
          >
            <span class="text-sm"
              >{setupScriptDisplayName(REPO_CONFIG_SCRIPT_NAME, 'repo-config')}</span
            >
            <p class="text-xs text-subtle mt-0.5 line-clamp-1">
              {m.workspace_setupScriptEditor_repoConfig_description()}
            </p>
          </button>
        </div>
      {/if}

      <!-- Last-used script for this repo (localStorage) -->
      {#if lastUsedScript}
        <div class="mb-4">
          <h4
            class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2"
          >
            {m.workspace_setupScriptEditor_lastUsed_label()}
          </h4>
          <button
            class="w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors {selectedScriptId ===
            LAST_USED_SCRIPT_ID
              ? 'bg-background text-foreground ring-1 ring-border'
              : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}"
            onclick={() => handleScriptSelect(LAST_USED_SCRIPT_ID)}
          >
            <span class="text-sm"
              >{setupScriptDisplayName(lastUsedScript.name, lastUsedScript.nameSource)}</span
            >
            <p class="text-xs text-subtle mt-0.5 line-clamp-1">
              {m.workspace_setupScriptEditor_lastUsed_description()}
            </p>
          </button>
        </div>
      {/if}

      <!-- Templates -->
      <div class="mb-4">
        <h4
          class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2"
        >
          {m.workspace_setupScriptEditor_templates_label()}
        </h4>
        {#each SETUP_SCRIPT_TEMPLATES as template (template.id)}
          <button
            class="w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors {selectedScriptId ===
            `template-${template.id}`
              ? 'bg-background text-foreground ring-1 ring-border'
              : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}"
            onclick={() => handleScriptSelect(`template-${template.id}`)}
          >
            <div class="flex items-center gap-2">
              <span class="text-sm">{template.name}</span>
              {#if template.projectType === projectType}
                <span
                  class="text-ui px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0"
                  >{m.workspace_setupScriptEditor_recommended_label()}</span
                >
              {/if}
            </div>
            <p class="text-xs text-subtle mt-0.5 line-clamp-1">{template.description}</p>
          </button>
        {/each}
      </div>
    </div>

    <!-- Right column: editor + actions -->
    <div class="flex flex-col flex-[3] min-w-0 min-h-0">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex-1 min-h-0 overflow-hidden py-6 bg-background"
        onkeydown={(e) => {
          if (e.altKey && e.key === 'z') {
            e.preventDefault();
            wordWrap = !wordWrap;
          }
        }}
      >
        <CodeEditor
          bind:this={codeEditorRef}
          bind:value
          language="shell"
          lineNumbers={true}
          lineWrapping={wordWrap}
        />
      </div>
      <!-- Bottom bar -->
      <div class="flex items-center gap-3 px-3 py-1.5 bg-muted/30 shrink-0">
        <span class="text-ui font-medium uppercase tracking-wider text-muted-foreground shrink-0"
          >{m.workspace_setupScriptEditor_variables_label()}</span
        >
        <div class="flex flex-wrap gap-1.5">
          {#each SETUP_SCRIPT_VARIABLES as variable (variable.name)}
            <Tooltip.Provider delayDuration={100}>
              <Tooltip.Root delayDuration={100}>
                <Tooltip.Trigger>
                  <code
                    class="text-ui px-1.5 py-0.5 rounded bg-background/80 text-muted-foreground font-mono cursor-pointer hover:bg-background hover:text-foreground transition-colors"
                  >
                    ${variable.name}
                  </code>
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom" class="max-w-xs z-[200]">
                  <p class="text-xs">{variable.description}</p>
                  <p class="text-xs opacity-50 mt-1">
                    {m.workspace_setupScriptEditor_example_before()}
                    <code class="text-ui">{variable.example}</code>
                  </p>
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          {/each}
        </div>
        {#if value.trim()}
          <Button
            variant="ghost"
            size="sm"
            onclick={handleClear}
            class="ml-auto text-muted-foreground hover:text-foreground text-xs"
          >
            {m.workspace_setupScriptEditor_clear_label()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#if contentOnly}
  <!-- Content only mode: just render the expanded content -->
  {#if expanded}
    <div
      class="{contentClass} flex flex-col gap-3 flex-1 min-h-0"
      transition:slide={{ duration: 200 }}
    >
      {@render expandedContentSnippet()}
    </div>
  {/if}
{:else}
  <div class={compact ? '' : 'w-full'}>
    <!-- Trigger Row -->
    <Button
      variant="ghost"
      size="sm"
      class="whitespace-nowrap hover:text-inherit! {triggerClass}"
      onclick={() => (expanded = !expanded)}
    >
      <Fa icon={faTerminal} size="xs" />
      <span class="text-sm font-normal text-subtle"
        >{m.workspace_setupScriptEditor_setupScript_label()}</span
      >
      <span class="text-subtle font-normal">{displayLabel}</span>
    </Button>

    <!-- Expanded Content (non-compact mode renders inside, compact mode renders via slot) -->
    {#if expanded && !compact}
      <div class="mt-1 pl-7 space-y-3" transition:slide={{ duration: 200 }}>
        {@render expandedContentSnippet()}
      </div>
    {/if}
  </div>

  <!-- Compact mode: expanded content rendered outside wrapper (parent controls placement) -->
  {#if expanded && compact}
    <div class="space-y-3" transition:slide={{ duration: 200 }}>
      {@render expandedContentSnippet()}
    </div>
  {/if}
{/if}
