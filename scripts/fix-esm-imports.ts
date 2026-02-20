#!/usr/bin/env tsx

/**
 * Fix ESM Imports in Built Files
 *
 * This script adds .js extensions to relative imports in the built JavaScript files
 * to make them compatible with ES modules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, '../dist');

async function fixImports() {
  // Find all .js and .d.ts files in dist
  const files = await glob('**/*.{js,d.ts}', {
    cwd: distDir,
    absolute: true,
  });

  let fixedCount = 0;

  for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    let modified = false;

    // Fix $shared alias imports to relative paths
    // The $shared alias points to src/shared, which becomes dist/shared in the build

    // Handle static imports: from '$shared/...'
    content = content.replace(/from\s+['"]\$shared\/([^'"]+)['"]/g, (match, importPath) => {
      // Calculate relative path from current file to shared directory
      const fileDir = path.dirname(file);
      const sharedDir = path.join(distDir, 'shared');
      let relativePath = path.relative(fileDir, sharedDir);

      // Ensure we use forward slashes for imports
      relativePath = relativePath.split(path.sep).join('/');

      // Add ./ if it doesn't start with ..
      if (!relativePath.startsWith('..')) {
        relativePath = `./${  relativePath}`;
      }

      modified = true;
      return `from '${relativePath}/${importPath}'`;
    });

    // Handle dynamic imports: import('$shared/...')
    content = content.replace(/import\(['"]\$shared\/([^'"]+)['"]\)/g, (match, importPath) => {
      // Calculate relative path from current file to shared directory
      const fileDir = path.dirname(file);
      const sharedDir = path.join(distDir, 'shared');
      let relativePath = path.relative(fileDir, sharedDir);

      // Ensure we use forward slashes for imports
      relativePath = relativePath.split(path.sep).join('/');

      // Add ./ if it doesn't start with ..
      if (!relativePath.startsWith('..')) {
        relativePath = `./${  relativePath}`;
      }

      modified = true;
      return `import('${relativePath}/${importPath}')`;
    });

    // Fix $lib alias imports to relative paths

    // Handle static imports: from '$lib/...'
    content = content.replace(/from\s+['"]\$lib\/([^'"]+)['"]/g, (match, importPath) => {
      // Calculate relative path from current file to lib directory
      const fileDir = path.dirname(file);
      const libDir = path.join(distDir, 'lib');
      let relativePath = path.relative(fileDir, libDir);

      // Ensure we use forward slashes for imports
      relativePath = relativePath.split(path.sep).join('/');

      // Add ./ if it doesn't start with ..
      if (!relativePath.startsWith('..')) {
        relativePath = `./${  relativePath}`;
      }

      modified = true;
      return `from '${relativePath}/${importPath}'`;
    });

    // Handle dynamic imports: import('$lib/...')
    content = content.replace(/import\(['"]\$lib\/([^'"]+)['"]\)/g, (match, importPath) => {
      // Calculate relative path from current file to lib directory
      const fileDir = path.dirname(file);
      const libDir = path.join(distDir, 'lib');
      let relativePath = path.relative(fileDir, libDir);

      // Ensure we use forward slashes for imports
      relativePath = relativePath.split(path.sep).join('/');

      // Add ./ if it doesn't start with ..
      if (!relativePath.startsWith('..')) {
        relativePath = `./${  relativePath}`;
      }

      modified = true;
      return `import('${relativePath}/${importPath}')`;
    });

    // Fix $features alias imports to relative paths
    content = content.replace(/from\s+['"]\$features\/([^'"]+)['"]/g, (match, importPath) => {
      // Calculate relative path from current file to features directory
      const fileDir = path.dirname(file);
      const featuresDir = path.join(distDir, 'features');
      let relativePath = path.relative(fileDir, featuresDir);

      // Ensure we use forward slashes for imports
      relativePath = relativePath.split(path.sep).join('/');

      // Add ./ if it doesn't start with ..
      if (!relativePath.startsWith('..')) {
        relativePath = `./${  relativePath}`;
      }

      modified = true;
      return `from '${relativePath}/${importPath}'`;
    });

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

fixImports().catch((error) => {
  console.error('Error fixing imports:', error);
  process.exit(1);
});
