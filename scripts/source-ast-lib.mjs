import ts from 'typescript';

// Shared parsing for source-scanning architecture checks. Read source through the
// TypeScript parser, never a hand-written brace or quote scanner: a regex literal and a
// constant `kind` each fooled one in cloudlands-fe#4840 across three review rounds.
// A check should report what it cannot read (`parseErrors`, a `stringValue` of null)
// instead of skipping it.
export { ts };

const SVELTE_BLOCK_PATTERN =
  /<!--[\s\S]*?-->|(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/script\s*>|<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\s*>/g;
const JS_EXTENSION_PATTERN = /\.[cm]?jsx?$/;

const blank = (text) => text.replace(/[^\n]/g, ' ');

function splitSvelte(text) {
  let script = '';
  let markup = '';
  let kept = 0;
  for (const match of text.matchAll(SVELTE_BLOCK_PATTERN)) {
    const [whole, openTag, content] = match;
    markup += text.slice(kept, match.index) + blank(whole);
    script += blank(text.slice(kept, match.index));
    if (openTag === undefined) script += blank(whole);
    else {
      const contentEnd = openTag.length + content.length;
      script += blank(openTag) + content + blank(whole.slice(contentEnd));
    }
    kept = match.index + whole.length;
  }
  return { script: script + blank(text.slice(kept)), markup: markup + text.slice(kept) };
}

// The component's `<script>` contents in place, everything else blanked to spaces
// (newlines kept), so offsets and lines match the component.
export const svelteScriptText = (text) => splitSvelte(text).script;

// The component's markup in place, with script and style blocks and HTML comments
// blanked. Markup is not parsed; a check can only search it as text.
export const svelteMarkupText = (text) => splitSvelte(text).markup;

// A source file for `.ts` / `.js` text, or for the script blocks of a `.svelte`
// component (see `svelteScriptText`). Node positions are offsets into `text`.
export function parseSource(text, fileName = 'source.ts') {
  if (fileName.endsWith('.svelte')) {
    return ts.createSourceFile(
      fileName,
      svelteScriptText(text),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  }
  const kind = JS_EXTENSION_PATTERN.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

// Syntax errors the parser recovered from: `{ line, message }`. A recovered tree can
// drop or reshape code, so a check should fail on these rather than trust its reading.
export const parseErrors = (sourceFile) =>
  (sourceFile.parseDiagnostics ?? []).map((diagnostic) => ({
    line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  }));

// 1-based line of the node's first token.
export const lineOf = (node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

// Visits every descendant in source order; return `false` to skip a node's children.
export function walk(node, visit) {
  ts.forEachChild(node, (child) => {
    if (visit(child) !== false) walk(child, visit);
  });
}

// The static name of an object literal member, or null for a computed key or a spread.
export function propertyName(property) {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

// The object literal's own member named `name`; the last one wins, as at runtime.
export const ownProperty = (object, name) =>
  object.properties.findLast((property) => propertyName(property) === name);

// The value expression of the own property `name`: the initializer, the identifier of a
// shorthand property, or undefined for a missing property or a method/accessor.
export function propertyValue(object, name) {
  const property = ownProperty(object, name);
  if (!property) return undefined;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return undefined;
}

// Every object literal under `root` with an own property `name`, in source order.
export function findObjectLiterals(root, name) {
  const objects = [];
  walk(root, (node) => {
    if (ts.isObjectLiteralExpression(node) && ownProperty(node, name)) objects.push(node);
  });
  return objects;
}

// The expression without parentheses, `as`, `satisfies`, `!` or `<T>` wrappers.
export function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

// The value of a string literal or substitution-free template, or null for anything a
// check cannot read statically (identifiers, calls, `${…}` templates, concatenation).
export function stringValue(node) {
  const expression = unwrapExpression(node);
  return expression && ts.isStringLiteralLike(expression) ? expression.text : null;
}

// Local name → module specifier for every named import (`{ a, b as c }`), type-only
// included. Default and namespace imports are not named imports.
export function namedImports(sourceFile) {
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, statement.moduleSpecifier.text);
    }
  }
  return imports;
}
