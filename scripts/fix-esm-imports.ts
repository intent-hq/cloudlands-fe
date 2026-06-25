#!/usr/bin/env tsx

/**
 * Fix ESM Imports in Built Files
 *
 * This script adds .js extensions to relative imports in the built JavaScript files
 * to make them compatible with ES modules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultDistDir = path.join(__dirname, '../dist');

const aliasDirectories: Record<string, string> = {
  shared: 'shared',
  lib: 'lib',
  store: 'store',
  features: 'features',
};

function getAliasImportPath(file: string, distDir: string, aliasName: string, importPath: string) {
  const fileDir = path.dirname(file);
  const aliasDir = path.join(distDir, aliasDirectories[aliasName]);
  let relativePath = path.relative(fileDir, aliasDir).split(path.sep).join('/');

  if (!relativePath) {
    relativePath = '.';
  } else if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  return `${relativePath}/${importPath}`;
}

export interface FixImportsOptions {
  distDir?: string;
}

export async function fixImports(options: FixImportsOptions = {}) {
  const distDir = options.distDir ?? defaultDistDir;

  // Find all .js and .d.ts files in dist
  const files = await glob('**/*.{js,d.ts}', {
    cwd: distDir,
    absolute: true,
  });

  let fixedCount = 0;

  for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    let modified = false;

    content = content.replace(
      /from\s+(['"])\$(shared|lib|store|features)\/([^'"]+)\1/g,
      (match, quote, aliasName, importPath) => {
        modified = true;
        return `from ${quote}${getAliasImportPath(file, distDir, aliasName, importPath)}${quote}`;
      },
    );

    content = content.replace(
      /import\(\s*(['"])\$(shared|lib|store|features)\/([^'"]+)\1\s*\)/g,
      (match, quote, aliasName, importPath) => {
        modified = true;
        return `import(${quote}${getAliasImportPath(file, distDir, aliasName, importPath)}${quote})`;
      },
    );

    // Rewrite the removed `@augmentcode/ag-redux-toolkit/<subpath>` package
    // specifiers to the local store-shim emitted under dist/lib/store-shim. tsc
    // resolves these to the shim via tsconfig paths but leaves the specifier
    // untouched in the emitted JS, so they must be rewritten to relative paths.
    content = content.replace(
      /from\s+(['"])@augmentcode\/ag-redux-toolkit\/([^'"]+)\1/g,
      (match, quote, subpath) => {
        modified = true;
        return `from ${quote}${getAliasImportPath(file, distDir, 'lib', `store-shim/${subpath}`)}${quote}`;
      },
    );

    content = content.replace(
      /import\(\s*(['"])@augmentcode\/ag-redux-toolkit\/([^'"]+)\1\s*\)/g,
      (match, quote, subpath) => {
        modified = true;
        return `import(${quote}${getAliasImportPath(file, distDir, 'lib', `store-shim/${subpath}`)}${quote})`;
      },
    );

    // Only add .js extensions for JavaScript files, not TypeScript declaration files
    const isDeclarationFile = file.endsWith('.d.ts');

    if (!isDeclarationFile) {
      // Fix relative imports that don't have extensions
      // Match: import ... from './path' or '../path'
      content = content.replace(
        /from\s+['"](\.[^'"]+)(?<!\.js)(?<!\.json)(?<!\.mjs)(?<!\.cjs)['"]/g,
        (match, importPath) => {
          // Skip if it's already a directory import with index
          if (importPath.endsWith('/')) {
            return match;
          }

          // Check if the file exists with .js extension
          const basePath = path.dirname(file);
          const resolvedPath = path.resolve(basePath, importPath);

          // Try to find the actual file
          if (fs.existsSync(`${resolvedPath}.js`)) {
            modified = true;
            return `from '${importPath}.js'`;
          } else if (fs.existsSync(path.join(resolvedPath, 'index.js'))) {
            modified = true;
            return `from '${importPath}/index.js'`;
          }

          // If no file found, add .js anyway (it might be resolved differently)
          modified = true;
          return `from '${importPath}.js'`;
        },
      );

      // Also fix imports that are missing extensions but don't start with .
      // This handles imports like '../shared/logger' that were missed
      content = content.replace(
        /from\s+['"]([^'"./][^'"]*|\.\.\/[^'"]+)(?<!\.js)(?<!\.json)(?<!\.mjs)(?<!\.cjs)(?<!\.ts)['"]/g,
        (match, importPath) => {
          // Skip node modules and built-in modules
          if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
            // Check if it's a node module or built-in
            if (importPath.includes('/') && !importPath.startsWith('@')) {
              // This might be a relative import without ./ prefix, skip it
              return match;
            }
            // It's likely a node module, skip
            return match;
          }

          // For relative imports starting with ../
          if (importPath.startsWith('../')) {
            const basePath = path.dirname(file);
            const resolvedPath = path.resolve(basePath, importPath);

            // Try to find the actual file
            if (fs.existsSync(`${resolvedPath}.js`)) {
              modified = true;
              return `from '${importPath}.js'`;
            } else if (fs.existsSync(path.join(resolvedPath, 'index.js'))) {
              modified = true;
              return `from '${importPath}/index.js'`;
            }

            // If no file found, add .js anyway
            modified = true;
            return `from '${importPath}.js'`;
          }

          return match;
        },
      );

      // Also fix dynamic imports
      content = content.replace(
        /import\(['"](\.[^'"]+)(?<!\.js)(?<!\.json)(?<!\.mjs)(?<!\.cjs)['"]\)/g,
        (match, importPath) => {
          modified = true;
          return `import('${importPath}.js')`;
        },
      );

      // Fix export statements
      content = content.replace(
        /export\s+.*\s+from\s+['"](\.[^'"]+)(?<!\.js)(?<!\.json)(?<!\.mjs)(?<!\.cjs)['"]/g,
        (match, importPath) => {
          modified = true;
          return match.replace(importPath, `${importPath}.js`);
        },
      );
    }

    if (modified) {
      fs.writeFileSync(file, content, 'utf-8');
      fixedCount++;
    }
  }

  console.log(`✅ ESM imports fixed in ${fixedCount} files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fixImports().catch((error) => {
    console.error('Error fixing imports:', error);
    process.exit(1);
  });
}
