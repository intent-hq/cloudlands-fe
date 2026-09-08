<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import TaskList from '@tiptap/extension-task-list';
  import { CustomTaskItem } from '../CustomTaskItem';

  let editorElement: HTMLDivElement;
  let editor: Editor | null = null;

  interface Props {
    content?: string;
  }

  let { content = '' }: Props = $props();

  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit,
        TaskList,
        CustomTaskItem.configure({
          nested: true,
          taskListTypeName: 'taskList',
        }),
      ],
      // CustomTaskItem's parse rule expects task item content inside a <div>
      // wrapper (contentElement: 'div').
      content:
        content ||
        `
        <ul data-type="taskList">
          <li data-type="taskItem" data-checked="false" data-status="todo">
            <div><p>Todo task</p></div>
          </li>
          <li data-type="taskItem" data-checked="false" data-status="in-progress">
            <div><p>In-progress task</p></div>
          </li>
          <li data-type="taskItem" data-checked="true" data-status="done">
            <div><p>Done task</p></div>
          </li>
        </ul>
      `,
    });
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
  });
</script>

<div bind:this={editorElement} class="editor" data-testid="tiptap-editor"></div>

<style>
  .editor {
    min-height: 200px;
    padding: 1rem;
    border: 1px solid #ccc;
  }
</style>
