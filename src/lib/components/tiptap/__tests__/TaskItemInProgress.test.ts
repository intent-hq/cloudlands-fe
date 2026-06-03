/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

// ─── Mock Redux selectors and dispatch bridge ───────────────────────────────
// CustomTaskItem renders TaskItemNodeView.svelte which calls these at init time
const mockReadable = (value: any) => ({
  subscribe: (fn: (v: any) => void) => {
    fn(value);
    return () => {};
  },
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => mockReadable(null),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => mockReadable(undefined), {
    select: () => undefined,
  }),
  selectSelectedNoteId: Object.assign(() => mockReadable(null), {
    select: () => null,
  }),
  selectNotesVersion: () => mockReadable(0),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/workspace-notes/workspace-notes-slice')>()),
  updateTaskStatus: vi.fn(),
  handleExternalNoteUpdate: vi.fn(),
  reloadNotes: vi.fn(),
}));

vi.mock('$lib/utils/notes-ipc', () => ({
  notesIpc: vi.fn(),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: vi.fn(),
}));

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from '../CustomTaskItem';
import { TaskListShortcuts } from '$lib/utils/task-list-shortcuts';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

describe('TaskItem In-Progress State Spike', () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    const container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    document.body.innerHTML = '';
  });

  describe('Test 1: Input Rule Recognition', () => {
    it('should convert [/] markdown to a task item with status: in-progress', async () => {
      // Test markdown-to-HTML-to-ProseMirror round-trip
      const markdown = '- [/] In-progress task';

      const html = await processMarkdownToHTML(markdown);
      console.log('HTML from markdown:', html);

      // Create editor with extended TaskItem
      editor = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList.configure({
            HTMLAttributes: {
              class: 'task-list',
            },
          }),
          CustomTaskItem.configure({
            nested: true,
            HTMLAttributes: {
              class: 'custom-task-item',
            },
            taskListTypeName: 'taskList',
          }),
          TaskListShortcuts,
        ],
        content: html,
      });

      // Check if it converted to a task item
      const json = editor.getJSON();
      console.log('Editor JSON after loading HTML:', JSON.stringify(json, null, 2));

      // We expect to find a taskItem with status: 'in-progress'
      const taskList = json.content?.find((node: any) => node.type === 'taskList');
      expect(taskList).toBeDefined();

      if (taskList) {
        const taskItem = taskList.content?.[0];
        expect(taskItem?.type).toBe('taskItem');
        expect(taskItem?.attrs?.status).toBe('in-progress');
        expect(taskItem?.attrs?.checked).toBe(false);

        // Verify the text content doesn't include [/]
        const textContent = taskItem?.content?.[0]?.content?.[0]?.text;
        expect(textContent).toBe('In-progress task');
      }
    });
  });

  describe('Test 2: Attribute Persistence', () => {
    it('should preserve status attribute through serialization/deserialization', async () => {
      // Create editor with in-progress task
      const markdown = '- [/] In-progress task';
      const html = await processMarkdownToHTML(markdown);

      editor = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            taskListTypeName: 'taskList',
          }),
        ],
        content: html,
      });

      // Get the initial JSON
      const initialJSON = editor.getJSON();
      const initialTaskItem = initialJSON.content?.[0]?.content?.[0];
      expect(initialTaskItem?.attrs?.status).toBe('in-progress');

      // Serialize to HTML and back
      const serializedHTML = editor.getHTML();

      // Create a new editor with the serialized HTML
      const editor2 = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            taskListTypeName: 'taskList',
          }),
        ],
        content: serializedHTML,
      });

      // Check if status attribute persisted
      const finalJSON = editor2.getJSON();
      const finalTaskItem = finalJSON.content?.[0]?.content?.[0];
      expect(finalTaskItem?.attrs?.status).toBe('in-progress');

      editor2.destroy();
    });
  });

  describe('Test 3: Existing Functionality Preserved', () => {
    it('should still handle [ ] for unchecked tasks', () => {
      editor = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            taskListTypeName: 'taskList',
          }),
          TaskListShortcuts,
        ],
        content: '<p></p>',
      });

      editor.commands.insertContent('[ ] ');

      const json = editor.getJSON();
      const taskList = json.content?.find((node: any) => node.type === 'taskList');

      if (taskList) {
        const taskItem = taskList.content?.[0];
        expect(taskItem?.type).toBe('taskItem');
        expect(taskItem?.attrs?.checked).toBe(false);
      }
    });

    it('should still handle [x] for checked tasks', () => {
      editor = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            taskListTypeName: 'taskList',
          }),
          TaskListShortcuts,
        ],
        content: '<p></p>',
      });

      editor.commands.insertContent('[x] ');

      const json = editor.getJSON();
      const taskList = json.content?.find((node: any) => node.type === 'taskList');

      if (taskList) {
        const taskItem = taskList.content?.[0];
        expect(taskItem?.type).toBe('taskItem');
        expect(taskItem?.attrs?.checked).toBe(true);
      }
    });
  });

  describe('Test 4: Visual Rendering', () => {
    it('should render in-progress state distinctly', async () => {
      // Test that the HTML output has the correct data-status attribute
      const markdown = '- [/] In-progress task';
      const html = await processMarkdownToHTML(markdown);

      editor = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            taskListTypeName: 'taskList',
          }),
        ],
        content: html,
      });

      // Get the HTML output
      const outputHTML = editor.getHTML();

      // Verify the HTML contains the data-status attribute
      expect(outputHTML).toContain('data-status="in-progress"');
      expect(outputHTML).toContain('data-type="taskItem"');
      expect(outputHTML).toContain('data-checked="false"');
    });
  });

  describe('Test 5: Content Rendering', () => {
    it('should render task text content', async () => {
      const markdown = '- [ ] Todo task\n- [/] In-progress task\n- [x] Done task';
      const html = await processMarkdownToHTML(markdown);

      editor = new Editor({
        element: document.body.querySelector('div')!,
        extensions: [
          StarterKit,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            taskListTypeName: 'taskList',
          }),
        ],
        content: html,
      });

      // Wait for editor to render
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that all task items are rendered
      const taskItems = document.querySelectorAll('[data-type="taskItem"]');
      expect(taskItems.length).toBe(3);

      // Check that text content is present in the editor
      const editorText = editor.getText();
      console.log('Editor text:', editorText);
      expect(editorText).toContain('Todo task');
      expect(editorText).toContain('In-progress task');
      expect(editorText).toContain('Done task');

      // Verify each task item element contains the expected text
      // The component uses NodeViewContent with Tailwind classes, not specific CSS classes
      expect(taskItems[0].textContent).toContain('Todo task');
      expect(taskItems[1].textContent).toContain('In-progress task');
      expect(taskItems[2].textContent).toContain('Done task');
    });
  });
});
