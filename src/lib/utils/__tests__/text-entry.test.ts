import { afterEach, describe, expect, it } from 'vitest';
import { isMultilineTextEntryTarget, isTextEntryTarget } from '../text-entry';

function mount<T extends Element>(element: T): T {
  document.body.append(element);
  return element;
}

function element(tag: string, attributes: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return mount(node);
}

/** Chromium exposes `editContext` on every HTMLElement; it is `null` until attached. */
function withEditContext(node: HTMLElement, value: object | null): HTMLElement {
  Object.defineProperty(node, 'editContext', { value, configurable: true });
  return node;
}

/** jsdom does not compute `isContentEditable`; mirror what Chromium reports. */
function withContentEditable(node: HTMLElement): HTMLElement {
  Object.defineProperty(node, 'isContentEditable', { value: true, configurable: true });
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('isTextEntryTarget', () => {
  it.each(['input', 'textarea', 'select'])('recognizes native %s controls', (tag) => {
    expect(isTextEntryTarget(element(tag))).toBe(true);
  });

  it('recognizes contenteditable regions and their descendants', () => {
    const editable = element('div', { contenteditable: 'true' });
    const child = document.createElement('span');
    editable.append(child);
    expect(isTextEntryTarget(editable)).toBe(true);
    expect(isTextEntryTarget(child)).toBe(true);
    expect(isTextEntryTarget(element('div', { contenteditable: '' }))).toBe(true);
    expect(isTextEntryTarget(withContentEditable(element('div')))).toBe(true);
    const viaProperty = element('div');
    viaProperty.contentEditable = 'true';
    expect(isTextEntryTarget(viaProperty)).toBe(true);
  });

  it('does not treat contenteditable="false" as text entry', () => {
    expect(isTextEntryTarget(element('div', { contenteditable: 'false' }))).toBe(false);
  });

  it('recognizes a Monaco-style EditContext owner', () => {
    const monaco = withEditContext(element('div'), {});
    expect(isTextEntryTarget(monaco)).toBe(true);
  });

  it('does not count the Chromium default editContext === null as text entry', () => {
    const plain = withEditContext(element('div'), null);
    expect('editContext' in plain).toBe(true);
    expect(isTextEntryTarget(plain)).toBe(false);
  });

  it('recognizes ARIA textboxes, their descendants, and read-only textboxes', () => {
    const textbox = element('div', { role: 'textbox', 'aria-multiline': 'true' });
    const child = document.createElement('span');
    textbox.append(child);
    expect(isTextEntryTarget(textbox)).toBe(true);
    expect(isTextEntryTarget(child)).toBe(true);
    expect(isTextEntryTarget(element('div', { role: 'textbox', 'aria-readonly': 'true' }))).toBe(
      true,
    );
  });

  it('ignores non-text targets', () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(undefined)).toBe(false);
    expect(isTextEntryTarget(window)).toBe(false);
    expect(isTextEntryTarget(document)).toBe(false);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(element('button'))).toBe(false);
    expect(isTextEntryTarget(element('div', { role: 'button' }))).toBe(false);
  });
});

describe('isMultilineTextEntryTarget', () => {
  it('recognizes textareas, contenteditable, and EditContext owners', () => {
    expect(isMultilineTextEntryTarget(element('textarea'))).toBe(true);
    expect(isMultilineTextEntryTarget(withContentEditable(element('div')))).toBe(true);
    expect(isMultilineTextEntryTarget(withEditContext(element('div'), {}))).toBe(true);
  });

  it('recognizes editable multi-line ARIA textboxes only', () => {
    expect(
      isMultilineTextEntryTarget(element('div', { role: 'textbox', 'aria-multiline': 'true' })),
    ).toBe(true);
    expect(
      isMultilineTextEntryTarget(
        element('div', { role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': 'true' }),
      ),
    ).toBe(false);
    expect(isMultilineTextEntryTarget(element('div', { role: 'textbox' }))).toBe(false);
  });

  it('treats single-line and non-text targets as not multi-line', () => {
    expect(isMultilineTextEntryTarget(element('input'))).toBe(false);
    expect(isMultilineTextEntryTarget(withEditContext(element('div'), null))).toBe(false);
    expect(isMultilineTextEntryTarget(element('button'))).toBe(false);
    expect(isMultilineTextEntryTarget(null)).toBe(false);
  });
});
