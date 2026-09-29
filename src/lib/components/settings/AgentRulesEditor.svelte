<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faRotateLeft,
    faCheck,
    faCircleExclamation,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import {
    Button,
    IntentMarkLoader,
    Textarea,
  } from '$lib/components/patterns/settings/custom-controls';
  import { store as appStore } from '$store/renderer/store';
  import {
    agentRulesEditorOpened,
    agentRulesEditorClosed,
    agentRulesContentChanged,
    saveAgentRules,
    undoAgentRulesChanges,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectAgentRulesEditor,
    selectAgentRulesHaveChanges,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatNumber } from '$lib/i18n/format';

  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

  // Character limit constants - similar to WorkspaceRulesEditor
  const MAX_RULES_LENGTH = 50000; // 50k characters
  const WARNING_THRESHOLD = 40000; // 80% of max

  const editor$ = selectAgentRulesEditor();
  const hasChanges$ = selectAgentRulesHaveChanges();
  let rulesContent = $derived($editor$.content);
  let loading = $derived($editor$.loading);
  let errorMessage = $derived($editor$.errorMessage);
  let hasChanges = $derived($hasChanges$);
  let saveStatus = $derived($editor$.saveStatus);

  // Derived character limit state
  let charCount = $derived(rulesContent.length);
  let isOverLimit = $derived(charCount > MAX_RULES_LENGTH);
  let isApproachingLimit = $derived(charCount > WARNING_THRESHOLD && !isOverLimit);
  let charCountPercentage = $derived(
    Math.min(100, Math.round((charCount / MAX_RULES_LENGTH) * 100)),
  );
  let excessChars = $derived(isOverLimit ? charCount - MAX_RULES_LENGTH : 0);

  onMount(() => {
    appStore.dispatch(agentRulesEditorOpened());
    return () => appStore.dispatch(agentRulesEditorClosed());
  });

  function handleKeyDown(e: KeyboardEvent) {
    // Save immediately on Cmd/Ctrl + S
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      appStore.dispatch(saveAgentRules());
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="h-full flex flex-col gap-2 {className}">
  {#if hasChanges}
    <div
      data-testid="agent-rules-header"
      class="flex min-w-0 shrink-0 flex-wrap items-center gap-2"
    >
      <Button
        variant="ghost-light"
        size="xs"
        onclick={() => appStore.dispatch(undoAgentRulesChanges())}
        class=""
      >
        <Fa icon={faRotateLeft} class="w-3 h-3" />
        {m.settings_agentRules_undoChanges()}
      </Button>
    </div>
  {/if}

  {#if errorMessage}
    <div
      class="bg-danger-background/10 border border-danger/20 text-danger px-4 py-2 rounded-md type-body shrink-0"
    >
      {errorMessage}
    </div>
  {/if}

  <!-- Character limit warning/error callout -->
  {#if isOverLimit}
    <div
      class="flex items-center gap-2 p-3 bg-danger-background/10 border border-danger/30 rounded-md text-danger shrink-0"
    >
      <Fa icon={faCircleExclamation} class="w-4 h-4 flex-shrink-0" />
      <span class="type-body">
        {m.settings_agentRules_overLimitCallout({
          max: formatInteger(MAX_RULES_LENGTH),
          excess: formatInteger(excessChars),
        })}
      </span>
    </div>
  {:else if isApproachingLimit}
    <div
      class="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-md text-warning-ink shrink-0"
    >
      <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
      <span class="type-body">
        {m.settings_agentRules_approachingLimit({
          percent: formatNumber(charCountPercentage / 100, {
            style: 'percent',
            maximumFractionDigits: 0,
          }),
        })}
      </span>
    </div>
  {/if}

  {#if loading}
    <div
      class="flex grow items-center justify-start rounded-lg border border-border bg-muted/20 px-4 py-16 text-left text-subtle"
    >
      <IntentMarkLoader size={16} class="mr-2" />
      {m.settings_agentRules_loading()}
    </div>
  {:else}
    <div class="relative agent-rules-textarea grow flex flex-col min-h-0">
      <Textarea
        value={rulesContent}
        oninput={(event) => appStore.dispatch(agentRulesContentChanged(event.currentTarget.value))}
        noFocusStyle
        placeholder={m.settings_agentRules_placeholder()}
        class="type-body leading-relaxed grow {isOverLimit ? 'border-danger' : ''}"
      />
      <!-- Saved indicator -->
      <div
        data-testid="agent-rules-saved-indicator"
        class="absolute top-2 right-2 transition-opacity duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {saveStatus ===
        'saved'
          ? 'opacity-100'
          : 'opacity-0'}"
      >
        <Fa icon={faCheck} class="w-3.5 h-3.5 text-emerald-500" />
      </div>
    </div>

    <!-- Character count indicator - only show when approaching or over limit -->
    {#if isApproachingLimit || isOverLimit}
      <div
        class="flex items-center justify-end shrink-0 {isOverLimit
          ? 'text-danger'
          : 'text-warning-ink'}"
      >
        <span>
          {m.settings_autoSave_limitUsed({
            percent: formatNumber(charCountPercentage / 100, {
              style: 'percent',
              maximumFractionDigits: 0,
            }),
          })}
        </span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .agent-rules-textarea :global(textarea) {
    height: 100%;
    min-height: 200px;
    resize: none;
  }

  .agent-rules-textarea :global(textarea::placeholder) {
    opacity: 0.4;
    font-style: italic;
  }

  .bg-warning\/10 {
    background-color: hsla(38, 92%, 50%, 0.1);
  }

  .border-warning\/30 {
    border-color: hsla(38, 92%, 50%, 0.3);
  }
</style>
