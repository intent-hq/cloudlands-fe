import path from 'node:path';
import fs from 'node:fs';

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
