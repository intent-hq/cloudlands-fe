<script lang="ts">
  /**
   * RichTextarea - A simple rich text input for workspace initializers
   * Supports @ mentions, images, and markdown without the full chat toolbar
   */
  import TipTapEditor from '$lib/components/chat/input/TipTapEditor.svelte';
  import type { Workspace } from '$shared/types';

  interface Props {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    workspace?: Workspace | null;
    repoPath?: string;
    class?: string;
    minHeight?: number;
    maxHeight?: number;
    autoFocus?: boolean;
    onsubmit?: () => void;
    onfocus?: () => void;
    onblur?: () => void;
    onchange?: (value: string) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  }

  let {
    value = $bindable(''),
    placeholder = 'What would you like to work on?',
    disabled = false,
    workspace = null,
    repoPath,
    class: className = '',
    minHeight = 80,
    maxHeight = 300,
    autoFocus = false,
    onsubmit,
    onfocus,
    onblur,
    onchange,
    onkeydown,
  }: Props = $props();

  let tiptapEditor: any = $state(null);
  let isFocused = $state(false);

  // Expose methods to parent
  export function focus() {
    tiptapEditor?.focus();
  }

  export function focusEnd() {
    tiptapEditor?.focusEnd();
  }

  export function focusAndSelectAll() {
    tiptapEditor?.focusAndSelectAll();
  }

  export function clear() {
    tiptapEditor?.clear();
    value = '';
  }

  export function getHTML(): string {
    return tiptapEditor?.getHTML() ?? '';
  }

  export function getText(): string {
    return tiptapEditor?.getTextContent() ?? '';
  }

  export function insertContextMention(
    attrs: Parameters<typeof tiptapEditor.insertContextMention>[0],
  ): boolean {
    return tiptapEditor?.insertContextMention(attrs) ?? false;
  }

  export function insertMention(attrs: {
    id: string;
    label: string;
    type: string;
    uri: string;
    meta?: Record<string, unknown>;
  }): boolean {
    return tiptapEditor?.insertMention(attrs) ?? false;
  }

  export async function setContent(text: string): Promise<void> {
    // Call TipTapEditor's setContent directly to ensure the editor is updated immediately
    // This is important when followed by insertMention/insertText calls
    await tiptapEditor?.setContent(text);
    value = text;
  }

  export function insertText(text: string): boolean {
    return tiptapEditor?.insertText(text) ?? false;
  }

  export function getContextMentions(): ReturnType<typeof tiptapEditor.getContextMentions> {
    return tiptapEditor?.getContextMentions() ?? [];
  }

  export function getMentions(): ReturnType<typeof tiptapEditor.getMentions> {
    return tiptapEditor?.getMentions() ?? [];
  }

  export function getInlineImages(): ReturnType<typeof tiptapEditor.getInlineImages> {
    return tiptapEditor?.getInlineImages() ?? [];
  }

  export function insertImage(dataUrl: string, alt?: string): void {
    tiptapEditor?.insertImage(dataUrl, alt);
  }

  function handleUpdate(content: string) {
    value = content;
    onchange?.(content);
  }

  // Only Cmd+Enter submits - Enter creates new lines for multi-line input
  function handleForceSubmit() {
    onsubmit?.();
  }

  function handleFocus() {
    isFocused = true;
    onfocus?.();
  }

  function handleBlur() {
    isFocused = false;
    onblur?.();
  }
</script>

<div
  class="rich-textarea {className}"
  class:is-focused={isFocused}
  class:is-disabled={disabled}
  onfocusin={handleFocus}
  onfocusout={handleBlur}
  {onkeydown}
  role="textbox"
  tabindex="-1"
>
  <TipTapEditor
    bind:this={tiptapEditor}
    {value}
    {placeholder}
    {disabled}
    workspace={workspace ?? undefined}
    {repoPath}
    {minHeight}
    {maxHeight}
    {autoFocus}
    onUpdate={handleUpdate}
    onForceSubmit={handleForceSubmit}
    editorClassName="rich-textarea-editor"
  />
</div>

<style>
  .rich-textarea {
    width: 100%;
    position: relative;
  }

  :global(.rich-textarea .tiptap-container) {
    background: transparent;
    border: none;
  }

  :global(.rich-textarea .rich-textarea-editor) {
    padding: 0.75rem 1rem;
  }

  :global(.rich-textarea .tiptap-editor p) {
    margin: 0;
  }

  /* Placeholder styling */
  /* :global(.rich-textarea .tiptap-editor p.is-editor-empty:first-child::before) {
    color: hsl(var(--muted-foreground));
  } */
</style>
