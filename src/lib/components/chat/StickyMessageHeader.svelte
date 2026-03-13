<script lang="ts">
  /**
   * StickyMessageHeader - Compact single-line header for sticky user messages.
   * Renders context pills and inline mentions matching ChatMessage's rendering style.
   */
  import {
    faFile,
    faCodeCompare,
    faNoteSticky,
    faClipboard,
    faArrowUp,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { AgentMessage } from '$features/agent/agent.service';
  import { extractAllContent } from '$shared/types/agent-message.conversion';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import ProviderIcon from '$lib/components/icons/ProviderIcon.svelte';
  import type { ContextProvider } from '$features/context/types';

  interface Props {
    message: AgentMessage;
    /** Called when user wants to scroll to previous user message */
    onScrollToPrevious?: () => void;
  }

  let { message, onScrollToPrevious }: Props = $props();

  // Pill type used for both context pills and metadata pills
  interface Pill {
    type: string;
    label: string;
    icon: typeof faFile;
    mentionType?: string;
  }

  // Reuse the same context pattern parsing as ChatMessage
  function parseContextPills(text: string): { pills: Pill[]; cleanText: string } {
    const pills: Pill[] = [];
    let cleanText = text;

    const contextPatterns = [
      { regex: /^\[Currently viewing file: ([^\]]+)\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/, type: 'file', icon: faFile },
      { regex: /^\[Currently viewing diff for: ([^\]]+)\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/, type: 'diff', icon: faCodeCompare },
      { regex: /^\[Currently viewing note: ([^\]]+)\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/, type: 'note', icon: faNoteSticky },
      { regex: /^\[Currently viewing: Spec\](?:\n```[^\n]*\n[\s\S]*?\n```)?\n*/, type: 'spec', icon: faClipboard, label: 'Spec' },
      { regex: /^\[Selected text from ([^\]:]+):\n```\n([\s\S]*?)\n```\]\n*/, type: 'selection', icon: faFile, hasSource: true },
      { regex: /^\[Selected text:\n```\n([\s\S]*?)\n```\]\n*/, type: 'selection', icon: faFile },
      { regex: /^\[Selected text from chat input:\n```\n([\s\S]*?)\n```\]\n*/, type: 'selection', icon: faFile },
    ];

    let foundMatch = true;
    while (foundMatch) {
      foundMatch = false;
      for (const pattern of contextPatterns) {
        const match = cleanText.match(pattern.regex);
        if (match) {
          foundMatch = true;
          let label: string;
          if ('label' in pattern && pattern.label) {
            label = pattern.label as string;
          } else if (pattern.type === 'selection') {
            const hasSource = 'hasSource' in pattern && pattern.hasSource;
            const selText = hasSource ? match[2] : match[1];
            const source = hasSource ? match[1] : null;
            const truncated = `"${selText.substring(0, 30)}${selText.length > 30 ? '...' : ''}"`;
            label = source ? `${truncated} from ${source}` : truncated;
          } else {
            label = match[1];
          }
          pills.push({ type: pattern.type, label, icon: pattern.icon });
          cleanText = cleanText.replace(pattern.regex, '');
          break;
        }
      }
    }
    return { pills, cleanText: cleanText.trim() };
  }

  // Parse inline @mentions into segments (same logic as ChatMessage)
  type Segment = { type: 'text'; content: string } | { type: 'mention'; mentionType: string; label: string; identifier?: string; icon: typeof faFile };

  function parseSegments(text: string, refsByIdentifier: Map<string, any>): Segment[] {
    const segments: Segment[] = [];
    const mentionRegex = /@(context\[[^\]]+\]|note\/[^\s]+|[^\s@]+\.[a-zA-Z]+(?::[L\d-]+)?|[^\s@]*\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      const captured = match[1];
      if (captured.startsWith('context[')) {
        const inner = captured.slice(8, -1);
        let provider = 'browser', identifier = '', title = '';
        if (inner.startsWith('eyJ')) {
          try { const j = JSON.parse(atob(inner)); provider = j.provider || 'browser'; identifier = j.identifier || ''; title = j.title || identifier || 'Context'; } catch { const p = inner.split('|'); provider = p[0] || 'browser'; identifier = p[1] || ''; title = p[2] || identifier; }
        } else {
          const p = inner.split('|'); provider = p[0] || 'browser'; identifier = p[1] || ''; title = p[2] || identifier;
        }
        segments.push({ type: 'mention', mentionType: provider, label: title, identifier: identifier || undefined, icon: faFile });
      } else if (captured.startsWith('note/')) {
        const noteId = captured.slice(5);
        const notes = notesStateManager.notes;
        const n = notes ? Array.from(notes.values()).find((n) => n.id === noteId) : null;
        segments.push({ type: 'mention', mentionType: noteId === 'spec' ? 'spec' : 'note', label: n?.title || noteId, icon: noteId === 'spec' ? faClipboard : faNoteSticky });
      } else {
        const fileName = captured.split('/').pop() || captured;
        segments.push({ type: 'mention', mentionType: 'file', label: fileName, icon: faFile });
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) });
    if (segments.length === 0 && text) segments.push({ type: 'text', content: text });
    return segments;
  }

  // Metadata pills from contextReferences
  function metadataPills(refs: any[]): Pill[] {
    return refs.map((ref) => {
      const provider = ref.provider || ref.source || ref.type || ref.itemType || '';
      const label = ref.identifier || ref.title || 'Context';
      const mentionType = ['linear', 'github', 'sentry'].includes(provider) ? provider : undefined;
      return { type: provider || 'external', label, icon: faFile, mentionType };
    });
  }

  const parsed = $derived.by(() => {
    const rawText = extractAllContent(message);
    const { pills, cleanText } = parseContextPills(rawText);
    const metadataRefs = message?.metadata?.contextReferences;
    const refsByIdentifier = new Map<string, any>();
    if (Array.isArray(metadataRefs)) {
      for (const ref of metadataRefs) { if (ref.identifier) refsByIdentifier.set(ref.identifier, ref); }
    }
    const segments = parseSegments(cleanText, refsByIdentifier);
    const inlineIds = new Set(segments.filter((s) => s.type === 'mention').map((s) => (s as any).identifier || (s as any).label));
    const extraPills = Array.isArray(metadataRefs) ? metadataPills(metadataRefs.filter((r: any) => !r.identifier || !inlineIds.has(r.identifier))) : [];
    return { pills: [...extraPills, ...pills], segments };
  });
</script>

<div class="group/sticky-header relative h-fit min-w-0 px-2 pt-2 pb-2 text-subtle whitespace-nowrap text-ellipsis leading-normal bg-sidebar rounded-xs w-full max-w-full truncate">
  {#each parsed.pills as pill (`${pill.type}-${pill.label}`)}
    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted/60 text-muted-foreground rounded-md text-xs whitespace-nowrap font-medium mx-0.5 align-middle">
      {#if pill.mentionType && ['linear', 'github', 'sentry'].includes(pill.mentionType)}
        <ProviderIcon provider={pill.mentionType as ContextProvider} size={10} class="shrink-0 opacity-30" />
      {:else}
        <Fa icon={pill.icon} size="10" class="opacity-50" />
      {/if}
      <span class="truncate max-w-[120px]">{pill.label}</span>
    </span>
  {/each}
  {#each parsed.segments as segment, i (i)}
    {#if segment.type === 'text'}
      <span>{segment.content}</span>
    {:else if segment.type === 'mention'}
      {@const isContextProvider = ['linear', 'github', 'sentry', 'browser'].includes(segment.mentionType)}
      <span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted/60 text-muted-foreground rounded-md text-xs whitespace-nowrap font-medium mx-0.5 align-middle">
        {#if isContextProvider}
          <ProviderIcon provider={segment.mentionType as ContextProvider} size={10} class="shrink-0 opacity-30" />
        {:else}
          <Fa icon={segment.icon} size="10" class="opacity-30" />
        {/if}
        {#if segment.identifier}
          <span class="text-subtle shrink-0">{segment.identifier}</span>
        {/if}
        <span class="max-w-[120px] truncate">{segment.label}</span>
      </span>
    {/if}
  {/each}
  <!-- Scroll to previous button (visible on hover) -->
  {#if onScrollToPrevious}
    <div
      class="absolute top-1 right-1 flex items-center gap-0.5 bg-sidebar/95 backdrop-blur-sm rounded-md border border-border opacity-0 group-hover/sticky-header:opacity-100"
    >
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          onScrollToPrevious();
        }}
        title="Scroll to previous message"
      >
        <Fa icon={faArrowUp} class="w-2.5! h-2.5!" />
      </Button>
    </div>
  {/if}
</div>
