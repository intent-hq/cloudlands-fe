/**
 * @vitest-environment jsdom
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  Editor,
  type JSONContent,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from '$lib/components/tiptap/CustomTaskItem';
import { TaskListShortcuts } from '../task-list-shortcuts';

const mockReadable = (value: unknown) => ({
  subscribe: (fn: (value: unknown) => void) => {
    fn(value);
    return () => {};
  },
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => mockReadable(null),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => mockReadable(undefined), { select: () => undefined }),
  selectSelectedNoteId: Object.assign(() => mockReadable(null), { select: () => null }),
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
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: vi.fn(),
}));

describe('TaskListShortcuts', () => {
  let editor: Editor | null = null;
  let editorElement: HTMLElement;

  beforeEach(() => {
    editorElement = document.createElement('div');
    document.body.appendChild(editorElement);
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit,
        TaskList,
        CustomTaskItem.configure({ nested: true, taskListTypeName: 'taskList' }),
        TaskListShortcuts,
      ],
      content: '<p></p>',
    });
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    editorElement.remove();
  });

  const flushInputRules = () => new Promise((resolve) => setTimeout(resolve, 0));

  const getEditor = () => {
    if (!editor) {
      throw new Error('Editor was not initialized');
    }

    return editor;
  };

  const typeText = async (text: string) => {
    for (const character of text) {
      getEditor().commands.insertContent(character, { applyInputRules: true });
      await flushInputRules();
    }
  };

  const getFirstTaskItem = () => {
    const taskList = getEditor().getJSON().content?.find((node) => node.type === 'taskList');
    expect(taskList).toBeDefined();
    return taskList?.content?.[0];
  };

  const findEmptyParagraphSelection = () => {
    let selection = -1;

    getEditor().state.doc.descendants((node, pos) => {
      if (selection === -1 && node.type.name === 'paragraph' && node.content.size === 0) {
        selection = pos + 1;
        return false;
      }

      return true;
    });

    expect(selection).toBeGreaterThan(-1);
    return selection;
  };

  const getTaskItemText = (taskItem: JSONContent | undefined) =>
    taskItem?.content?.[0]?.content?.[0]?.text;

  it.each(['- [ ] ', '* [ ] '])('creates an unchecked task item after typing %s', async (input) => {
    await typeText(input);

    const taskItem = getFirstTaskItem();
    expect(taskItem?.type).toBe('taskItem');
    expect(taskItem?.attrs).toMatchObject({ checked: false, status: 'todo' });
    expect(getEditor().getText().trim()).toBe('');
  });

  it.each([
    ['[ ] ', { checked: false, status: 'todo' }],
    ['[] ', { checked: false, status: 'todo' }],
    ['[x] ', { checked: true, status: 'done' }],
    ['[/] ', { checked: false, status: 'in-progress' }],
  ])('keeps compact syntax %s supported', async (input, attrs) => {
    await typeText(input);

    const taskItem = getFirstTaskItem();
    expect(taskItem?.type).toBe('taskItem');
    expect(taskItem?.attrs).toMatchObject(attrs);
  });

  it('keeps regular bullet input as a bullet list', async () => {
    await typeText('- item');

    const firstNode = getEditor().getJSON().content?.[0] as JSONContent | undefined;
    expect(firstNode?.type).toBe('bulletList');
    expect(firstNode?.content?.[0]?.type).toBe('listItem');
    expect(getEditor().getText().trim()).toBe('item');
  });

  it('keeps typing inside the converted task item when following content exists', async () => {
    getEditor().commands.setContent('<p></p><p>after</p>');
    getEditor().commands.setTextSelection(findEmptyParagraphSelection());

    await typeText('- [ ] ');
    await typeText('hello');

    const content = getEditor().getJSON().content;
    const taskItem = getFirstTaskItem();

    expect(content?.[0]?.type).toBe('taskList');
    expect(getTaskItemText(taskItem)).toBe('hello');
    expect(content?.[1]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'after' }],
    });
  });

  it('keeps typing inside the converted task item when splitting sibling bullet items', async () => {
    getEditor().commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph' }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
      ],
    });
    getEditor().commands.setTextSelection(findEmptyParagraphSelection());

    await typeText('- [ ] ');
    await typeText('middle');

    const content = getEditor().getJSON().content;
    const taskItem = getFirstTaskItem();

    expect(content?.map((node) => node.type)).toEqual(['bulletList', 'taskList', 'bulletList', 'paragraph']);
    expect(content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('before');
    expect(getTaskItemText(taskItem)).toBe('middle');
    expect(content?.[2]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('after');
    expect(content?.[3]?.content?.[0]?.text).toBe('tail');
  });
});