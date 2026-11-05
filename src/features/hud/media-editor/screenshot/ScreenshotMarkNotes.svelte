<script lang="ts" module>
  export interface ScreenshotMarkCard {
    id: string;
    n: number;
    kind: string;
    note: string;
    text?: string;
    element?: { path: string | null; name: string } | null;
  }
</script>

<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Input } from '$lib/components/ui/input';
  import MicrophoneIcon from 'phosphor-svelte/lib/MicrophoneIcon';
  import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
  let {
    items,
    selectedId,
    disabled = false,
    dictatingId = null,
    onSelect,
    onNote,
    onText,
    onElement,
    onDelete,
    onDictation,
  }: {
    items: readonly ScreenshotMarkCard[];
    selectedId: string | null;
    disabled?: boolean;
    dictatingId?: string | null;
    onElement?: (id: string, selector: string, text: string) => void;
    onSelect: (id: string) => void;
    onNote: (id: string, note: string) => void;
    onText: (id: string, text: string) => void;
    onDelete: (id: string) => void;
    onDictation?: (id: string, phase: 'start' | 'stop') => void;
  } = $props();
  let list = $state<HTMLElement | null>(null);
  let held: string | null = null;
  $effect(() => {
    if (selectedId)
      list
        ?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  });
  onDestroy(stop);
  function stop() {
    if (held) {
      onDictation?.(held, 'stop');
      held = null;
    }
  }
</script>

<aside bind:this={list} class="notes" aria-label={m.dock_screenshotEditor_marks()}>
  <p class="type-caption heading">{m.dock_screenshotEditor_marks()}</p>
  {#if !items.length}<p class="type-caption empty">
      {m.dock_screenshotEditor_empty()}
    </p>{/if}
  {#each items as item (item.id)}
    <section class="card" class:selected={selectedId === item.id} data-note-id={item.id}>
      <div class="card-top">
        <Button
          variant="ghost"
          size="compact"
          class="mark-label"
          onclick={() => onSelect(item.id)}
          aria-pressed={selectedId === item.id}
        >
          <span class="badge" aria-hidden="true">{item.n}</span><span
            >{m.dock_screenshotEditor_mark({ n: item.n, kind: item.kind })}</span
          >
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={m.dock_screenshotEditor_deleteMark({ n: item.n })}
          {disabled}
          onclick={() => onDelete(item.id)}><TrashIcon size={14} /></Button
        >
      </div>
      {#if item.text !== undefined}
        <Textarea
          aria-label={m.dock_screenshotEditor_textFor({ n: item.n })}
          minHeight={48}
          autoResize
          maxlength={10000}
          value={item.text}
          {disabled}
          onfocus={() => onSelect(item.id)}
          oninput={(event) => onText(item.id, event.currentTarget.value)}
        />
      {/if}
      {#if item.element}
        <Input
          aria-label={m.dock_screenshotEditor_selectorFor({ n: item.n })}
          placeholder={m.dock_screenshotEditor_selectorPlaceholder()}
          maxlength={8192}
          value={item.element.path ?? ''}
          {disabled}
          onfocus={() => onSelect(item.id)}
          oninput={(event) =>
            onElement?.(item.id, event.currentTarget.value, item.element?.name ?? '')}
        />
        <Input
          aria-label={m.dock_screenshotEditor_elementTextFor({ n: item.n })}
          placeholder={m.dock_screenshotEditor_elementTextPlaceholder()}
          maxlength={20000}
          value={item.element.name}
          {disabled}
          onfocus={() => onSelect(item.id)}
          oninput={(event) =>
            onElement?.(item.id, item.element?.path ?? '', event.currentTarget.value)}
        />
      {/if}
      <Textarea
        aria-label={m.dock_screenshotEditor_noteFor({ n: item.n })}
        placeholder={m.dock_screenshotEditor_notePlaceholder()}
        maxlength={20000}
        value={item.note}
        {disabled}
        minHeight={48}
        autoResize
        onfocus={() => onSelect(item.id)}
        oninput={(event) => onNote(item.id, event.currentTarget.value)}
      />
      <Button
        variant="ghost"
        size="compact"
        disabled={disabled || !onDictation}
        tooltip={onDictation ? undefined : m.dock_screenshotEditor_dictationUnavailable()}
        aria-label={m.dock_screenshotEditor_holdFor({ n: item.n })}
        aria-pressed={dictatingId === item.id}
        onpointerdown={(event) => {
          if (disabled || !onDictation || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          held = item.id;
          onSelect(item.id);
          onDictation?.(item.id, 'start');
        }}
        onpointerup={stop}
        onpointercancel={stop}
        onlostpointercapture={stop}
        onkeydown={(event) => {
          if (event.key === ' ' && !event.repeat && !disabled && !!onDictation) {
            event.preventDefault();
            held = item.id;
            onDictation?.(item.id, 'start');
          }
        }}
        onkeyup={(event) => {
          if (event.key === ' ') {
            event.preventDefault();
            stop();
          }
        }}
        onblur={stop}
      >
        <MicrophoneIcon size={14} />{dictatingId === item.id
          ? m.dock_composer_listening_status()
          : m.dock_screenshotEditor_hold()}
      </Button>
    </section>
  {/each}
</aside>

<style>
  .notes {
    min-width: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
  }
  .heading {
    margin: 0;
    color: hsl(var(--muted-foreground));
  }
  .empty {
    color: hsl(var(--muted-foreground));
    line-height: 1.6;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    padding: 8px;
    background: hsl(var(--background));
  }
  .card.selected {
    border-color: hsl(var(--primary));
    box-shadow: 0 0 0 1px hsl(var(--primary));
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .card :global(.mark-label) {
    min-width: 0;
    justify-content: start;
    padding-inline: 0;
  }
  .badge {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-variant-numeric: tabular-nums;
  }
  .element {
    margin: 0;
    overflow-wrap: anywhere;
    color: hsl(var(--muted-foreground));
  }
</style>
