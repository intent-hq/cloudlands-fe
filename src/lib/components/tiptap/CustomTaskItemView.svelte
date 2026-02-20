<script lang="ts">
  import type { NodeViewProps } from '@tiptap/core';
  import { NodeViewWrapper, NodeViewContent } from 'svelte-tiptap';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import { createLogger } from '$lib/utils/client-logger';
  import Fa from 'svelte-fa-original';
  import { faList, faPlay } from '@fortawesome/free-solid-svg-icons';
  import TaskAgentCard from './TaskAgentCard.svelte';
  import { toPromptToken } from '$lib/services/mentions/format';

  const logger = createLogger('CustomTaskItemView');

  let { node, getPos, updateAttributes }: NodeViewProps = $props();

  // Reactive state - ensure these are always defined
  const checked = $derived(node?.attrs?.checked ?? false);
  const delegatedAgentId = $derived(node?.attrs?.delegatedAgentId ?? null);

  // Get agent state if delegated
  const workspace = $derived(unifiedStateStore.getCurrentWorkspace());
  const agent = $derived(
    delegatedAgentId && workspace ? workspace.agents.get(delegatedAgentId) : null,
  );

  /**
   * Serialize a text node, handling marks like mentions
   */
  function serializeTextNode(textNode: any): string {
    if (textNode.marks) {
      for (const mark of textNode.marks) {
        if (mark.type.name === 'mention') {
          try {
            return toPromptToken({
              type: mark.attrs?.type,
              id: mark.attrs?.id,
              label: mark.attrs?.label,
              meta: mark.attrs?.meta,
            });
          } catch {
            return mark.attrs?.label || textNode.text || '';
          }
        }
      }
    }
    return textNode.text || '';
  }

  /**
   * Recursively process node content, preserving structure for lists
   */
  function processNode(n: any, depth: number = 0): string {
    if (n.isText) {
      return serializeTextNode(n);
    }

    // Handle hard breaks (shift+enter)
    if (n.type?.name === 'hardBreak') {
      return '\n';
    }

    const typeName = n.type?.name;

    // Handle bullet lists - join items with newlines and add bullet prefix
    if (typeName === 'bulletList') {
      const items: string[] = [];
      n.content?.forEach((child: any) => {
        const itemText = processNode(child, depth + 1);
        if (itemText) {
          items.push('- ' + itemText);
        }
      });
      return items.join('\n');
    }

    // Handle ordered lists - join items with newlines and add number prefix
    if (typeName === 'orderedList') {
      const items: string[] = [];
      let index = 1;
      n.content?.forEach((child: any) => {
        const itemText = processNode(child, depth + 1);
        if (itemText) {
          items.push(`${index}. ` + itemText);
          index++;
        }
      });
      return items.join('\n');
    }

    // Handle list items - process content without extra prefix
    if (typeName === 'listItem') {
      const parts: string[] = [];
      n.content?.forEach((child: any) => {
        const text = processNode(child, depth);
        if (text) {
          parts.push(text);
        }
      });
      return parts.join('\n');
    }

    if (n.content && n.content.size > 0) {
      const childTexts: string[] = [];
      n.content.forEach((child: any) => {
        const childText = processNode(child, depth);
        if (childText) {
          childTexts.push(childText);
        }
      });
      return childTexts.join('');
    }

    return '';
  }

  // Extract task text from node content, serializing rich content like mentions
  const taskText = $derived.by(() => {
    const parts: string[] = [];
    if (node && node.content && node.content.size > 0) {
      node.content.forEach((child: any) => {
        const text = processNode(child);
        if (text) {
          parts.push(text);
        }
      });
    }
    // Join paragraphs with newlines
    return parts.join('\n').trim();
  });

  function handleCheckboxChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (updateAttributes) {
      updateAttributes({ checked: target.checked });
    }
  }

  function handleDelegate() {
    logger.info('Delegating task', { taskText, checked });

    // Dispatch custom event for parent to handle
    const event = new CustomEvent('task-delegate', {
      detail: {
        text: taskText,
        checked: checked.toString(),
        position: getPos ? getPos()?.toString() : '0',
      },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  function handleSplit() {
    logger.info('Splitting task', { taskText, checked });

    // Dispatch custom event for parent to handle
    const event = new CustomEvent('task-split', {
      detail: {
        text: taskText,
        checked: checked.toString(),
        position: getPos ? getPos()?.toString() : '0',
      },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  function handleViewConversation() {
    if (delegatedAgentId) {
      window.open(`/agent/${delegatedAgentId}`, '_blank');
    }
  }
</script>

<NodeViewWrapper
  as="li"
  class="group flex items-start gap-2 py-1"
  data-type="taskItem"
  data-checked={checked ? 'true' : undefined}
  data-delegated-agent-id={delegatedAgentId}
>
  <!-- Checkbox -->
  <input
    type="checkbox"
    {checked}
    onchange={handleCheckboxChange}
    class="mt-1 shrink-0 h-4 w-4 rounded border-border accent-primary cursor-pointer"
  />

  <!-- Content (editable) -->
  <NodeViewContent class="flex-1 min-w-0 {checked ? 'line-through opacity-60' : ''}" />

  <!-- Action buttons -->
  <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
    <button
      onclick={handleDelegate}
      class="p-1 rounded hover:bg-accent/50 transition-colors"
      title="Delegate to agent"
      aria-label="Delegate to agent"
    >
      <Fa icon={faPlay} class="w-3.5 h-3.5 text-muted-foreground" />
    </button>

    <button
      onclick={handleSplit}
      class="p-1 rounded hover:bg-accent/50 transition-colors"
      title="Split into subtasks"
      aria-label="Split into subtasks"
    >
      <Fa icon={faList} class="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  </div>
</NodeViewWrapper>

<!-- Agent card shown below the task when delegated -->
{#if delegatedAgentId && agent}
  <div class="ml-6 mt-2">
    <TaskAgentCard agentId={delegatedAgentId} onViewConversation={handleViewConversation} />
  </div>
{/if}
