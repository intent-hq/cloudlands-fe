#!/usr/bin/env node
/**
 * Script to migrate agent instruction .md files to .ts constants
 *
 * Converts resources/agent-rules/*.md to src/features/agent/instructions/*.ts
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '../resources/agent-rules');
const TARGET_DIR = path.join(__dirname, '../src/features/agent/instructions');

// Files to skip (README, etc.)
const SKIP_FILES = ['README.md'];

/**
 * Convert markdown content to TypeScript string constant
 */
function convertToTsConstant(mdContent, filename) {
  // Escape backticks and template literal expressions in the content
  let escapedContent = mdContent.replace(/\\/g, '\\\\'); // Escape backslashes first
  escapedContent = escapedContent.replace(/`/g, '\\`'); // Escape backticks
  escapedContent = escapedContent.replace(/\$/g, '\\$'); // Escape dollar signs (for template literals)

  // Extract instruction ID from filename
  const instructionId = path.basename(filename, '.md');

  return `/**
 * Agent instruction: ${instructionId}
 *
 * Source: resources/agent-rules/${filename}
 */

const INSTRUCTION = \`${escapedContent}\`;

export default INSTRUCTION;
`;
}

/**
 * Process a single file
 */
function processFile(sourceFile, targetFile) {
  console.log(`Converting ${sourceFile} -> ${targetFile}`);

  const mdContent = fs.readFileSync(sourceFile, 'utf-8');
  const tsContent = convertToTsConstant(mdContent, path.basename(sourceFile));

  // Ensure target directory exists
  const targetDir = path.dirname(targetFile);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetFile, tsContent, 'utf-8');
  console.log(`✓ Created ${targetFile}`);
}

/**
 * Process all files in a directory
 */
function processDirectory(sourceDir, targetDir) {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);

    if (entry.isDirectory()) {
      // Recursively process subdirectories
      const targetSubdir = path.join(targetDir, entry.name);
      processDirectory(sourcePath, targetSubdir);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Skip files in the skip list
      if (SKIP_FILES.includes(entry.name)) {
        console.log(`Skipping ${entry.name}`);
        continue;
      }

      // Convert .md to .ts
      const tsFilename = entry.name.replace(/\.md$/, '.ts');
      const targetPath = path.join(targetDir, tsFilename);
      processFile(sourcePath, targetPath);
    }
  }
}

/**
 * Main execution
 */
function main() {
  console.log('Starting migration of agent instructions...\n');
  console.log(`Source: ${SOURCE_DIR}`);
  console.log(`Target: ${TARGET_DIR}\n`);

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Error: Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  // Ensure target directory exists
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  // Process all files
  processDirectory(SOURCE_DIR, TARGET_DIR);

  console.log('\n✓ Migration complete!');
  console.log('\nNext steps:');
  console.log('1. Create src/features/agent/instructions/index.ts with exports');
  console.log('2. Update CachedRulesService to import from instructions/');
  console.log('3. Test the changes');
}

main();
