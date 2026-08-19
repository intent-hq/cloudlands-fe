import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const protectedAgentCallers = [
  'src/features/file-tracking/components/diff/PatchBlockContent.svelte',
  'src/lib/components/code-review/CodeReviewPanel.svelte',
  'src/lib/components/notes/primitives/CliBlock.svelte',
  'src/lib/components/notes/primitives/DiagramBlock.svelte',
  'src/lib/components/notes/primitives/ReferenceBlock.svelte',
  'src/lib/components/terminal/TerminalSidebar.svelte',
] as const;

const sourceExtensions = new Set(['.js', '.svelte', '.ts', '.tsx']);

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionSourceFiles(path);
    }
    if (!sourceExtensions.has(extname(entry.name)) || /\.(?:spec|test)\./.test(entry.name))
      return [];
    return [path];
  });
}

type SvelteAstNode = {
  type?: string;
  name?: string;
  callee?: SvelteAstNode;
  arguments?: SvelteAstNode[];
  properties?: SvelteAstNode[];
  argument?: SvelteAstNode;
  [key: string]: unknown;
};

function svelteCallsNamed(source: string, name: string): SvelteAstNode[] {
  const calls: SvelteAstNode[] = [];
  const visited = new WeakSet<object>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const node = value as SvelteAstNode;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
      if (node.callee.name === name) calls.push(node);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }
  visit(parse(source, { modern: true }));
  return calls;
}

function callsNamed(sourceFile: ts.SourceFile, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return calls;
}

function callCount(path: string, name: string) {
  const source = readFileSync(path, 'utf8');
  if (path.endsWith('.svelte')) return svelteCallsNamed(source, name).length;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return callsNamed(sourceFile, name).length;
}

function isNavigationContextSpread(property: SvelteAstNode | undefined) {
  return (
    property?.type === 'SpreadElement' &&
    property.argument?.type === 'CallExpression' &&
    property.argument.callee?.type === 'Identifier' &&
    property.argument.callee.name === 'getNavigationContext'
  );
}

function discoveredAgentCallers() {
  const root = resolve(process.cwd(), 'src');
  return productionSourceFiles(root)
    .filter((path) => callCount(path, 'getNavigationContext') > 0)
    .map((path) => relative(process.cwd(), path).split(sep).join('/'))
    .sort();
}

describe('agent navigation context callers', () => {
  it('protects the exact production caller set', () => {
    expect(discoveredAgentCallers()).toEqual([...protectedAgentCallers].sort());
  });

  it.each(protectedAgentCallers)('%s cannot override the shared context', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    const contextCalls = svelteCallsNamed(source, 'getNavigationContext');
    const detailObjects = svelteCallsNamed(source, 'openAgentTabRequested')
      .map((call) => call.arguments?.[1])
      .filter((details): details is SvelteAstNode => details?.type === 'ObjectExpression')
      .filter((details) => details.properties?.some(isNavigationContextSpread));

    expect(detailObjects).toHaveLength(contextCalls.length);
    expect(contextCalls.length).toBeGreaterThan(0);
    for (const details of detailObjects) {
      expect(isNavigationContextSpread(details.properties?.at(-1))).toBe(true);
    }
  });
});
