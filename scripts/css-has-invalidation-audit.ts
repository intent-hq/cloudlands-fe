// Selector predicates shared by the source ratchet
// (`css-has-invalidation-audit.test.ts`) and the compiled-stylesheet audit
// (`css-has-invalidation-built-audit.test.ts`). Blink shares one `:has()`
// invalidation set per anchor: a `:has()` anchored at `html`/`body`/`:root`
// makes every mutation in the page a candidate invalidation, and a universal
// subject (`:has(…) *`, what Tailwind `group-has-*` / `peer-has-*` compile to)
// restyles the whole subtree when it fires.
const compoundSuffix = String.raw`(?:#[\w-]+|\.[\w-]+|\[[^\]]*\]|:(?!has\b)[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*`;
const documentSimple = /^(?:html|body|:root)$/i;
const documentWrapper = /^:(?:is|where|global)\(/;
const universalWrapper = /^:(?:is|where)\(/;
const pseudoClass = /^:(?!has\b)[\w-]+/;
const wrappedArguments = /:(?:is|where|not|global)\(/g;
const documentAnchoredHasInMarkup = new RegExp(
  String.raw`(?:^|[\s>+~,({\['"\x60])(?::global\()?(?:html|body|:root)${compoundSuffix}:has\(`,
  'g',
);
const universalSubjectVariant = /(?:^|[\s'"`])((?:group|peer)-has(?:-[^\s'"`]*)?:[^\s'"`]+)/g;

export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The compound selector that ends right before `index` (stops at combinators or an enclosing `(`). */
export function compoundBefore(selector: string, index: number): string {
  let depth = 0;
  let i = index - 1;
  for (; i >= 0; i--) {
    const ch = selector[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && /[\s>+~,]/.test(ch)) break;
  }
  return selector.slice(i + 1, index);
}

export function closingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** The simple selectors of a compound (`.dark:root` → `.dark`, `:root`); backslash escapes never split. */
export function simpleSelectors(compound: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < compound.length; i++) {
    const ch = compound[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (depth === 0 && i > start && /[.#:[]/.test(ch) && compound[i - 1] !== ':') {
      parts.push(compound.slice(start, i));
      start = i;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
  }
  parts.push(compound.slice(start));
  return parts.filter(Boolean);
}

/** The top-level arguments of one functional pseudo-class such as `:is(body, .shell)`. */
function functionArguments(simple: string): string[] {
  const open = simple.indexOf('(');
  const close = closingParen(simple, open);
  return close === -1 ? [] : splitTopLevel(simple.slice(open + 1, close), ',');
}

/** The compound selector a (possibly complex) selector ends with. */
function subjectCompound(selector: string): string {
  const trimmed = selector.trimEnd();
  return compoundBefore(trimmed, trimmed.length);
}

/**
 * Whether a compound is constrained to the document root: it contains `html`,
 * `body`, or `:root` anywhere, directly or inside an `:is()` / `:where()` /
 * `:global()` branch. `:not(body)` is a negative constraint, not an anchor.
 */
export function isDocumentCompound(compound: string): boolean {
  return simpleSelectors(compound).some(
    (simple) =>
      documentSimple.test(simple) ||
      (documentWrapper.test(simple) &&
        functionArguments(simple).some((arg) => isDocumentCompound(subjectCompound(arg)))),
  );
}

/** `:has()` whose anchor compound is `html`, `body`, or `:root` (optionally narrowed by id/class/attribute/pseudo). */
export function anchorsHasAtDocument(selector: string): boolean {
  return [...selector.matchAll(/:has\(/g)].some((match) =>
    isDocumentCompound(compoundBefore(selector, match.index)),
  );
}

/**
 * Whether a compound matches every element: `*`, or an `:is()` / `:where()`
 * with a universal branch (`:is(*, .baz)`), narrowed at most by pseudo-classes
 * (`:where(*):hover`). A class, id, or attribute in the compound keys it.
 */
export function isUniversalCompound(compound: string): boolean {
  const simples = simpleSelectors(compound);
  const isUniversal = (simple: string): boolean =>
    simple === '*' ||
    (universalWrapper.test(simple) &&
      functionArguments(simple).some((arg) => isUniversalCompound(subjectCompound(arg))));
  return (
    simples.some(isUniversal) &&
    simples.every((simple) => isUniversal(simple) || pseudoClass.test(simple))
  );
}

/** A `:has()` somewhere before a universal subject (`*`, `:is(*)`, `:where(*):hover`, …). */
export function hasUniversalSubject(selector: string): boolean {
  const subject = subjectCompound(selector);
  return (
    isUniversalCompound(subject) && selector.trimEnd().slice(0, -subject.length).includes(':has(')
  );
}

/**
 * The top-level arguments of every `:is()` / `:where()` / `:not()` / `:global()`
 * in `selector`, each a selector of its own. Tailwind v4 compiles variants such
 * as `group-has-[…]:pr-8` to `.utility:is(:where(.group):has(…) *)`, so the
 * offending shape lives inside the argument rather than at the subject.
 */
export function wrappedSelectorArguments(selector: string): string[] {
  return [...selector.matchAll(wrappedArguments)].flatMap((match) => {
    const open = match.index + match[0].length - 1;
    const close = closingParen(selector, open);
    return close === -1 ? [] : splitTopLevel(selector.slice(open + 1, close), ',');
  });
}

/** Whether `selector`, or any selector nested in its `:is()`/`:where()`/`:not()` arguments, has a banned `:has()` shape. */
export function violatesHasInvalidation(selector: string): boolean {
  return (
    anchorsHasAtDocument(selector) ||
    hasUniversalSubject(selector) ||
    wrappedSelectorArguments(selector).some(violatesHasInvalidation)
  );
}

function resolveNested(selectors: string[], parents: string[]): string[] {
  if (parents.length === 0) return selectors;
  return selectors.flatMap((selector) =>
    parents.map((parent) =>
      selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`,
    ),
  );
}

/** Every fully resolved style-rule selector in a (possibly nested) authored stylesheet. */
export function stylesheetSelectors(css: string): string[] {
  const selectors: string[] = [];
  const scopes: string[][] = [];
  let buffer = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === quote && css[i - 1] !== '\\') quote = null;
      buffer += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const parents = scopes.at(-1) ?? [];
      if (prelude.startsWith('@')) {
        scopes.push(parents);
      } else {
        const own = resolveNested(splitTopLevel(prelude, ','), parents);
        selectors.push(...own);
        scopes.push(own);
      }
      continue;
    }
    if (depth === 0 && (ch === '}' || ch === ';')) {
      buffer = '';
      if (ch === '}') scopes.pop();
      continue;
    }
    buffer += ch;
  }
  return selectors;
}

export function auditStylesheet(css: string): string[] {
  return stylesheetSelectors(stripComments(css)).filter(violatesHasInvalidation);
}

export function auditMarkup(markup: string): string[] {
  const text = stripComments(markup);
  return [
    ...[...text.matchAll(documentAnchoredHasInMarkup)].map((m) => m[0].trim()),
    ...[...text.matchAll(universalSubjectVariant)].map((m) => m[1]),
  ];
}
