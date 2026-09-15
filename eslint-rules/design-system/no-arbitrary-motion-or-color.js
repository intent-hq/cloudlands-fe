import postcss from 'postcss';
import {
  physicalCssColorViolations,
  physicalUtilityViolations,
  relativeFilename,
} from './common.js';

function closestSvelteAttribute(node) {
  let current = node.parent;
  while (current && current.type !== 'SvelteAttribute' && current.type !== 'SvelteStyleDirective') {
    current = current.parent;
  }
  return current;
}

function attributeName(attribute) {
  const name = attribute?.key?.name;
  return typeof name === 'string' ? name : name?.name;
}

function cssDeclarationViolations(value, inline = false) {
  try {
    const root = postcss.parse(inline ? `x{${value}}` : value);
    const violations = [];
    root.walkDecls((declaration) => {
      violations.push(...physicalCssColorViolations(declaration.value));
    });
    return violations;
  } catch {
    return inline ? physicalCssColorViolations(value) : [];
  }
}

function isAllowed(violation, filename, allowlist) {
  return allowlist.some(
    (exception) =>
      exception.files.includes(filename) &&
      (exception.colors.includes(violation.color) || exception.utilities.includes(violation.token)),
  );
}

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer design tokens over arbitrary motion and color utilities' },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 0 },
          },
          allowlist: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'files', 'colors', 'utilities'],
              properties: {
                name: { type: 'string', minLength: 1 },
                files: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
                colors: { type: 'array', items: { type: 'string', minLength: 1 } },
                utilities: { type: 'array', items: { type: 'string', minLength: 1 } },
              },
            },
          },
        },
      },
    ],
    messages: {
      arbitraryMotion: 'Use `design motion tokens` instead — /sandbox/tokens',
      arbitraryColor: 'Use `semantic color tokens` instead — /sandbox/tokens',
      physicalPalette: 'Use `semantic color tokens` instead — /sandbox/tokens',
      cssColor: 'Use `semantic CSS color tokens` instead — /sandbox/tokens',
      svgColor: 'Use `semantic SVG color tokens` instead — /sandbox/tokens',
    },
  },
  create(context) {
    const filename = relativeFilename(context);
    const options = context.options[0] ?? {};
    const allowlist = options.allowlist ?? [];
    const violations = [];

    function collect(node, value) {
      const found = physicalUtilityViolations(value);
      const attribute = closestSvelteAttribute(node);
      const name = attributeName(attribute);
      if (name === 'style') found.push(...cssDeclarationViolations(value, true));
      if (name === 'fill' || name === 'stroke') {
        found.push(...physicalCssColorViolations(value, 'svgColor'));
      }
      for (const violation of found) {
        if (!isAllowed(violation, filename, allowlist)) violations.push({ node, ...violation });
      }
    }

    return {
      Literal(node) {
        collect(node, node.value);
      },
      SvelteLiteral(node) {
        collect(node, node.value);
      },
      TemplateElement(node) {
        collect(node, node.value?.raw);
      },
      SvelteText(node) {
        if (node.parent?.type !== 'SvelteStyleElement') return;
        for (const violation of cssDeclarationViolations(node.value)) {
          if (!isAllowed(violation, filename, allowlist)) violations.push({ node, ...violation });
        }
      },
      'Program:exit'() {
        const baselineCount = options.baseline?.[filename] ?? 0;
        for (const violation of violations.slice(baselineCount)) {
          context.report({ node: violation.node, messageId: violation.messageId });
        }
      },
    };
  },
};
