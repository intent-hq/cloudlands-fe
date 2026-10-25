import path from 'node:path';
import { isWithin, relativeFilename, svelteElementName } from './common.js';

const boundary = String.raw`(?:^|[\s"'\x60])`;
const end = String.raw`(?=$|[\s"'\x60])`;
const variants = String.raw`(?:[^\s:"'\x60]+:)*`;
const opacity = String.raw`\/[^\s"'\x60!]+`;
const utility = (name, suffix = `(?:${opacity})?`) =>
  new RegExp(`${boundary}${variants}!?${name}${suffix}!?${end}`);

const bgForeground = utility('bg-foreground');
const textBackground = utility('text-background');
const mixedTextBackground = utility('text-background', opacity);
// Background utilities that size, place, or blend instead of painting a color.
const nonColorBackground =
  '(?:none|cover|contain|auto|center|fixed|local|scroll|repeat|no-repeat|clip-|origin-|blend-|linear-|radial|conic|gradient-|size-|position-)';
const backgroundColor = new RegExp(
  `${boundary}${variants}!?bg-(?!${nonColorBackground})[^\\s"'\\x60]+${end}`,
);

const tooltipModule = /(?:^|\/)components\/ui\/tooltip(?:\/|$)/;
const tooltipDirectory = 'src/lib/components/ui/tooltip';

function staticStrings(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'SvelteLiteral') out.push(node.value);
  else if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
  else if (node.type === 'TemplateElement') out.push(node.value.cooked ?? node.value.raw);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) for (const child of value) staticStrings(child, out);
    else if (value && typeof value === 'object' && typeof value.type === 'string') {
      staticStrings(value, out);
    }
  }
  return out;
}

function attribute(element, name) {
  return element.startTag?.attributes?.find(
    (candidate) => candidate.type === 'SvelteAttribute' && candidate.key?.name === name,
  );
}

function tooltipKind(name, imports) {
  const [head, member] = (name ?? '').split('.');
  const binding = imports.get(head);
  if (!binding) return null;
  if (member) return binding.imported === '*' && member === 'Content' ? 'content' : null;
  const imported =
    binding.imported === 'default' ? path.basename(binding.source, '.svelte') : binding.imported;
  if (imported === 'Tooltip') return 'tooltip';
  if (imported === 'TooltipShortcut') return 'shortcut';
  if (imported === 'TooltipContent' || imported === 'Content') return 'content';
  return null;
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Paint inverted surfaces only through `surface-inverse`' },
    schema: [],
    messages: {
      rawInverseSurface: 'Use `surface-inverse` instead — /sandbox/tooltip',
      mixedInverseText:
        'Use `text-muted-foreground` on `surface-inverse` instead — /sandbox/tooltip',
      repaintedTooltip: 'Use `variant="secondary"` or `TooltipRich` instead — /sandbox/tooltip',
    },
  },
  create(context) {
    const filename = relativeFilename(context) ?? '';
    const imports = new Map();
    const components = [];

    function checkClass(node, value) {
      if (typeof value !== 'string') return;
      if (bgForeground.test(value) && textBackground.test(value)) {
        context.report({ node, messageId: 'rawInverseSurface' });
      } else if (mixedTextBackground.test(value)) {
        context.report({ node, messageId: 'mixedInverseText' });
      }
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const local = typeof source === 'string' && source.startsWith('./');
        if (!tooltipModule.test(source) && !(local && isWithin(filename, tooltipDirectory))) return;
        for (const specifier of node.specifiers) {
          const imported =
            specifier.type === 'ImportNamespaceSpecifier'
              ? '*'
              : specifier.type === 'ImportDefaultSpecifier'
                ? 'default'
                : (specifier.imported.name ?? specifier.imported.value);
          imports.set(specifier.local.name, { imported, source });
        }
      },
      Literal(node) {
        checkClass(node, node.value);
      },
      TemplateElement(node) {
        checkClass(node, node.value.cooked ?? node.value.raw);
      },
      SvelteLiteral(node) {
        const name = node.parent?.type === 'SvelteAttribute' ? node.parent.key?.name : undefined;
        if (typeof name === 'string' && !/class$/i.test(name)) return;
        checkClass(node, node.value);
      },
      SvelteElement(node) {
        if (node.kind === 'component') components.push(node);
      },
      'Program:exit'() {
        for (const element of components) {
          const kind = tooltipKind(svelteElementName(element), imports);
          if (!kind) continue;
          if (kind === 'tooltip') {
            const variant = attribute(element, 'variant');
            const values = variant ? staticStrings(variant) : ['default'];
            if (values.length !== 1 || values[0] !== 'default') continue;
          }
          const paint = attribute(element, kind === 'content' ? 'class' : 'contentClass');
          if (paint && staticStrings(paint).some((value) => backgroundColor.test(value))) {
            context.report({ node: paint, messageId: 'repaintedTooltip' });
          }
        }
      },
    };
  },
};
