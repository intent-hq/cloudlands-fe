import path from 'node:path';
import fs from 'node:fs';

const colorUtilities =
  '(?:bg|text|outline|fill|stroke|divide|accent|caret|border(?:-[trblxyse])?|ring(?:-offset)?)';
const physicalPalettes =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)';
const utilityBoundaryStart = String.raw`(?:^|[\s"'\x60])`;
const utilityBoundaryEnd = String.raw`(?=$|[\s"'\x60])`;
const variants = String.raw`(?:[^\s:"'\x60]+:)*`;
const arbitraryColor = String.raw`(#[\da-fA-F]{3,8}|(?:rgba?|hsla?)\([^\]\r\n]+\))`;

const motionUtility = new RegExp(
  String.raw`${utilityBoundaryStart}(${variants}(?:duration|ease)-\[(?!var\()[^\]\r\n]+\])${utilityBoundaryEnd}`,
  'g',
);
const arbitraryColorUtility = new RegExp(
  String.raw`${utilityBoundaryStart}(${variants}${colorUtilities}-\[${arbitraryColor}\](?:\/[^\s"'\x60]+)?)${utilityBoundaryEnd}`,
  'gi',
);
const paletteUtility = new RegExp(
  String.raw`${utilityBoundaryStart}(${variants}${colorUtilities}-${physicalPalettes}(?:-(?:50|[1-9]00|950))?(?:\/[^\s"'\x60]+)?)${utilityBoundaryEnd}`,
  'gi',
);
const hexColor = /(?:#[\da-f]{8}|#[\da-f]{6}|#[\da-f]{4}|#[\da-f]{3})(?![\da-f])/gi;
const functionalColor = /\b(?:rgb|hsl)a?\(\s*(?!var\()[^)]*\)/gi;

export const packageRoot = fs.existsSync(path.join(process.cwd(), 'eslint.config.js'))
  ? process.cwd()
  : path.join(process.cwd(), 'packages/cloudlands-fe');

export function relativeFilename(context) {
  const filename = context.filename ?? context.getFilename();
  if (!filename || filename.startsWith('<')) return filename;
  const absolute = path.isAbsolute(filename) ? filename : path.resolve(filename);
  return path.relative(packageRoot, absolute).split(path.sep).join('/');
}

export function isWithin(filename, directory) {
  return filename === directory || filename.startsWith(`${directory}/`);
}

export function svelteElementName(node) {
  if (typeof node.name === 'string') return node.name;
  if (node.name?.type === 'SvelteMemberExpressionName') {
    return `${node.name.object?.name}.${node.name.property?.name}`;
  }
  return node.name?.name;
}

export function physicalUtilityViolations(value) {
  if (typeof value !== 'string') return [];
  const violations = [];
  for (const match of value.matchAll(motionUtility)) {
    violations.push({ messageId: 'arbitraryMotion', token: match[1] });
  }
  for (const match of value.matchAll(arbitraryColorUtility)) {
    violations.push({ messageId: 'arbitraryColor', token: match[1], color: match[2] });
  }
  for (const match of value.matchAll(paletteUtility)) {
    violations.push({ messageId: 'physicalPalette', token: match[1] });
  }
  return violations;
}

export function physicalCssColorViolations(value, messageId = 'cssColor') {
  if (typeof value !== 'string') return [];
  const declarations = value.replace(/\burl\([^)]*\)/gi, '');
  return [...declarations.matchAll(hexColor), ...declarations.matchAll(functionalColor)]
    .filter(
      (match) => (match[0].startsWith('#') || /[0-9]/.test(match[0])) && !match[0].includes('var('),
    )
    .sort((left, right) => left.index - right.index)
    .map((match) => ({ messageId, token: match[0], color: match[0] }));
}

export const namedColorAllowlist = [
  {
    name: 'terminal-output-theme',
    files: ['src/lib/components/chat/ToolDetails.svelte'],
    colors: ['#1a1b26', '#7aa2f7', '#9ece6a', '#a9b1d6', '#f7768e'],
    utilities: [],
  },
  {
    name: 'code-block-syntax-theme',
    files: ['src/lib/components/editor/CodeBlock.svelte'],
    colors: [
      '#0000ff',
      '#001080',
      '#008000',
      '#098658',
      '#1e1e1e',
      '#1f2937',
      '#267f99',
      '#2d2d3a',
      '#3d3d4a',
      '#3c3c3c',
      '#4ec9b0',
      '#569cd6',
      '#6a9955',
      '#795e26',
      '#800000',
      '#9cdcfe',
      '#a31515',
      '#b5cea8',
      '#ce9178',
      '#d4d4d4',
      '#d7ba7d',
      '#dcdcaa',
      '#e50000',
      '#e5e7eb',
      '#f8f9fa',
      '#ffffff',
      'rgba(128, 128, 128, 0.2)',
      'rgba(133, 133, 133, 0.5)',
      'rgba(86, 156, 214, 0.15)',
    ],
    utilities: [
      'bg-white/80',
      'hover:bg-gray-100',
      'hover:text-gray-200',
      'hover:text-gray-700',
      'text-gray-400',
      'text-gray-500',
    ],
  },
  {
    name: 'change-visualization-diff-palette',
    files: ['src/lib/components/file-tracking/change-set-visualization/FileColumn.svelte'],
    colors: ['#0B2916', '#220B09', '#331513', '#7CE2A1', '#F79697'],
    utilities: [],
  },
];
