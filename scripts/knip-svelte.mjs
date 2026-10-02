import { parse } from 'svelte/compiler';

// Knip's import regexp also matches import.meta and object keys named `import`,
// producing invalid code that hides the real imports following a glob call (#6055).
// Use Svelte's parser to retain imports from both scripts and template expressions.
// Keep TypeScript source intact: compiling to JS would erase type-only imports.
export function svelteImports(source, filename) {
  const ast = parse(source, { filename, modern: true });
  // Mirror Svelte's single leading BOM removal so slices use the parsed text.
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const imports = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') {
      imports.push(source.slice(node.start, node.end));
      return;
    }
    if (node.type === 'TSImportType') {
      // Preserve Knip's existing opaque module reference for inline import types.
      // Narrowing export reachability is separate from repairing import extraction.
      imports.push(`import(${source.slice(node.argument.start, node.argument.end)})`);
      visit(node.typeArguments);
      return;
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'MetaProperty' &&
      node.callee.object.meta.name === 'import' &&
      node.callee.object.property.name === 'meta' &&
      node.callee.property.name === 'glob'
    ) {
      imports.push(source.slice(node.start, node.end));
      return;
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }

  visit(ast.module);
  visit(ast.instance);
  visit(ast.fragment);
  return imports.join(';\n');
}
