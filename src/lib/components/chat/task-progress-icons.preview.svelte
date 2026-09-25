<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface PreviewProps {
    presentation: 'status-stack' | 'checklist';
    scenario?: 'seven' | 'eight' | 'long' | 'completed' | 'empty';
  }

  export const preview = definePreview<PreviewProps>({
    id: 'task-progress-icons',
    title: 'Task list status icons',
    defaultState: 'checklist',
    states: {
      checklist: { props: { presentation: 'checklist' } },
      stack: { props: { presentation: 'status-stack' } },
      'threshold-eight': { props: { presentation: 'checklist', scenario: 'eight' } },
      'long-list': { props: { presentation: 'checklist', scenario: 'long' } },
      'long-stack': { props: { presentation: 'status-stack', scenario: 'long' } },
      completed: { props: { presentation: 'checklist', scenario: 'completed' } },
      empty: { props: { presentation: 'checklist', scenario: 'empty' } },
    },
  });
</script>

<script lang="ts">
  import TaskProgressControl from './TaskProgressControl.svelte';
  import type { TaskProgressItem } from './workspace-task-fallback';

  let { presentation = 'checklist', scenario = 'seven' }: Partial<PreviewProps> = $props();
  const baseTasks: TaskProgressItem[] = [
    {
      id: 'review',
      status: 'review_required',
      title: 'Review the prepared task list and keyboard navigation',
    },
    {
      id: 'waiting',
      status: 'waiting',
      title: 'Wait for the isolated review environment to become ready',
    },
    { id: 'running', status: 'running', title: 'Prepare and launch the live review environments' },
    {
      id: 'discussion',
      status: 'discussion_needed',
      title: 'Discuss the next steps for the interface review',
    },
    {
      id: 'blocked',
      status: 'blocked',
      title: 'Resolve the missing preview data before continuing',
    },
    {
      id: 'pending',
      status: 'pending',
      title: 'Inspect the remaining task rows and their status icons',
    },
    {
      id: 'complete',
      status: 'completed',
      title: 'Capture the finished review for the implementation handoff',
    },
  ];
  const tasks = $derived.by((): TaskProgressItem[] => {
    if (scenario === 'empty') return [];
    if (scenario === 'completed')
      return baseTasks.map((task) => ({ ...task, status: 'completed' }));
    if (scenario === 'eight')
      return [
        ...baseTasks,
        {
          id: 'keyboard',
          status: 'pending',
          title: 'Review keyboard navigation at the search threshold',
        },
      ];
    if (scenario === 'long')
      return [
        ...baseTasks,
        ...Array.from({ length: 13 }, (_, index): TaskProgressItem => ({
          id: `extra-${index}`,
          status: index % 3 === 0 ? 'completed' : 'pending',
          title:
            index % 2 === 0
              ? `Review narrow layouts and long translated labels in panel ${index + 1}`
              : `تحقق من المهمة ${index + 1} with English details and עברית`,
        })),
      ];
    return baseTasks;
  });
</script>

<section
  class="w-full max-w-80 min-h-96 rounded-xl border border-border bg-background p-4 text-foreground"
  data-panel-id="task-progress-icons-preview"
  data-testid="task-progress-icons-preview"
>
  <header class="flex items-center justify-between gap-4">
    <h2 class="type-body font-semibold">Task list</h2>
    <TaskProgressControl {tasks} {presentation} />
  </header>
</section>
