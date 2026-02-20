<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faSave,
    faXmark,
    faHashtag,
    faBold,
    faItalic,
    faList,
    faLink,
    faCode,
    faQuoteLeft,
  } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    note?: any;
    onsave?: (noteData: any) => void;
    oncancel?: () => void;
    onchange?: (noteData: any) => void;
  }

  let { note, onsave, oncancel, onchange }: Props = $props();

  let title = $state(note?.title || '');
  let content = $state(note?.content || '');
  let tags: string[] = $state(note?.tags || []);
  let tagInput = $state('');
  let isDirty = $state(false);
  let contentEditor: HTMLTextAreaElement | undefined = $state();

  // Focus and auto-resize on mount
  $effect(() => {
    if (contentEditor) {
      contentEditor.focus();
      adjustTextareaHeight();
    }
  });

  // Preserve caret and scroll when content changes externally
  $effect(() => {
    if (!contentEditor) return;
    const el = contentEditor;
    const next = content ?? '';
    if (el.value === next) return;

    const focused = document.activeElement === el;
    const start = focused ? el.selectionStart : 0;
    const end = focused ? el.selectionEnd : 0;
    const scrollTop = el.scrollTop;

    el.value = next;

    if (focused) {
      const len = el.value.length;
      const s = Math.min(start, len);
      const e = Math.min(end, len);
      try {
        el.setSelectionRange(s, e);
      } catch {}
    }

    el.scrollTop = scrollTop;
    adjustTextareaHeight();
  });

  function adjustTextareaHeight() {
    if (contentEditor) {
      contentEditor.style.height = 'auto';
      contentEditor.style.height = contentEditor.scrollHeight + 'px';
    }
  }

  function handleSave() {
    onsave?.({
      ...note,
      title,
      content,
      tags,
    });
    isDirty = false;
  }

  function handleCancel() {
    if (isDirty && !confirm('Discard unsaved changes?')) {
      return;
    }
    oncancel?.();
  }

  function handleChange() {
    isDirty = true;
    adjustTextareaHeight();
    onchange?.({
      ...note,
      title,
      content,
      tags,
    });
  }

  function addTag() {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      tags = [...tags, tagInput.trim()];
      tagInput = '';
      handleChange();
    }
  }

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag);
    handleChange();
  }

  function insertMarkdown(prefix: string, suffix = '') {
    if (!contentEditor) return;
    const start = contentEditor.selectionStart;
    const end = contentEditor.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText = prefix + selectedText + suffix;

    content = content.substring(0, start) + newText + content.substring(end);

    // Set cursor position after insertion
    setTimeout(() => {
      if (contentEditor) {
        contentEditor.focus();
        const newPosition = start + prefix.length + selectedText.length;
        contentEditor.setSelectionRange(newPosition, newPosition);
      }
    }, 0);

    handleChange();
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Keyboard shortcuts
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case 's':
          e.preventDefault();
          handleSave();
          break;
        case 'b':
          e.preventDefault();
          insertMarkdown('**', '**');
          break;
        case 'i':
          e.preventDefault();
          insertMarkdown('*', '*');
          break;
        case 'k':
          e.preventDefault();
          insertMarkdown('[', '](url)');
          break;
      }
    }

    // Tab handling for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!contentEditor) return;
      const start = contentEditor.selectionStart;
      const end = contentEditor.selectionEnd;

      if (start === end) {
        // Insert tab at cursor
        content = content.substring(0, start) + '  ' + content.substring(end);
        setTimeout(() => {
          if (contentEditor) {
            contentEditor.setSelectionRange(start + 2, start + 2);
          }
        }, 0);
      } else {
        // Indent selected lines
        const lines = content.substring(start, end).split('\n');
        const indented = lines.map((line: string) => '  ' + line).join('\n');
        content = content.substring(0, start) + indented + content.substring(end);
      }
      handleChange();
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-border">
    <h3 class="font-medium">
      {note?.id ? 'Edit Note' : 'New Note'}
    </h3>
    <div class="flex items-center gap-2">
      <button
        class="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
        onclick={handleSave}
        disabled={!isDirty}
      >
        <Fa icon={faSave} size="sm" />
        Save
      </button>
      <button class="p-1.5 rounded-md hover:bg-muted" onclick={handleCancel}>
        <Fa icon={faXmark} size="sm" />
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-4 space-y-4">
    <!-- Title -->
    <input
      type="text"
      bind:value={title}
      oninput={handleChange}
      placeholder="Note title..."
      class="w-full px-3 py-2 text-xl font-semibold bg-transparent border-b border-border focus:border-primary focus:outline-none"
    />

    <!-- Tags -->
    <div class="space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        {#each tags as tag, tagIndex (`tag-${tagIndex}-${tag}`)}
          <span class="px-2 py-1 text-sm bg-muted rounded-full flex items-center gap-1">
            #{tag}
            <button class="ml-1 hover:text-red-500" onclick={() => removeTag(tag)}>
              <Fa icon={faXmark} size="xs" />
            </button>
          </span>
        {/each}
        <div class="flex items-center gap-1">
          <Fa icon={faHashtag} size="lg" class="text-muted-foreground" />
          <input
            type="text"
            bind:value={tagInput}
            onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Add tag..."
            class="px-2 py-1 text-sm bg-transparent focus:outline-none"
          />
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="flex items-center gap-1 p-2 bg-muted rounded-md">
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('**', '**')}
        title="Bold (Cmd+B)"
      >
        <Fa icon={faBold} size="sm" />
      </button>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('*', '*')}
        title="Italic (Cmd+I)"
      >
        <Fa icon={faItalic} size="sm" />
      </button>
      <div class="w-px h-6 bg-border mx-1"></div>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('## ', '')}
        title="Heading"
      >
        H
      </button>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('- ', '')}
        title="List"
      >
        <Fa icon={faList} size="sm" />
      </button>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('> ', '')}
        title="Quote"
      >
        <Fa icon={faQuoteLeft} size="sm" />
      </button>
      <div class="w-px h-6 bg-border mx-1"></div>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('[', '](url)')}
        title="Link (Cmd+K)"
      >
        <Fa icon={faLink} size="sm" />
      </button>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('`', '`')}
        title="Inline code"
      >
        <Fa icon={faCode} size="sm" />
      </button>
      <button
        class="p-1.5 rounded hover:bg-background"
        onclick={() => insertMarkdown('```\n', '\n```')}
        title="Code block"
      >
        {'</>'}
      </button>
    </div>

    <!-- Content Editor -->
    <textarea
      bind:this={contentEditor}
      value={content}
      oninput={handleChange}
      onkeydown={handleKeyDown}
      placeholder="Start writing..."
      class="w-full min-h-[300px] p-3 bg-muted/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary resize-none font-mono text-sm leading-relaxed"
      style="font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
    ></textarea>
  </div>

  <!-- Status -->
  {#if isDirty}
    <div
      class="px-4 py-2 bg-yellow-500/10 border-t border-yellow-500/20 text-sm text-yellow-600 dark:text-yellow-400"
    >
      Unsaved changes
    </div>
  {/if}
</div>
