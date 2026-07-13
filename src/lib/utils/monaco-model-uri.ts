const PRESERVED_SCRIPT_SUFFIXES = [
  '.d.mts',
  '.d.cts',
  '.d.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.ts',
  '.jsx',
  '.mjs',
  '.cjs',
  '.js',
  '.json',
];

function normalizeModelPath(sourcePath: string): string {
  return sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
}

function sanitizeInstanceId(instanceId: string): string {
  return instanceId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function createUniqueMonacoModelPath(sourcePath: string, instanceId: string): string {
  const normalizedPath = normalizeModelPath(sourcePath);
  const lowerPath = normalizedPath.toLowerCase();
  const uniquePart = `.__editor_${sanitizeInstanceId(instanceId)}`;
  const preservedSuffix = PRESERVED_SCRIPT_SUFFIXES.find((suffix) => lowerPath.endsWith(suffix));

  if (preservedSuffix) {
    return `${normalizedPath.slice(0, -preservedSuffix.length)}${uniquePart}${normalizedPath.slice(-preservedSuffix.length)}`;
  }

  const lastSlash = normalizedPath.lastIndexOf('/');
  const lastDot = normalizedPath.lastIndexOf('.');

  if (lastDot > lastSlash) {
    return `${normalizedPath.slice(0, lastDot)}${uniquePart}${normalizedPath.slice(lastDot)}`;
  }

  return `${normalizedPath}${uniquePart}`;
}

export function normalizeMonacoModelPath(sourcePath: string): string {
  return normalizeModelPath(sourcePath);
}
