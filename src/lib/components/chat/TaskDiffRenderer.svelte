<script lang="ts">
  import {
    faCirclePlus,
    faArrowUp,
    faTrash,
    faChevronDown,
    faCircle,
    faCircleHalfStroke,
    faCircleCheck,
    faCircleXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { TaskDiffSections, ParsedTask } from './tool-result-parser';
  import { m } from '$shared/paraglide/messages.js';
  import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
  } from '$lib/components/ui/accordion';

  interface Props {
    sections: TaskDiffSections;
  }

  let { sections }: Props = $props();

  // Track which sections are expanded
  let expandedSections = $state<string[]>(['created', 'updated', 'deleted']);

  // Get icon for task state
  function getTaskStateIcon(state: ParsedTask['state']) {
    switch (state) {
      case 'COMPLETE':
        return faCircleCheck;
      case 'IN_PROGRESS':
        return faCircleHalfStroke;
      case 'CANCELLED':
        return faCircleXmark;
      default:
        return faCircle;
    }
  }

  // Get color value for task state
  function getTaskStateColor(state: ParsedTask['state']) {
    switch (state) {
      case 'COMPLETE':
        return 'var(--color-emerald-500, #10b981)';
      case 'IN_PROGRESS':
        return 'var(--color-blue-500, #3b82f6)';
      case 'CANCELLED':
        return 'color-mix(in srgb, var(--color-muted-foreground, #64748b) 50%, transparent)';
      default:
        return 'color-mix(in srgb, var(--color-muted-foreground, #64748b) 40%, transparent)';
    }
  }

  const sectionConfig = [
    {
      key: 'created' as const,
      label: 'Created',
      icon: faCirclePlus,
      iconColor: 'var(--color-emerald-500, #10b981)',
    },
    {
      key: 'updated' as const,
      label: 'Updated',
      icon: faArrowUp,
      iconColor: 'var(--color-blue-500, #3b82f6)',
    },
    {
      key: 'deleted' as const,
      label: 'Deleted',
      icon: faTrash,
      iconColor: 'var(--color-red-500, #ef4444)',
    },
  ];

  const hasAnyTasks = $derived(
    sections.created.length > 0 || sections.updated.length > 0 || sections.deleted.length > 0,
  );
</script>

{#if hasAnyTasks}
  <Accordion type="multiple" bind:value={expandedSections} class="task-diff-renderer">
    {#each sectionConfig as config}
      {#if sections[config.key].length > 0}
        <AccordionItem value={config.key} class="section">
          <AccordionTrigger class="section-header">
            <span class="section-icon" style:color={config.iconColor}>
              <Fa icon={config.icon} size="xs" />
            </span>
            <span class="section-label">{config.label}</span>
            <span class="section-count">({sections[config.key].length})</span>
            <span class="chevron" class:expanded={expandedSections.includes(config.key)}>
              <Fa icon={faChevronDown} size="xs" />
            </span>
          </AccordionTrigger>

          <AccordionContent class="section-content">
            {#each sections[config.key] as task (task.uuid)}
              <div class="task-item">
                <span class="task-state-icon" style:color={getTaskStateColor(task.state)}>
                  <Fa icon={getTaskStateIcon(task.state)} size="xs" />
                </span>
                <span class="task-name" class:cancelled={task.state === 'CANCELLED'}>
                  {task.name}
                </span>
              </div>
            {/each}
          </AccordionContent>
        </AccordionItem>
      {/if}
    {/each}
  </Accordion>
{:else}
  <div class="empty-state">{m.chat_taskDiffRenderer_noChanges_label()}</div>
{/if}

<style>
  .task-diff-renderer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .section {
    border-radius: 0.375rem;
    overflow: hidden;
    background: var(--color-muted, #f8fafc);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-foreground, #1e293b);
    text-align: left;
  }

  .section-header:hover {
    background: var(--color-muted-foreground, #64748b) / 0.05;
  }

  .section-count {
    color: var(--color-muted-foreground, #64748b);
    font-weight: 400;
  }

  .chevron {
    margin-left: auto;
    transition: transform 0.15s ease;
    color: var(--color-muted-foreground, #64748b);
  }

  .chevron.expanded {
    transform: rotate(180deg);
  }

  .section-content {
    padding: 0.25rem 0.75rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.8125rem;
  }

  .task-name {
    color: var(--color-foreground, #1e293b);
  }

  .task-name.cancelled {
    text-decoration: line-through;
    color: var(--color-muted-foreground, #64748b);
  }

  .empty-state {
    text-align: center;
    padding: 1rem;
    color: var(--color-muted-foreground, #64748b);
    font-size: 0.875rem;
  }

  .section-icon {
    display: inline-flex;
    align-items: center;
  }

  .task-state-icon {
    display: inline-flex;
    align-items: center;
  }
</style>
