import path from 'node:path';
import { isWithin, relativeFilename, svelteElementName } from './common.js';

const iconAliasPrefixes = [
  '$lib/components/shared/icons/',
  '$lib/components/icons/',
  '$lib/icons/',
];
const iconDirectories = [
  'src/lib/components/shared/icons',
  'src/lib/components/icons',
  'src/lib/icons',
];
// vite.config.mjs aliases `svelte-fa` to `$lib/components/shared/icons/fa-proxy.ts`.
const iconPackages = new Set(['svelte-fa']);

function isButtonSource(source) {
  return (
    source === '$lib/components/ui/button' ||
    source === '$lib/components/ui/button/index.js' ||
    source.endsWith('/ui/button/button.svelte')
  );
}

function isIconSource(source, filename) {
  if (iconPackages.has(source)) return true;
  if (iconAliasPrefixes.some((prefix) => source.startsWith(prefix))) return true;
  if (!source.startsWith('.') || !filename || filename.startsWith('<')) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), source));
  return iconDirectories.some((directory) => isWithin(path.posix.dirname(resolved), directory));
}

function staticAttributeValue(attribute) {
  if (attribute.type !== 'SvelteAttribute' || !Array.isArray(attribute.value)) return undefined;
  if (attribute.value.length !== 1 || attribute.value[0].type !== 'SvelteLiteral') return undefined;
  return attribute.value[0].value;
}

function findAttribute(node, name) {
  return node.startTag.attributes.find(
    (attribute) =>
      (attribute.type === 'SvelteAttribute' || attribute.type === 'SvelteShorthandAttribute') &&
      attribute.key?.name === name,
  );
}

function isIconOnlyChildren(children, iconNames) {
  const meaningful = children.filter(
    (child) =>
      child.type !== 'SvelteHTMLComment' &&
      !(child.type === 'SvelteText' && child.value.trim() === ''),
  );
  return meaningful.length > 0 && meaningful.every((child) => isIconNode(child, iconNames));
}

function isIconNode(node, iconNames) {
  switch (node.type) {
    case 'SvelteElement':
      if (node.kind === 'html') return svelteElementName(node) === 'svg';
      return node.kind === 'component' && iconNames.has(svelteElementName(node));
    case 'SvelteIfBlock':
      return (
        isIconOnlyChildren(node.children, iconNames) &&
        (!node.else || isIconNode(node.else, iconNames))
      );
    case 'SvelteElseBlock':
      return isIconOnlyChildren(node.children, iconNames);
    default:
      return false;
  }
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require an icon size on icon-only Buttons' },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 0 },
          },
        },
      },
    ],
    messages: {
      missingIconSize:
        'Use `size="icon"` or another icon size such as `size="icon-compact"` instead — /sandbox/button',
    },
  },
  create(context) {
    const filename = relativeFilename(context);
    const options = context.options[0] ?? {};
    const buttonNames = new Set();
    const iconNames = new Set();
    const violations = [];

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const isButton = isButtonSource(source);
        const isIcon = !isButton && isIconSource(source, filename);
        if (!isButton && !isIcon) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') continue;
          if (isIcon) {
            iconNames.add(specifier.local.name);
          } else if (
            specifier.type === 'ImportDefaultSpecifier' ||
            specifier.imported.name === 'Button'
          ) {
            buttonNames.add(specifier.local.name);
          }
        }
      },
      SvelteElement(node) {
        if (!buttonNames.has(svelteElementName(node))) return;
        if (!findAttribute(node, 'iconOnly') && !isIconOnlyChildren(node.children, iconNames)) {
          return;
        }
        const size = findAttribute(node, 'size');
        if (!size) {
          violations.push(node.startTag);
          return;
        }
        const value = staticAttributeValue(size);
        if (value !== undefined && !value.startsWith('icon')) violations.push(size);
      },
      'Program:exit'() {
        const baselineCount = options.baseline?.[filename] ?? 0;
        for (const node of violations.slice(baselineCount)) {
          context.report({ node, messageId: 'missingIconSize' });
        }
      },
    };
  },
};
