import path from 'node:path';
import { relativeFilename, svelteElementName } from './common.js';

const menuModule = 'src/lib/components/ui/menu';
const recipeModule = `${menuModule}/menu-recipes`;
const menuRows = new Set([
  'Item',
  'MenuItem',
  'CommandItem',
  'ActionRow',
  'CheckboxItem',
  'RadioItem',
  'SubTrigger',
]);
const menuSurfaces = new Set(['Content', 'SubContent', 'StackedContent']);

export function attribute(node, name) {
  return node.startTag.attributes.find(
    (item) => item.type === 'SvelteAttribute' && item.key?.name === name,
  );
}

function modulePath(source, filename) {
  const resolved = source.startsWith('$lib/')
    ? `src/lib/${source.slice(5)}`
    : source.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), source))
      : source;
  return resolved.replace(/\.(?:[cm]?[jt]s)$/, '').replace(/\/index$/, '');
}

function variableFor(node, sourceCode) {
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return undefined;
}

function expressions(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => {
    if (['parent', 'loc', 'range', 'tokens', 'comments'].includes(key)) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.filter(
      (item) => item && typeof item === 'object' && typeof item.type === 'string',
    );
  });
}

/** Follow bindings, not source spelling: comments, strings and shadowed imports never qualify. */
export function menuContract(context) {
  const filename = relativeFilename(context);
  const sourceCode = context.sourceCode ?? context.getSourceCode();

  function imported(node) {
    if (node?.type !== 'Identifier') return undefined;
    const definition = variableFor(node, sourceCode)?.defs.find(
      (def) => def.type === 'ImportBinding',
    );
    if (!definition) return undefined;
    return {
      source: modulePath(definition.parent.source.value, filename),
      name:
        definition.node.type === 'ImportNamespaceSpecifier'
          ? '*'
          : (definition.node.imported?.name ?? definition.node.imported?.value ?? 'default'),
    };
  }

  function isRecipe(node, recipe) {
    const binding = imported(node);
    if (binding)
      return [menuModule, recipeModule].includes(binding.source) && binding.name === recipe;
    if (node?.type !== 'MemberExpression' || node.computed) return false;
    const namespace = imported(node.object);
    return (
      namespace?.name === '*' &&
      [menuModule, recipeModule].includes(namespace.source) &&
      node.property.name === recipe
    );
  }

  function containsRecipe(node, recipe, seen = new Set()) {
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (node.type === 'Literal' || node.type === 'SvelteLiteral') return false;
    if (node.type === 'Identifier') {
      const variable = variableFor(node, sourceCode);
      return (
        variable?.defs.some((def) => {
          if (def.type === 'Variable') return containsRecipe(def.node.init, recipe, next);
          if (def.type === 'FunctionName') return containsRecipe(def.node.body, recipe, next);
          return false;
        }) ?? false
      );
    }
    if (node.type === 'ConditionalExpression') {
      return (
        containsRecipe(node.consequent, recipe, next) &&
        containsRecipe(node.alternate, recipe, next)
      );
    }
    if (node.type === 'CallExpression' && isRecipe(node.callee, recipe)) return true;
    return expressions(node).some((child) => containsRecipe(child, recipe, next));
  }

  function values(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (node.type === 'Literal' || node.type === 'SvelteLiteral') return [node.value];
    if (node.type === 'Identifier') {
      return (
        variableFor(node, sourceCode)?.defs.flatMap((def) => values(def.node.init, next)) ?? []
      );
    }
    if (node.type === 'ConditionalExpression')
      return [...values(node.consequent, next), ...values(node.alternate, next)];
    return expressions(node).flatMap((child) => values(child, next));
  }

  function component(node) {
    const name = svelteElementName(node);
    if (!name) return undefined;
    const [local, member] = name.split('.');
    let scope = sourceCode.getScope(node);
    let variable;
    while (scope && !variable) {
      variable = scope.set.get(local);
      scope = scope.upper;
    }
    const definition = variable?.defs.find((def) => def.type === 'ImportBinding');
    if (!definition) return undefined;
    const source = modulePath(definition.parent.source.value, filename);
    const exported = definition.node.imported?.name ?? definition.node.imported?.value;
    return { source, name: member ?? exported ?? 'default', namespace: exported };
  }

  function canonical(node, kind) {
    const binding = component(node);
    return (
      binding?.source === menuModule && (kind === 'row' ? menuRows : menuSurfaces).has(binding.name)
    );
  }

  function primitiveSurface(node) {
    const binding = component(node);
    return (
      binding?.source === 'bits-ui' &&
      ['DropdownMenu', 'ContextMenu'].includes(binding.namespace) &&
      ['Content', 'ContentStatic', 'SubContent', 'SubContentStatic'].includes(binding.name)
    );
  }

  function insideMenu(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type !== 'SvelteElement') continue;
      if (canonical(parent, 'row')) return false;
      const roles = values(attribute(parent, 'role'));
      if (roles.includes('listbox') || roles.includes('dialog')) return false;
      if (roles.includes('menu') || canonical(parent, 'surface')) return true;
    }
    return false;
  }

  function interactive(node) {
    const name = svelteElementName(node);
    const binding = component(node);
    return (
      name === 'button' ||
      (name === 'a' && Boolean(attribute(node, 'href'))) ||
      binding?.source === 'src/lib/components/ui/button' ||
      Boolean(attribute(node, 'onclick'))
    );
  }

  return { canonical, containsRecipe, insideMenu, interactive, primitiveSurface, values };
}
