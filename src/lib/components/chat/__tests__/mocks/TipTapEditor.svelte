<script lang="ts">
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  export let onUpdate: ((value: string) => void) | undefined;
  export let onEscape: (() => void) | undefined;
  export let trailingHint:
    | {
        kind: 'ready' | 'enhancing' | 'enhanced';
        label: string;
        shortcut?: string;
        icon?: 'dismiss' | 'undo';
        ariaLabel: string;
        onActivate: () => void;
      }
    | null
    | undefined;

  export function focus() {}
  export function getInlineImages() {
    return [];
  }
  // Records mention insertions on a window-scoped array so tests can assert
  // path-reference chips (e.g. the oversized-attachment placement flow).
  export function insertMention(attrs: Record<string, unknown>): boolean {
    const target = window as unknown as { __tiptapInsertMentionCalls?: unknown[] };
    (target.__tiptapInsertMentionCalls ??= []).push(attrs);
    return true;
  }
</script>

<textarea
  data-testid="tiptap-editor"
  {value}
  {placeholder}
  {disabled}
  oninput={(event) => onUpdate?.((event.currentTarget as HTMLTextAreaElement).value)}
  onkeydown={(event) => event.key === 'Escape' && onEscape?.()}></textarea>

{#if trailingHint?.icon}
  <span data-testid="prompt-trailing-hint" data-state={trailingHint.kind}>
    {trailingHint.label}
    <button
      type="button"
      data-testid="prompt-trailing-action"
      aria-label={trailingHint.ariaLabel}
      onclick={trailingHint.onActivate}
    >
      {trailingHint.icon}
    </button>
  </span>
{:else if trailingHint}
  <button
    type="button"
    data-testid="prompt-trailing-hint"
    data-state={trailingHint.kind}
    aria-label={trailingHint.ariaLabel}
    onclick={trailingHint.onActivate}
  >
    {trailingHint.label}
    {#if trailingHint.shortcut}<kbd>{trailingHint.shortcut}</kbd>{/if}
  </button>
{/if}
