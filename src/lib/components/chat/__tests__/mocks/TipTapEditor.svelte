<script lang="ts">
  import type { SkillInfo } from '$store/renderer/slices/skills/skills-types';

  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  export let onUpdate: ((value: string) => void) | undefined;
  export let onSubmit: (() => void) | undefined;
  export let onForceSubmit: (() => void) | undefined;
  export let skills: readonly SkillInfo[] = [];
  export let skillsLoading = false;
  export let skillsError: string | null = null;
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
  data-skills={skills.map(({ name }) => name).join(',')}
  data-skills-loading={skillsLoading}
  data-skills-error={skillsError ?? ''}
  oninput={(event) => onUpdate?.((event.currentTarget as HTMLTextAreaElement).value)}
  onkeydown={(event) => {
    if (event.key === 'Escape') onEscape?.();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      onForceSubmit?.();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit?.();
    }
  }}></textarea>

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
