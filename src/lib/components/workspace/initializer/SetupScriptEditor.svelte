<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faTerminal,
    faWandMagicSparkles,
    faTrash,
    faPlus,
    faPencil,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
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
    type ProjectType,
  } from '$features/setup-scripts';
  import { v4 as uuidv4 } from 'uuid';
  import { getDispatch } from '$lib/store/utils/utils';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
    saveScript,
    renameScript,
    updateScriptContent,
    removeScriptFromUI,
    restoreScriptToUI,
    deleteScript,
  } from '$lib/store/slices/setup-scripts/setup-scripts-slice';
  import {
    selectScripts,
    selectScriptById,
    selectLastUsedScriptForRepo,
  } from '$lib/store/slices/setup-scripts/setup-scripts-selectors';
  import type { SetupScript } from '$lib/store/slices/setup-scripts/setup-scripts-types';

  interface Props {
    repoPath?: string;
    projectType?: ProjectType;
    value?: string;
    expanded?: boolean;
    scriptName?: string;
    isCustomScript?: boolean;
    hasUnsavedChanges?: boolean;
    compact?: boolean;
    triggerClass?: string;
    contentOnly?: boolean;
    contentClass?: string;
    onchange?: (value: string) => void;
    onSave?: () => void;
  }

  let {
    repoPath = '',
    projectType = undefined,
    value = $bindable(''),
    expanded = $bindable(false),
    scriptName = $bindable('Custom'),
    isCustomScript = $bindable(false),
    hasUnsavedChanges = $bindable(false),
    compact = false,
    triggerClass = '',
    contentOnly = false,
    contentClass = '',
    onchange,
    onSave,
  }: Props = $props();

  // Redux dispatch (must be at component init)
  const dispatch = getDispatch();
  const allScripts$ = selectScripts();

  // Agent panel state
  let showAgentPanel = $state(false);

  let codeEditorRef: ReturnType<typeof CodeEditor> | undefined = $state();
  let selectedScriptId = $state('');
  let hasUserEdited = $state(false);
  let customName = $state(scriptName);
  let editingNameId = $state<string | null>(null);
  let editingNameValue = $state('');


  // Track programmatic value changes to avoid false "user edited" detection
  let isProgrammaticChange = $state(false);

  /** Create a new SetupScript object with generated ID and timestamps */
  function createScriptObject(params: {
    name?: string;
    content: string;
    repoPath?: string;
    projectType?: string;
  }): SetupScript {
    const now = new Date().toISOString();
    return {
      id: uuidv4(),
      name: params.name || 'Custom Script',
      content: params.content,
      repoPath: params.repoPath,
      projectType: params.projectType,
      lastUsedAt: now,
      usageCount: 1,
      createdAt: now,
    };
  }

  /** Save or update a script, handling duplicate detection */
  function saveOrUpdateScript(params: {
    name?: string;
    content: string;
    repoPath?: string;
    projectType?: string;
  }): SetupScript {
    // Check for existing script with same content for this repo
    const scripts = $allScripts$;
    const existing = scripts.find(
      (s) => s.content === params.content && s.repoPath === params.repoPath,
    );

    if (existing) {
      const now = new Date().toISOString();
      const updated: SetupScript = {
        ...existing,
        lastUsedAt: now,
        usageCount: existing.usageCount + 1,
        ...(params.name ? { name: params.name } : {}),
        ...(params.projectType ? { projectType: params.projectType } : {}),
      };
      dispatch(saveScript(updated));
      return updated;
    }

    const newScript = createScriptObject(params);
    dispatch(saveScript(newScript));
    return newScript;
  }

  // Get recent scripts sorted by relevance to current repo
  const recentScripts = $derived.by(() => {
    const scripts = [...$allScripts$];
    scripts.sort((a, b) => {
      const aRepoMatch = repoPath && a.repoPath === repoPath;
      const bRepoMatch = repoPath && b.repoPath === repoPath;
      if (aRepoMatch && !bRepoMatch) return -1;
      if (!aRepoMatch && bRepoMatch) return 1;

      const aTypeMatch = projectType && a.projectType === projectType;
      const bTypeMatch = projectType && b.projectType === projectType;
      if (aTypeMatch && !bTypeMatch) return -1;
      if (!aTypeMatch && bTypeMatch) return 1;

      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    });
    return scripts;
  });

  // Build a map of script id -> content and label for quick lookup
  const scriptMap = $derived.by(() => {
    const map = new Map<string, { content: string; label: string }>();

    recentScripts.forEach((s) => {
      map.set(s.id, { content: s.content, label: s.name });
    });

    SETUP_SCRIPT_TEMPLATES.forEach((t) => {
      map.set(`template-${t.id}`, { content: getTemplateContent(t), label: t.name });
    });

    return map;
  });

  // Saved scripts for the right column
  const repoScripts = $derived(recentScripts.filter((s) => s.repoPath === repoPath).slice(0, 5));
  const otherSavedScripts = $derived(
    recentScripts.filter((s) => s.repoPath !== repoPath).slice(0, 3),
  );

  // Variables accordion state
  let wordWrap = $state(true);

  // Get display label for trigger button
  const displayLabel = $derived.by(() => {
    if (hasUserEdited) return customName;
    if (!selectedScriptId) return 'Custom';
    const script = scriptMap.get(selectedScriptId);
    return script?.label || 'Custom';
  });



  function handleScriptSelect(scriptId: string) {
    selectedScriptId = scriptId;
    hasUserEdited = false;
    isProgrammaticChange = true;

    const script = scriptMap.get(scriptId);
    if (script) {
      value = script.content;
      customName = script.label;
      onchange?.(value);
    }
    requestAnimationFrame(() => codeEditorRef?.focus());
  }

  function handleEditorChange(newValue: string) {
    // Check if user edited the content away from selected script
    if (selectedScriptId && selectedScriptId !== 'none') {
      const script = scriptMap.get(selectedScriptId);
      if (script) {
        const contentChanged = newValue !== script.content;
        if (contentChanged && selectedScriptId.startsWith('template-')) {
          // User edited a template — fork into a new saved script
          const templateName = script.label;
          const savedScript = saveOrUpdateScript({
            name: templateName,
            content: newValue,
            repoPath,
            projectType: projectType || 'generic',
          });
          selectedScriptId = savedScript.id;
          customName = savedScript.name;
          hasUserEdited = false;
          return;
        }
        hasUserEdited = contentChanged;
      }
    } else if (newValue) {
      // No template selected but has content - treat as custom
      hasUserEdited = true;
    } else {
      // Empty content with no template - not custom
      hasUserEdited = false;
    }
  }

  // Handle deleting a saved script with undo
  function handleDeleteSavedScript(scriptId: string, name: string) {
    const scriptData = selectScriptById.select(getReduxStore().getState(), scriptId);
    if (!scriptData) return;

    dispatch(removeScriptFromUI(scriptId));

    if (selectedScriptId === scriptId) {
      selectedScriptId = '';
      value = '';
      customName = 'Custom';
      onchange?.('');
    }

    let undoClicked = false;
    const toastId = toast.warning(`Deleted "${name}"`, {
      duration: 15000,
      action: {
        label: 'Undo',
        onClick: () => {
          undoClicked = true;
          dispatch(restoreScriptToUI(scriptId));
          toast.dismiss(toastId);
        },
      },
    });

    setTimeout(() => {
      if (!undoClicked) {
        dispatch(deleteScript(scriptId));
      }
    }, 15000);
  }

  // Clear editor content
  function handleClear() {
    value = '';
    customName = 'Custom';
    hasUserEdited = false;
    selectedScriptId = '';
    onchange?.('');
  }

  // Handle saving the current script — also exposed for parent components
  export function save() {
    handleSave();
  }

  function handleSave() {
    if (!hasUserEdited || !value.trim()) return;

    // If a non-template saved script is selected, update it in place
    const isExistingSaved = selectedScriptId && !selectedScriptId.startsWith('template-');
    if (isExistingSaved) {
      const now = new Date().toISOString();
      dispatch(updateScriptContent(selectedScriptId, value, now));
      dispatch(renameScript(selectedScriptId, customName || 'Custom Script'));
      customName = (customName || 'Custom Script').trim() || 'Custom Script';
      hasUserEdited = false;
      toast.success(`Saved "${customName}"`);
      onSave?.();
      return;
    }

    const savedScript = saveOrUpdateScript({
      name: customName || 'Custom Script',
      content: value,
      repoPath,
      projectType: projectType || 'generic',
    });

    // Update selection to the saved script
    selectedScriptId = savedScript.id;
    customName = savedScript.name;
    hasUserEdited = false;

    toast.success(`Saved "${savedScript.name}"`);
    onSave?.();
  }

  function startEditingName(scriptId: string, currentName: string) {
    editingNameId = scriptId;
    editingNameValue = currentName;
  }

  function commitNameEdit() {
    if (editingNameId && editingNameValue.trim()) {
      dispatch(renameScript(editingNameId, editingNameValue.trim()));
      if (selectedScriptId === editingNameId) {
        customName = editingNameValue.trim();
      }
    }
    editingNameId = null;
    editingNameValue = '';
  }

  function cancelNameEdit() {
    editingNameId = null;
    editingNameValue = '';
  }

  // Find "Copy config files only" template ID (it's the 'generic' template)
  const COPY_CONFIG_TEMPLATE_ID = (() => {
    const template = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic');
    return template ? `template-${template.id}` : '';
  })();

  // Track previous repo path to detect changes
  let previousRepoPath = $state<string | null>(null);

  // Auto-select script when repoPath changes or on mount
  // Fallback order: 1. Last used for this repo, 2. "Copy config files only"
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
            hasUserEdited = false;
            matched = true;
            break;
          }
        }

        if (!matched) {
          // No match found — preserve customName from the scriptName prop
          hasUserEdited = true;
          customName = customName || scriptName || 'Custom';
        }

        isProgrammaticChange = true;
      });
      return;
    }

    // Try to find last used script for this repo
    const lastUsed = currentRepo ? selectLastUsedScriptForRepo.select(getReduxStore().getState(), currentRepo) : undefined;

    // Use untrack only for internal state mutations to avoid infinite loops
    // But keep value assignment tracked so UI updates
    untrack(() => {
      hasUserEdited = false;
      isProgrammaticChange = true;

      if (lastUsed) {
        // Use last used script for this repo
        selectedScriptId = lastUsed.id;
        customName = lastUsed.name; // Set to last used script's name
      } else if (COPY_CONFIG_TEMPLATE_ID) {
        // Fallback to "Copy config files only" template
        selectedScriptId = COPY_CONFIG_TEMPLATE_ID;
        const script = scriptMap.get(COPY_CONFIG_TEMPLATE_ID);
        customName = script?.label || 'Custom';
      } else {
        customName = 'Custom';
      }
    });

    // Set value outside untrack so it triggers reactive updates
    if (lastUsed) {
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
    isCustomScript = hasUserEdited;
    hasUnsavedChanges = hasUserEdited && !!value.trim();
  });
</script>

{#snippet expandedContentSnippet()}
  <!-- Two-column layout: sources on left, editor on right -->
  <div class="flex flex-1 min-h-0">
    <!-- Left column: script sources -->
    <div class="flex flex-col flex-[2] min-w-0 overflow-y-auto pl-10 pt-6 pb-6 pr-5">
      <!-- Create new -->
      <div class="mb-4">
        <Button
          variant="ghost"
          size="sm"
          class="w-full justify-start text-subtle"
          onclick={() => {
            const newScript = createScriptObject({
              name: 'Untitled script',
              content: '',
              repoPath,
              projectType: projectType || 'generic',
            });
            dispatch(saveScript(newScript));
            selectedScriptId = newScript.id;
            value = '';
            customName = newScript.name;
            hasUserEdited = false;
            isProgrammaticChange = true;
            onchange?.('');
            requestAnimationFrame(() => {
              codeEditorRef?.focus();
              startEditingName(newScript.id, newScript.name);
            });
          }}
        >
          <Fa icon={faPlus} class="mr-1.5" />
          New script
        </Button>
      </div>

      <!-- Auto-generate -->
      <div class="mb-4">
        <h4 class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2">Generate</h4>
        <p class="text-xs text-subtle px-2 mb-2">Analyze your repo and create a setup script automatically.</p>
        {#if showAgentPanel && repoPath}
          <div transition:slide={{ duration: 200 }}>
            <SetupScriptAgent
              {repoPath}
              onScriptGenerated={(script) => {
                const savedScript = saveOrUpdateScript({
                  name: script.name,
                  content: script.content,
                  repoPath,
                  projectType: projectType || 'generic',
                });
                isProgrammaticChange = true;
                selectedScriptId = savedScript.id;
                value = savedScript.content;
                customName = savedScript.name;
                hasUserEdited = false;
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
            Auto-generate from repo
          </Button>
        {/if}
      </div>

      <!-- Saved scripts for this repo -->
      {#if repoScripts.length > 0}
        <div class="mb-4">
          <h4 class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2">Saved</h4>
          {#each repoScripts as script (script.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div
              class="group w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors flex items-center justify-between {selectedScriptId === script.id ? 'bg-background text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}"
              onclick={() => handleScriptSelect(script.id)}
            >
              <div class="min-w-0 flex-1">
                {#if editingNameId === script.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="text"
                    class="text-sm leading-5 h-5 w-full bg-transparent border-none outline-none px-0 py-0"
                    bind:value={editingNameValue}
                    autofocus
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => { if (e.key === 'Enter') commitNameEdit(); if (e.key === 'Escape') cancelNameEdit(); }}
                    onblur={commitNameEdit}
                  />
                {:else}
                  <span
                    class="text-sm leading-5 h-5 truncate block"
                    ondblclick={(e) => { e.stopPropagation(); startEditingName(script.id, script.name); }}
                  >{script.name}</span>
                {/if}
                {#if script.repoPath}
                  <span class="text-ui text-subtle truncate block">{script.repoPath.split('/').pop()}</span>
                {/if}
              </div>
              <div class="flex items-center shrink-0">
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <span
                  role="button"
                  tabindex="0"
                  class="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground rounded transition-all cursor-pointer"
                  onclick={(e) => { e.stopPropagation(); startEditingName(script.id, script.name); }}
                  title="Rename"
                >
                  <Fa icon={faPencil} size="xs" />
                </span>
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <span
                  role="button"
                  tabindex="0"
                  class="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive-foreground rounded transition-all cursor-pointer"
                  onclick={(e) => { e.stopPropagation(); handleDeleteSavedScript(script.id, script.name); }}
                  title="Delete"
                >
                  <Fa icon={faTrash} size="xs" />
                </span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Other saved scripts -->
      {#if otherSavedScripts.length > 0}
        <div class="mb-4">
          <h4 class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2">Other saved</h4>
          {#each otherSavedScripts as script (script.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <div
              class="group w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors flex items-center justify-between {selectedScriptId === script.id ? 'bg-background text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}"
              onclick={() => handleScriptSelect(script.id)}
            >
              <div class="min-w-0 flex-1">
                {#if editingNameId === script.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="text"
                    class="text-sm leading-5 h-5 w-full bg-transparent border-none outline-none px-0 py-0"
                    bind:value={editingNameValue}
                    autofocus
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => { if (e.key === 'Enter') commitNameEdit(); if (e.key === 'Escape') cancelNameEdit(); }}
                    onblur={commitNameEdit}
                  />
                {:else}
                  <span
                    class="text-sm leading-5 h-5 truncate block"
                    ondblclick={(e) => { e.stopPropagation(); startEditingName(script.id, script.name); }}
                  >{script.name}</span>
                {/if}
                {#if script.repoPath}
                  <span class="text-ui text-subtle truncate block">{script.repoPath.split('/').pop()}</span>
                {/if}
              </div>
              <div class="flex items-center shrink-0">
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <span
                  role="button"
                  tabindex="0"
                  class="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground rounded transition-all cursor-pointer"
                  onclick={(e) => { e.stopPropagation(); startEditingName(script.id, script.name); }}
                  title="Rename"
                >
                  <Fa icon={faPencil} size="xs" />
                </span>
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <span
                  role="button"
                  tabindex="0"
                  class="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive-foreground rounded transition-all cursor-pointer"
                  onclick={(e) => { e.stopPropagation(); handleDeleteSavedScript(script.id, script.name); }}
                  title="Delete"
                >
                  <Fa icon={faTrash} size="xs" />
                </span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Templates -->
      <div class="mb-4">
        <h4 class="text-ui font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2">Templates</h4>
        {#each SETUP_SCRIPT_TEMPLATES as template (template.id)}
          <button
            class="w-full text-left px-2 py-1.5 rounded-md cursor-pointer transition-colors {selectedScriptId === `template-${template.id}` ? 'bg-background text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}"
            onclick={() => handleScriptSelect(`template-${template.id}`)}
          >
            <div class="flex items-center gap-2">
              <span class="text-sm">{template.name}</span>
              {#if template.projectType === projectType}
                <span class="text-ui px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">recommended</span>
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
        <CodeEditor bind:this={codeEditorRef} bind:value language="shell" lineNumbers={true} lineWrapping={wordWrap} />
      </div>
      <!-- Bottom bar -->
      <div class="flex items-center gap-3 px-3 py-1.5 bg-muted/30 shrink-0">
        <span class="text-ui font-medium uppercase tracking-wider text-muted-foreground shrink-0">Variables</span>
        <div class="flex flex-wrap gap-1.5">
          {#each SETUP_SCRIPT_VARIABLES as variable (variable.name)}
            <Tooltip.Provider delayDuration={100}>
              <Tooltip.Root delayDuration={100}>
                <Tooltip.Trigger>
                  <code class="text-ui px-1.5 py-0.5 rounded bg-background/80 text-muted-foreground font-mono cursor-pointer hover:bg-background hover:text-foreground transition-colors">
                    ${variable.name}
                  </code>
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom" class="max-w-xs z-[200]">
                  <p class="text-xs">{variable.description}</p>
                  <p class="text-xs opacity-50 mt-1">e.g. <code class="text-ui">{variable.example}</code></p>
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          {/each}
        </div>
        {#if value.trim()}
          <Button variant="ghost" size="sm" onclick={handleClear} class="ml-auto text-muted-foreground hover:text-foreground text-xs">
            Clear
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#if contentOnly}
  <!-- Content only mode: just render the expanded content -->
  {#if expanded}
    <div class="{contentClass} flex flex-col gap-3 flex-1 min-h-0" transition:slide={{ duration: 200 }}>
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
      <span class="text-sm font-normal text-subtle">Setup script</span>
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
