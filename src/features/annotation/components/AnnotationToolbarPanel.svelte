<script lang="ts">
  import '$lib/styles/dock-tokens.css';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
  import * as Popover from '$lib/components/ui/popover';
  import { Button } from '$lib/components/ui/button';
  import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import {
    faArrowRotateRight,
    faArrowRight,
    faCrosshairs,
    faChevronDown,
    faXmark,
    faMicrophone,
    faPencil,
    faSquare,
    faStop,
    faThumbtack,
    faTriangleExclamation,
    faCamera,
    faCheck,
    type IconDefinition,
  } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { AnnotationTool } from '$shared/annotation';
  import type { AnnotationVoiceStatus } from '../annotation-voice-service';
  import { formatAnnotationTime } from '../annotation-types';
  import { ANNOTATION_PALETTE } from '../utils/annotation-actions';

  let {
    workspaceId = '',
    recipientId = '',
    recipientIsDefault = false,
    workspaceOptions = [],
    recipientOptions = [],
    workspacesLoading = false,
    recipientsLoading = false,
    destinationError = '',
    tool,
    voiceStatus,
    elapsedMs = 0,
    pending = false,
    screenshotPending = false,
    screenshotSaved = false,
    screenshotSaving = false,
    screenshotDisabled = false,
    deliveryLocked = false,
    uncertain = false,
    sent = false,
    sendDisabled = false,
    errorMessage = '',
    sendFailed,
    onExpanded,
    onWorkspace,
    onRecipient,
    onRefresh,
    onTool,
    onScreenshot,
    onVoice,
    onSend,
    onCancel,
  }: {
    workspaceId?: string;
    recipientId?: string;
    recipientIsDefault?: boolean;
    workspaceOptions?: ComboboxOption[];
    recipientOptions?: ComboboxOption[];
    workspacesLoading?: boolean;
    recipientsLoading?: boolean;
    destinationError?: string;
    tool: AnnotationTool;
    voiceStatus: AnnotationVoiceStatus;
    elapsedMs?: number;
    pending?: boolean;
    screenshotPending?: boolean;
    screenshotSaved?: boolean;
    screenshotSaving?: boolean;
    screenshotDisabled?: boolean;
    deliveryLocked?: boolean;
    uncertain?: boolean;
    sent?: boolean;
    sendDisabled?: boolean;
    errorMessage?: string;
    sendFailed?: boolean;
    onExpanded?: (open: boolean) => void;
    onWorkspace?: (id: string) => void;
    onRecipient?: (id: string) => void;
    onRefresh?: () => void;
    onTool: (tool: AnnotationTool) => void;
    onScreenshot?: () => void;
    onVoice: () => void;
    onSend: () => void;
    onCancel: () => void;
  } = $props();
  const noticeId = $props.id();
  const locked = $derived(pending || screenshotPending || uncertain || sent);
  const idleSendLabel = $derived(
    uncertain
      ? m.agent_chatSend_resend_label()
      : (sendFailed ?? Boolean(errorMessage))
        ? m.annotation_retrySend_label()
        : m.annotation_send_label(),
  );
  const sendLabel = $derived(pending ? m.annotation_sending_label() : idleSendLabel);

  const tools: AnnotationTool[] = ['mouse', 'select', 'draw', 'rectangle', 'arrow', 'pin'];
  const voiceBusy = $derived(voiceStatus === 'requesting' || voiceStatus === 'transcribing');
  const recording = $derived(voiceStatus === 'recording');
  const voiceStatusText = $derived.by(() => {
    if (voiceStatus === 'requesting') return m.annotation_voiceStarting_status();
    if (recording) return m.annotation_voiceRecording_status();
    if (voiceStatus === 'transcribing') return m.annotation_voiceTranscribing_status();
    if (voiceStatus === 'error') return m.annotation_voiceFailedRetry_status();
    return m.annotation_voiceOff_status();
  });
  const voiceAction = $derived(
    voiceStatus === 'error'
      ? m.annotation_voiceRetry_label()
      : recording
        ? m.annotation_voiceStop_label()
        : voiceBusy
          ? voiceStatusText
          : m.annotation_voiceStart_label(),
  );

  function toolLabel(value: AnnotationTool): string {
    if (value === 'mouse') return m.annotation_mouse_label();
    if (value === 'select') return m.annotation_select_label();
    if (value === 'draw') return m.annotation_draw_label();
    if (value === 'rectangle') return m.annotation_rectangle_label();
    if (value === 'arrow') return m.annotation_arrow_label();
    return m.annotation_pin_label();
  }

  function shortcut(value: AnnotationTool): string {
    if (value === 'mouse') return 'V';
    if (value === 'select') return 'S';
    if (value === 'draw') return 'P';
    if (value === 'rectangle') return 'R';
    if (value === 'arrow') return 'A';
    return 'C';
  }

  function toolIcon(value: AnnotationTool): IconDefinition {
    if (value === 'select') return faCrosshairs;
    if (value === 'draw') return faPencil;
    if (value === 'rectangle') return faSquare;
    if (value === 'arrow') return faArrowRight;
    return faThumbtack;
  }

  let destinationOpen = $state(false);
  let workspaceOpen = $state(false);
  let recipientOpen = $state(false);
  let workspaceInput = $state<HTMLInputElement | null>(null);
  let noticeElement = $state<HTMLDivElement>();
  let toolsElement = $state<HTMLDivElement>();
  let keyboardNavigation = $state(false);

  function navigateTools(event: KeyboardEvent): void {
    if (locked || event.altKey || event.ctrlKey || event.metaKey) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-annotation-tool]',
    );
    const current = tools.indexOf(button?.dataset.annotationTool as AnnotationTool);
    if (current < 0) return;
    let next: number;
    if (event.key === 'ArrowRight') next = (current + 1) % tools.length;
    else if (event.key === 'ArrowLeft') next = (current + tools.length - 1) % tools.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tools.length - 1;
    else return;
    event.preventDefault();
    keyboardNavigation = true;
    toolsElement
      ?.querySelector<HTMLButtonElement>(`[data-annotation-tool="${tools[next]}"]`)
      ?.focus();
    onTool(tools[next]);
  }

  $effect(() => {
    const selectedTool = tool;
    const element = toolsElement;
    if (!element) return;
    const strip: HTMLDivElement = element;
    let frame = 0;
    function revealSelection(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selected = strip.querySelector<HTMLElement>(
          `[data-annotation-tool="${selectedTool}"]`,
        );
        if (!selected) return;
        const item = selected.getBoundingClientRect();
        const viewport = strip.getBoundingClientRect();
        if (item.left < viewport.left)
          strip.scrollLeft += Math.floor(item.left - viewport.left) - 2;
        else if (item.right > viewport.right)
          strip.scrollLeft += Math.ceil(item.right - viewport.right) + 2;
      });
    }
    const observer = new ResizeObserver(revealSelection);
    observer.observe(strip);
    revealSelection();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
  const workspaceLabel = $derived(
    workspaceOptions.find((option) => option.value === workspaceId)?.label ??
      m.annotation_workspace_placeholder(),
  );
  const recipientLabel = $derived(
    recipientOptions.find((option) => option.value === recipientId)?.label ??
      m.annotation_chooseAgent_message(),
  );
  const notice = $derived(
    errorMessage ||
      destinationError ||
      (uncertain
        ? m.agent_chatSend_uncertainRetry_description()
        : sent
          ? m.annotation_sentCloseFailed_message()
          : ''),
  );

  function changeExpanded(open: boolean): void {
    destinationOpen = open;
    if (!open || notice) {
      workspaceOpen = false;
      recipientOpen = false;
    }
    onExpanded?.(open);
  }
</script>

<nav
  class="annotation-toolbar-panel"
  style:--annotation-ink={ANNOTATION_PALETTE.ink}
  aria-label={m.annotation_toolbar_ariaLabel()}
  data-voice-state={voiceStatus}
>
  <div class="drawing-cluster" data-annotation-surface>
    <div
      class="tools-row"
      bind:this={toolsElement}
      role="toolbar"
      aria-label={m.annotation_toolbar_ariaLabel()}
      aria-orientation="horizontal"
      onkeydown={navigateTools}
      onpointerdown={() => (keyboardNavigation = false)}
    >
      <div
        class="tools-track"
        class:keyboard-navigation={keyboardNavigation}
        style={`--selected-tool: ${tools.indexOf(tool)}`}
      >
        <span class="tool-selection" aria-hidden="true"></span>
        {#each tools as value (value)}
          <Button
            variant="ghost"
            size="icon"
            iconOnly
            class="annotation-tool"
            data-annotation-tool={value}
            tabindex={tool === value ? 0 : -1}
            active={tool === value}
            aria-pressed={tool === value}
            aria-keyshortcuts={value === 'draw' ? 'P D' : shortcut(value)}
            aria-label={toolLabel(value)}
            title={`${toolLabel(value)} (${shortcut(value)})`}
            disabled={locked}
            onclick={() => onTool(value)}
            >{#if value === 'mouse'}<CursorIcon weight="regular" size={20} />{:else}<Fa
                icon={toolIcon(value)}
                weight="regular"
                size={20}
              />{/if}</Button
          >
        {/each}
      </div>
    </div>
    <span class="divider" aria-hidden="true"></span>
    <div class="voice-section" class:recording class:voice-error={voiceStatus === 'error'}>
      <Button
        variant={recording ? 'secondary' : 'ghost'}
        size="icon"
        iconOnly
        class="voice-action"
        aria-label={voiceAction}
        title={`${voiceAction} (M)`}
        aria-keyshortcuts="M"
        aria-pressed={recording}
        disabled={voiceBusy || pending || uncertain || sent}
        onclick={onVoice}
      >
        {#if voiceBusy}<IntentMarkLoader size={16} />{:else}<Fa
            icon={recording
              ? faStop
              : voiceStatus === 'error'
                ? faTriangleExclamation
                : faMicrophone}
            size={18}
          />{/if}
      </Button>
      <div class="voice-copy" class:voice-idle={!recording}>
        <span class="voice-status sr-only" role="status" aria-live="polite" aria-atomic="true"
          >{voiceStatusText}</span
        >
        <span
          class="elapsed type-code"
          role="timer"
          aria-live="off"
          aria-hidden={!recording}
          aria-label={recording ? m.annotation_voiceElapsed_label() : undefined}
          >{#if recording}<span class="status-dot" aria-hidden="true"></span>{formatAnnotationTime(
              elapsedMs,
            )}{/if}</span
        >
      </div>
    </div>
  </div>
  <div class="delivery-cluster" data-annotation-surface>
    <Popover.Root open={destinationOpen} onOpenChange={changeExpanded}>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            class="destination-chip"
            aria-label={m.annotation_workspace_label()}
            title={`${workspaceLabel} · ${recipientLabel}${notice ? ` · ${notice}` : ''}`}
            aria-describedby={notice ? noticeId : undefined}
          >
            <span class="destination-copy">
              <span class="workspace-label type-caption">{workspaceLabel}</span>
              <span class="recipient-label type-caption" class:sr-only={recipientIsDefault}
                >{recipientIsDefault ? m.annotation_mainAgent_label() : recipientLabel}</span
              >
            </span>
            {#snippet trailingIcon()}<span class:has-notice={Boolean(notice)} aria-hidden="true"
                ><Fa icon={notice ? faTriangleExclamation : faChevronDown} size={14} /></span
              >{/snippet}
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content
        staticPosition
        class="annotation-destination-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          queueMicrotask(() => {
            if (notice) noticeElement?.focus({ preventScroll: true });
            else workspaceInput?.focus({ preventScroll: true });
          });
        }}
      >
        <div class="destination-fields">
          <div class="destination-field">
            <div class="destination-heading">
              <span class="type-caption">{m.annotation_workspace_label()}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                iconOnly
                aria-label={m.annotation_refreshRecipients_label()}
                disabled={locked || workspacesLoading || recipientsLoading}
                onclick={onRefresh}><Fa icon={faArrowRotateRight} size={14} /></Button
              >
            </div>
            <Combobox
              class="destination-combobox"
              bind:inputRef={workspaceInput}
              bind:open={workspaceOpen}
              onopenchange={(open) => {
                if (open) recipientOpen = false;
              }}
              value={workspaceId}
              options={workspaceOptions}
              loading={workspacesLoading}
              disabled={locked}
              size="compact"
              ariaLabel={m.annotation_workspace_label()}
              placeholder={m.annotation_workspace_placeholder()}
              searchPlaceholder={m.annotation_workspaceSearch_placeholder()}
              emptyText={m.annotation_noWorkspaces_message()}
              staticPosition
              contentClass="annotation-picker-options"
              onchange={(value) => {
                if (typeof value === 'string') onWorkspace?.(value);
              }}
            />
          </div>
          <div class="destination-field">
            <div class="destination-heading">
              <span class="type-caption">{m.annotation_agent_label()}</span>
            </div>
            <Combobox
              class="destination-combobox"
              bind:open={recipientOpen}
              onopenchange={(open) => {
                if (open) workspaceOpen = false;
              }}
              value={recipientId}
              options={recipientOptions}
              loading={recipientsLoading}
              disabled={locked || !workspaceId}
              size="compact"
              ariaLabel={m.annotation_agent_label()}
              placeholder={m.annotation_chooseAgent_message()}
              searchPlaceholder={m.annotation_recipientSearch_placeholder()}
              emptyText={m.annotation_noAgent_error()}
              staticPosition
              contentClass="annotation-picker-options"
              onchange={(value) => {
                if (typeof value === 'string') onRecipient?.(value);
              }}
            />
          </div>
          {#if !workspaceOpen && !recipientOpen}
            <div
              class="destination-notice"
              bind:this={noticeElement}
              tabindex="-1"
              aria-label={notice || undefined}
            >
              {#if notice}<p class="inline-error type-caption" role="alert">{notice}</p>{/if}
              {#if uncertain && errorMessage}<p class="type-caption">
                  {m.agent_chatSend_uncertainRetry_description()}
                </p>{/if}
            </div>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Root>
    <Button
      variant="ghost"
      size="icon"
      iconOnly
      class={screenshotSaved ? 'screenshot-action screenshot-saved' : 'screenshot-action'}
      disabled={pending ||
        uncertain ||
        sent ||
        (screenshotPending && !screenshotSaving) ||
        screenshotDisabled ||
        !onScreenshot}
      aria-busy={screenshotPending && !screenshotSaving}
      aria-label={screenshotSaving
        ? m.annotation_screenshotRetry_label()
        : m.annotation_screenshot_label()}
      title={screenshotSaving
        ? m.annotation_screenshotRetry_label()
        : screenshotSaved
          ? m.annotation_screenshotSaved_status()
          : m.annotation_screenshot_label()}
      onclick={onScreenshot}
    >
      {#if screenshotPending && !screenshotSaving}<IntentMarkLoader size={16} />{:else}<Fa
          icon={screenshotSaving ? faArrowRotateRight : screenshotSaved ? faCheck : faCamera}
          size={18}
        />{/if}
    </Button>
    <span class="sr-only" role="status" aria-live="polite"
      >{screenshotSaving
        ? m.annotation_screenshotSaving_status()
        : screenshotPending
          ? m.annotation_screenshotCapturing_status()
          : screenshotSaved
            ? m.annotation_screenshotSaved_status()
            : ''}</span
    >
    <Button
      variant="ghost"
      size="icon"
      iconOnly
      class="send-action"
      disabled={pending || screenshotPending || sent || sendDisabled}
      aria-busy={pending}
      aria-label={sendLabel}
      title={sendLabel}
      onclick={onSend}
    >
      {#snippet leadingIcon()}{#if pending}<IntentMarkLoader size={16} />{:else}<Fa
            icon={faArrowRight}
            size={16}
          />{/if}{/snippet}
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      iconOnly
      class="dismiss-action"
      aria-label={sent ? m.annotation_bootstrapClose_label() : m.annotation_cancelAction_label()}
      title={sent ? m.annotation_bootstrapClose_label() : m.annotation_cancelAction_label()}
      disabled={deliveryLocked}
      onclick={onCancel}><Fa icon={faXmark} size={16} /></Button
    >
  </div>
  <span id={noticeId} class="sr-only" role="status">{notice}</span>
</nav>

<style>
  .annotation-toolbar-panel {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: none;
    color: hsl(var(--foreground));
  }
  .drawing-cluster,
  .delivery-cluster {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    height: 100%;
    gap: 6px;
    padding: 6px;
    border-radius: calc(var(--radius-large) + 10px);
    background: hsl(var(--dock-surface));
    box-shadow: inset 0 0 0 1px hsl(var(--border) / 0.65);
    pointer-events: auto;
  }
  .drawing-cluster {
    flex: 0 1 auto;
    min-width: 88px;
  }
  .delivery-cluster {
    flex: 1 1 340px;
    min-width: 189px;
  }
  .tools-row {
    --tool-size: 36px;
    --tool-gap: 2px;
    min-width: 40px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tools-track {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    width: max-content;
    padding-inline: 2px;
    gap: var(--tool-gap);
  }
  .tool-selection {
    position: absolute;
    inset-block: 0;
    left: 2px;
    width: var(--tool-size);
    border-radius: calc(var(--radius-medium) + 4px);
    background: color-mix(in srgb, var(--annotation-ink) 16%, transparent);
    transform: translateX(calc(var(--selected-tool) * (var(--tool-size) + var(--tool-gap))));
    transition: transform var(--spring-fast) var(--spring-fast-ease);
    pointer-events: none;
    z-index: -1;
  }
  .annotation-toolbar-panel :global(.annotation-tool[aria-pressed='true']) {
    color: var(--annotation-ink);
  }
  .keyboard-navigation .tool-selection {
    transition: none;
  }
  .annotation-toolbar-panel :global(.annotation-tool),
  .annotation-toolbar-panel :global(.voice-action) {
    width: 36px;
    height: 40px;
  }
  .annotation-toolbar-panel :global(.annotation-tool svg),
  .annotation-toolbar-panel :global(.voice-action svg) {
    width: 20px;
    height: 20px;
  }
  .annotation-toolbar-panel
    :global(.annotation-tool[aria-pressed='true'] [data-slot='button-surface']) {
    background: transparent;
    box-shadow: none;
    filter: none;
  }
  .annotation-toolbar-panel :global(.annotation-tool:not([aria-pressed='true'])) {
    color: hsl(var(--muted-foreground));
  }
  .annotation-toolbar-panel :global(.annotation-tool:hover) {
    color: hsl(var(--foreground));
  }
  .annotation-toolbar-panel :global(.destination-chip) {
    flex: 1 1 160px;
    min-width: 56px;
    height: 40px;
    padding: 6px 8px;
    justify-content: space-between;
  }
  .destination-copy {
    display: flex;
    align-items: baseline;
    min-width: 0;
    gap: 6px;
    text-align: left;
  }
  .workspace-label,
  .recipient-label:not(.sr-only) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .workspace-label {
    font-weight: 500;
  }
  .recipient-label:not(.sr-only) {
    color: hsl(var(--muted-foreground));
  }
  .divider {
    width: 1px;
    height: 24px;
    flex-shrink: 0;
    background: hsl(var(--border));
  }
  .voice-section {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    border-radius: var(--radius-medium);
  }
  .voice-copy {
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .voice-idle {
    position: absolute;
  }
  .elapsed {
    display: flex;
    gap: 5px;
    align-items: center;
    font-variant-numeric: tabular-nums;
    padding-inline-end: 6px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: hsl(var(--danger));
  }
  .recording {
    background: hsl(var(--danger) / 0.08);
  }
  .voice-error :global(.voice-action),
  .has-notice,
  .inline-error {
    color: hsl(var(--danger));
  }
  .annotation-toolbar-panel :global(.send-action) {
    height: 40px;
    width: 36px;
    min-width: 36px;
    padding: 0;
  }
  .annotation-toolbar-panel :global(.screenshot-action) {
    width: 36px;
    min-width: 36px;
    height: 40px;
    flex-shrink: 0;
  }
  .annotation-toolbar-panel :global(.screenshot-saved) {
    color: var(--annotation-ink);
  }
  .annotation-toolbar-panel :global(.send-action[aria-busy='true']) {
    opacity: 1;
  }
  .annotation-toolbar-panel :global(.dismiss-action) {
    width: 28px;
    height: 40px;
    flex-shrink: 0;
    color: hsl(var(--muted-foreground));
  }
  .annotation-toolbar-panel :global(.annotation-destination-popover) {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    box-sizing: border-box;
    width: min(320px, calc(100vw - 16px));
    height: 232px;
    max-height: calc(100dvh - 88px);
    overflow: clip;
    padding: 12px;
    border-radius: var(--radius-large);
    z-index: 50;
    pointer-events: auto;
  }
  .destination-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    margin-bottom: 4px;
  }
  .destination-fields {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
    column-gap: 8px;
    height: 100%;
  }
  .destination-field {
    min-width: 0;
  }
  .destination-field :global(.destination-combobox) {
    position: static;
  }
  .destination-field :global(.annotation-picker-options) {
    position: absolute;
    top: 68px;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-height: none;
    display: flex;
    flex-direction: column;
  }
  .destination-field :global(.annotation-picker-options [role='listbox']) {
    flex: 1;
    min-height: 0;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .destination-notice {
    position: absolute;
    top: 68px;
    bottom: 0;
    inset-inline: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .inline-error {
    margin: 10px 0 0;
  }
  @container style(--motion-reduced: 1) {
    .tool-selection {
      transition: none;
    }
  }
  @media (max-width: 660px) {
    .annotation-toolbar-panel {
      gap: 8px;
    }
    .drawing-cluster {
      flex: 1 1 250px;
    }
    .delivery-cluster {
      flex: 1 1 270px;
    }
    .annotation-toolbar-panel :global(.destination-chip) {
      flex-basis: 110px;
    }
    .destination-copy {
      display: block;
    }
    .workspace-label,
    .recipient-label:not(.sr-only) {
      display: block;
    }
  }
  @media (max-width: 500px) {
    .annotation-toolbar-panel {
      gap: 6px;
    }
    .drawing-cluster,
    .delivery-cluster {
      gap: 3px;
      padding: 6px 4px;
    }
    .drawing-cluster {
      flex: 1 1 160px;
    }
    .delivery-cluster {
      flex: 0 1 219px;
      min-width: 167px;
    }
    .annotation-toolbar-panel :global(.destination-chip) {
      flex: 1 1 110px;
      min-width: 50px;
      padding-inline: 4px;
    }
    .divider {
      display: none;
    }
  }
  @media (max-width: 340px) {
    .delivery-cluster {
      min-width: 141px;
      flex-basis: 180px;
    }
    .annotation-toolbar-panel :global(.destination-chip) {
      min-width: 36px;
      padding-inline: 2px;
    }
    .annotation-toolbar-panel :global(.screenshot-action),
    .annotation-toolbar-panel :global(.send-action),
    .annotation-toolbar-panel :global(.voice-action) {
      width: 32px;
      min-width: 32px;
    }
    .annotation-toolbar-panel :global(.dismiss-action) {
      width: 24px;
    }
  }
</style>
