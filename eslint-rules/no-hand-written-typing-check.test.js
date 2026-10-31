// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import typescriptParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-hand-written-typing-check.js';

const filename = path.resolve('src/lib/components/probe/probe-shortcuts.ts');
const svelteFile = path.resolve('src/lib/components/probe/ProbeShortcuts.svelte');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: typescriptParser },
});

const svelte = (script, template = '<div></div>') => ({
  filename: svelteFile,
  code: `<script lang="ts">\n${script}\n</script>\n${template}\n`,
  languageOptions: { parser: svelteParser, parserOptions: { parser: typescriptParser } },
});

const error = (line) => ({ messageId: 'handWrittenTypingCheck', line });

describe('no-hand-written-typing-check guidance', () => {
  it('explains the code editor gap, names both helpers, and cites the incidents', () => {
    const message = rule.meta.messages.handWrittenTypingCheck;
    expect(message).toContain('EditContext');
    expect(message).toContain('isTextEntryTarget(event.target)');
    expect(message).toContain('isMultilineTextEntryTarget');
    expect(message).toContain("'$lib/utils/text-entry'");
    expect(message).toContain('intent-hq/intent#8068');
    expect(message).toContain('intent-hq/intent#8115');
    expect(message).toContain('eslint-disable-next-line intent/no-hand-written-typing-check');
  });
});

tester.run('no-hand-written-typing-check', rule, {
  valid: [
    {
      name: 'the shared helper in a keydown listener',
      filename,
      code: `
window.addEventListener('keydown', (event) => {
  if (isTextEntryTarget(event.target)) return;
  runShortcut(event);
});`,
    },
    {
      name: 'a pointerdown guard against interactive controls',
      filename,
      code: `
function handlePanelPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
  if (target.tagName === 'INPUT' || target.isContentEditable) return;
  focusPanel();
}`,
    },
    {
      name: 'click and dragstart handlers',
      filename,
      code: `
element.addEventListener('click', (event) => {
  if ((event.target as Element).closest('button, input')) return;
});
element.addEventListener('dragstart', function (event) {
  if ((event.target as HTMLElement).isContentEditable) event.preventDefault();
});`,
    },
    {
      name: 'a text-search tree walk',
      filename,
      code: `
function collectText(root: Element) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const tag = (node as Text).parentElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return NodeFilter.FILTER_REJECT;
      if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(node.parentElement.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
}`,
    },
    {
      name: 'assigning contentEditable in a keydown handler',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
}`,
    },
    {
      name: 'a non-typing selector and an unrelated tag in a keydown handler',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('button, a, [role="option"], .input-row, #textarea-count')) return;
  if (target.tagName === 'BUTTON') return;
  if (event.key === 'input') return;
}`,
    },
    {
      name: 'focus-trap and nested-control selectors in keyboard code',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const focusable = dialog.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled])',
  );
  const tabStops = document.querySelectorAll('input, select, textarea, [tabindex]');
  const links = document.querySelectorAll('a[href],input');
  if ((event.target as Element).closest('button,a,input,select,textarea,[role="button"]')) return;
}`,
    },
    {
      name: 'a key event name passed to a non-listener call',
      filename,
      code: `
emit('keydown', check);
decoder.on('keydown', check);
function check(target) {
  return target.isContentEditable;
}`,
    },
    {
      name: 'a helper the keydown handler does not call',
      filename,
      code: `
function isEditable(target: HTMLElement) {
  return target.isContentEditable;
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}
element.addEventListener('pointerdown', (event) => isEditable(event.target as HTMLElement));`,
    },
    {
      name: 'Svelte pointer handlers',
      ...svelte(
        `
  function handleMousedown(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button, input, [contenteditable]')) return;
  }`,
        '<div onmousedown={handleMousedown}></div>',
      ),
    },
  ],
  invalid: [
    {
      name: 'the brief fixture: tagName === TEXTAREA in a keydown listener',
      filename,
      code: `
window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.tagName === 'TEXTAREA') return;
});`,
      errors: [error(4)],
    },
    {
      name: 'every signal in a KeyboardEvent-typed function',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if ('INPUT' == target.tagName) return;
  if (target.nodeName.toLowerCase() !== 'textarea') return;
  if (target.isContentEditable || target.contentEditable === 'true') return;
  if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
  if (new Set(['input']).has(target.localName)) return;
  if (target.closest('input, textarea, select')) return;
  if (target.matches('div[contenteditable="true"]')) return;
  if (document.querySelector(\`textarea\`)) return;
}`,
      errors: [
        error(4),
        error(5),
        error(6),
        error(6),
        error(7),
        error(8),
        error(9),
        error(10),
        error(11),
      ],
    },
    {
      name: 'tag aliases, typing-tag collections and selector constants',
      filename,
      code: `
const EDITABLE = 'input, textarea, [contenteditable]';
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA']);
document.addEventListener('keyup', (event) => {
  const target = event.target as HTMLElement;
  const tag = target.tagName;
  if (tag === 'INPUT') return;
  if (TYPING_TAGS.has(tag)) return;
  if (target.closest(EDITABLE)) return;
  switch (target.tagName) {
    case 'TEXTAREA':
      return;
  }
});`,
      errors: [error(7), error(8), error(9), error(11)],
    },
    {
      name: 'a same-file helper called from a keydown handler, transitively',
      filename,
      code: `
function isEditableElement(element: Element) {
  return element.closest('input, textarea, select, [contenteditable="true"]') !== null;
}
function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || isEditableElement(target));
}
export function shouldHandleShortcut(event: KeyboardEvent) {
  return !isEditableTarget(event.target);
}`,
      errors: [error(3), error(6)],
    },
    {
      name: 'a helper passed along by name and a named listener',
      filename,
      code: `
const isTyping = (element: Element) => element.matches('input');
function onKey(event) {
  return [event.target].some(isTyping);
}
window.addEventListener('keypress', onKey);`,
      errors: [error(2)],
    },
    {
      name: 'svelte/events on(), onkeydown assignment, object property and KeyboardEventHandler',
      filename,
      code: `
on(window, 'keydown', (event) => (event.target as HTMLElement).isContentEditable);
element.onkeydown = function (event) { return event.target.tagName === 'INPUT'; };
const props = { onkeydown: (event) => event.target.closest('textarea') };
const handle: KeyboardEventHandler<HTMLDivElement> = (event) => event.currentTarget.isContentEditable;`,
      errors: [error(2), error(3), error(4), error(5)],
    },
    {
      name: 'a selector whose only button mention is an attribute value or class',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  if ((event.target as Element).closest('input, [role="button"], .a, [data-button]')) return;
}`,
      errors: [error(3)],
    },
    {
      name: 'constants declared after the keyboard function that uses them',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (target.closest(EDITABLE)) return;
  if (TYPING_TAGS.has(target.tagName)) return;
}
const EDITABLE = 'input, textarea';
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA']);`,
      errors: [error(4), error(5)],
    },
    {
      name: 'class methods, class fields and this-bound listeners',
      filename,
      code: `
class ShortcutManager {
  isEditable(target) {
    return target.isContentEditable;
  }
  handle = (event: KeyboardEvent) => {
    if (this.isEditable(event.target)) return;
  };
  onKey(event) {
    if (event.target.tagName === 'INPUT') return;
  }
  start() {
    window.addEventListener('keydown', this.onKey);
  }
}`,
      errors: [error(4), error(10)],
    },
    {
      name: 'a contenteditable selector that also names a button',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  if ((event.target as Element).closest('input, textarea, select, button, [contenteditable]')) return;
}`,
      errors: [error(3)],
    },
    {
      name: 'capture attributes and key-handler props with inferred parameter types',
      ...svelte(
        `
  function onCapture(event) {
    if (event.target.tagName === 'INPUT') return;
  }
  const editorProps = {
    handleKeyDown(view, event) {
      return event.target.isContentEditable;
    },
  };`,
        `<div onkeydowncapture={onCapture}></div>
<Dialog onEscapeKeydown={(event) => event.target.closest('textarea')} />`,
      ),
      errors: [error(4), error(8), error(13)],
    },
    {
      name: 'destructured tag names and contenteditable flags',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const { tagName } = event.target as HTMLElement;
  if (tagName === 'INPUT') return;
  const { isContentEditable } = event.target as HTMLElement;
}`,
      errors: [error(4), error(5)],
    },
    {
      name: 'attribute, regex and indexOf forms',
      filename,
      code: `
function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (target.hasAttribute('contenteditable')) return;
  if (target.getAttribute('contenteditable') === 'true') return;
  if (/^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
  if (['INPUT', 'TEXTAREA'].indexOf(target.tagName) !== -1) return;
}`,
      errors: [error(4), error(5), error(6), error(7)],
    },
    {
      name: 'a union-typed keyboard parameter',
      filename,
      code: `
function handle(event: KeyboardEvent | MouseEvent) {
  return (event.target as HTMLElement).tagName === 'INPUT';
}`,
      errors: [error(3)],
    },
    {
      name: 'Svelte onkeydown attribute with a named handler and its helper',
      ...svelte(
        `
  function isMultilineInput(target: HTMLElement) {
    return target instanceof HTMLTextAreaElement || target.isContentEditable;
  }
  function handleKeydown(event) {
    if (event.key === 'Enter' && isMultilineInput(event.target)) return;
  }`,
        '<form onkeydown={handleKeydown}></form>',
      ),
      errors: [error(4)],
    },
    {
      name: 'Svelte inline window handler, shorthand attribute and on: directive',
      ...svelte(
        `
  function onkeydown(event) {
    if (event.target.tagName === 'TEXTAREA') return;
  }
  function legacy(event) {
    if (event.target.closest('[contenteditable]')) return;
  }`,
        `<svelte:window onkeyup={(event) => event.target.isContentEditable} />
<div {onkeydown}></div>
<div on:keydown={legacy}></div>`,
      ),
      errors: [error(4), error(7), error(10)],
    },
  ],
});
