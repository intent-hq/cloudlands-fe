<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ presentation: 'status-stack' | 'checklist' }>({
    id: 'task-progress-icons',
    title: 'Task list status icons',
    defaultState: 'checklist',
    states: {
      checklist: { props: { presentation: 'checklist' } },
      stack: { props: { presentation: 'status-stack' } },
    },
  });
</script>

<script lang="ts">
  import TaskProgressControl from './TaskProgressControl.svelte';
  import type { TaskProgressItem } from './workspace-task-fallback';

  let { presentation = 'checklist' }: { presentation?: 'status-stack' | 'checklist' } = $props();
  const tasks: TaskProgressItem[] = [
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
