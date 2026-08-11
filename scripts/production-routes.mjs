import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROUTE_ENTRY_PATTERN = /^\+(?:page|layout|error|server)(?:\.server)?\.(?:svelte|[cm]?[jt]s)$/;

export const INTERNAL_ROUTE_PATTERNS = [
  /^sandbox(?:\/|$)/,
  /^\(app\)\/test-[^/]+(?:\/|$)/,
  /^\(app\)\/workspace\/\[id\]\/terminal-test(?:\/|$)/,
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

export function isInternalRouteFile(relativePath) {
  const normalizedPath = toPosix(relativePath);
  return INTERNAL_ROUTE_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

export function listProductionRouteFiles(sourceRoot) {
  return walk(sourceRoot)
    .filter((file) => ROUTE_ENTRY_PATTERN.test(path.basename(file)))
    .map((file) => toPosix(path.relative(sourceRoot, file)))
    .filter((file) => !isInternalRouteFile(file))
    .sort();
}

function importPath(fromFile, sourceFile) {
  const relativePath = toPosix(path.relative(path.dirname(fromFile), sourceFile));
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function createWrapper(outputFile, sourceFile) {
  const sourceImport = importPath(outputFile, sourceFile);
  if (sourceFile.endsWith('.svelte')) {
    if (path.basename(sourceFile) === '+layout.svelte') {
      return `<script>\n  import RouteComponent from ${JSON.stringify(sourceImport)};\n  let { children, ...routeProps } = $props();\n</script>\n\n<RouteComponent {...routeProps}>\n  {@render children?.()}\n</RouteComponent>\n`;
    }
    return `<script>\n  import RouteComponent from ${JSON.stringify(sourceImport)};\n  let routeProps = $props();\n</script>\n\n<RouteComponent {...routeProps} />\n`;
  }
  return `export * from ${JSON.stringify(sourceImport)};\n`;
}

export function prepareProductionRoutes({
  sourceRoot = 'src/routes',
  outputRoot = '.svelte-kit/production-routes',
} = {}) {
  const absoluteSourceRoot = path.resolve(sourceRoot);
  const absoluteOutputRoot = path.resolve(outputRoot);
  const routeFiles = listProductionRouteFiles(absoluteSourceRoot);

  rmSync(absoluteOutputRoot, { recursive: true, force: true });
  for (const relativeFile of routeFiles) {
    const outputFile = path.join(absoluteOutputRoot, relativeFile);
    const sourceFile = path.join(absoluteSourceRoot, relativeFile);
    mkdirSync(path.dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, createWrapper(outputFile, sourceFile));
  }

  writeFileSync(
    path.join(absoluteOutputRoot, 'route-manifest.json'),
    `${JSON.stringify(routeFiles, null, 2)}\n`,
  );
  return outputRoot;
}

export function resolveRoutesDirectory({
  production = process.env.NODE_ENV === 'production',
  sourceRoot = 'src/routes',
  outputRoot = '.svelte-kit/production-routes',
} = {}) {
  if (!production) return sourceRoot;
  return prepareProductionRoutes({ sourceRoot, outputRoot });
}

export function readProductionRouteManifest(outputRoot = '.svelte-kit/production-routes') {
  return JSON.parse(readFileSync(path.join(outputRoot, 'route-manifest.json'), 'utf8'));
}
