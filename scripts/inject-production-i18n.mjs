import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenProductionScriptCsp, injectParaglideBundle } from './fix-production-html-utils.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = process.argv[2];
if (!outputDirectory)
  throw new Error('Usage: node scripts/inject-production-i18n.mjs <output-directory>');
const outputRoot = path.resolve(repositoryRoot, outputDirectory);

function findHtmlFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolutePath = path.join(directory, name);
    return statSync(absolutePath).isDirectory()
      ? findHtmlFiles(absolutePath)
      : absolutePath.endsWith('.html')
        ? [absolutePath]
        : [];
  });
}

const htmlFiles = findHtmlFiles(outputRoot);
if (htmlFiles.length === 0) throw new Error(`No HTML output found in ${outputRoot}`);

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  writeFileSync(file, hardenProductionScriptCsp(injectParaglideBundle(html)));
}

console.log(
  `Injected production i18n and hardened CSP in ${htmlFiles.length} HTML file(s) in ${outputDirectory}`,
);
