import * as path from 'path';

export function safeResolvePath(root: string, requestPath: string): string | null {
  const rootPath = path.resolve(root);
  const resolvedPath = path.resolve(rootPath, requestPath);
  if (resolvedPath === rootPath || resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    return resolvedPath;
  }
  return null;
}
