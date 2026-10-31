// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-scroll-into-view-prototype-stub.js';

const filename = path.resolve('src/lib/components/probe/probe.test.ts');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: typescriptParser },
});

const invalid = (name, code) => ({
  name,
  filename,
  code,
  errors: [{ messageId: 'prototypeStub' }],
});

describe('no-scroll-into-view-prototype-stub guidance', () => {
  it('names the shared default, the incident and the spy alternative', () => {
    const message = rule.meta.messages.prototypeStub;
    expect(message).toContain('src/test-setup.ts');
    expect(message).toContain('cloudlands-fe#3921');
    expect(message).toContain("vi.spyOn(Element.prototype, 'scrollIntoView')");
    expect(message).toContain('vi.restoreAllMocks()');
  });
});

tester.run('no-scroll-into-view-prototype-stub', rule, {
  valid: [
    {
      name: 'a spy on the shared default',
      filename,
      code: "const spy = vi.spyOn(Element.prototype, 'scrollIntoView');",
    },
    {
      name: 'a stub on a single element',
      filename,
      code: 'element.scrollIntoView = vi.fn();',
    },
    {
      name: 'reading the prototype method',
      filename,
      code: 'expect(Element.prototype.scrollIntoView).toBeTypeOf("function");',
    },
    {
      name: 'stubbing a different prototype method',
      filename,
      code: 'Element.prototype.scrollTo = vi.fn();',
    },
    {
      name: 'defining a different prototype property',
      filename,
      code: "Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn() });",
    },
    {
      name: 'a non-element prototype',
      filename,
      code: 'Widget.prototype.scrollIntoView = vi.fn();',
    },
    {
      name: 'defining scrollIntoView on an instance',
      filename,
      code: "Object.defineProperty(element, 'scrollIntoView', { value: vi.fn() });",
    },
  ],
  invalid: [
    invalid('a vi.fn assignment on Element', 'Element.prototype.scrollIntoView = vi.fn();'),
    invalid(
      'a no-op assignment on HTMLElement',
      'HTMLElement.prototype.scrollIntoView = (() => {}) as never;',
    ),
    invalid(
      'a nullish fallback assignment',
      'Element.prototype.scrollIntoView ??= () => undefined;',
    ),
    invalid(
      'restoring a saved original',
      'Element.prototype.scrollIntoView = originalScrollIntoView;',
    ),
    invalid('a computed key', "SVGElement.prototype['scrollIntoView'] = vi.fn();"),
    invalid('reached through window', 'window.HTMLElement.prototype.scrollIntoView = vi.fn();'),
    invalid('through a TypeScript cast', '(Element.prototype as any).scrollIntoView = vi.fn();'),
    invalid(
      'Object.defineProperty',
      "Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });",
    ),
    invalid(
      'Object.defineProperty restoring a descriptor',
      "Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);",
    ),
    invalid(
      'Reflect.deleteProperty',
      "Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');",
    ),
    invalid(
      'a delete through a cast',
      'delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;',
    ),
  ],
});
