#!/usr/bin/env node
/**
 * Generate a file tree JSON from a directory for the Ecosystem Visualizer
 * Usage: node scripts/generate-file-tree.js /path/to/folder
 */

const fs = require('fs');
const path = require('path');

const EXCLUDE_PATTERNS = [
  'node_modules', '.git', '.svn', 'dist', 'build', '.next', '__pycache__',
  '.cache', '.vscode', '.idea', 'coverage', '.nyc_output', 'vendor',
  'target', '.gradle', 'Pods', '.egg-info', '.tox', 'venv', '.venv',
  '__MACOSX', '.DS_Store', 'third_party', 'third-party',
];

function shouldExclude(name) {
  return EXCLUDE_PATTERNS.some(p => name === p || name.endsWith('.egg-info'));
}

function buildTree(dirPath, name, maxDepth = 50, currentDepth = 0) {
  if (currentDepth > maxDepth) return null;

  const stats = fs.statSync(dirPath);

  if (stats.isFile()) {
    return { name, path: dirPath, size: stats.size };
  }

  if (!stats.isDirectory()) return null;

  const children = [];
  let totalSize = 0;

  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (shouldExclude(entry)) continue;

      const fullPath = path.join(dirPath, entry);
      try {
        const child = buildTree(fullPath, entry, maxDepth, currentDepth + 1);
        if (child) {
          children.push(child);
          totalSize += child.size;
        }
      } catch (err) {
        // Skip files we can't read
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }

  return { name, path: dirPath, size: totalSize, children };
}

function countNodes(node) {
  if (!node.children) return 1;
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// Main
const targetDir = process.argv[2];
if (!targetDir) {
  console.error('Usage: node generate-file-tree.js /path/to/folder');
  process.exit(1);
}

const resolvedPath = path.resolve(targetDir);
const folderName = path.basename(resolvedPath);

console.error(`Building tree for: ${resolvedPath}`);
const tree = buildTree(resolvedPath, folderName);
const nodeCount = countNodes(tree);
console.error(`Generated tree with ${nodeCount} nodes`);

// Output JSON to stdout
console.log(JSON.stringify(tree));
