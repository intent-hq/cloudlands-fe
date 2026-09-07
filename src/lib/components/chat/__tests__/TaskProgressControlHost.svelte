<script lang="ts">
  import TaskProgressControl from '../TaskProgressControl.svelte';
  import type { TaskProgressItem } from '../workspace-task-fallback';

  interface Props {
    tasks: TaskProgressItem[];
    presentation?: 'status-stack' | 'checklist';
    width?: number;
    zoom?: number;
    direction?: 'ltr' | 'rtl';
    theme?: 'light' | 'dark';
  }

  let {
    tasks,
    presentation = 'status-stack',
    width = 320,
    zoom = 1,
    direction = 'ltr',
    theme = 'light',
  }: Props = $props();

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  });
</script>

<div
  data-panel-id="task-progress-test-panel"
  data-testid="task-progress-host"
  class:dark={theme === 'dark'}
  class:light={theme === 'light'}
  class="bg-background text-foreground"
  dir={direction}
  style:width="{width}px"
  style:height="240px"
  style:zoom
>
  <button type="button" data-testid="before-trigger">Before</button>
  <TaskProgressControl {tasks} {presentation} />
  <button type="button" data-testid="after-trigger">After</button>
</div>
