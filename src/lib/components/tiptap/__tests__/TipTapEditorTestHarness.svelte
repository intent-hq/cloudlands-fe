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
      content:
        content ||
        `
        <ul data-type="taskList">
          <li data-type="taskItem" data-checked="false" data-status="todo">
            <p>Todo task</p>
          </li>
          <li data-type="taskItem" data-checked="false" data-status="in-progress">
            <p>In-progress task</p>
          </li>
          <li data-type="taskItem" data-checked="true" data-status="done">
            <p>Done task</p>
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
