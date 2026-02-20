/**
 * Language/extension colors for the ecosystem visualizer
 */

const languageColors: Record<string, string> = {
  // JavaScript/TypeScript
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#f7df1e',
  mjs: '#f7df1e',
  cjs: '#f7df1e',

  // Svelte
  svelte: '#ff3e00',

  // Vue
  vue: '#42b883',

  // React
  css: '#264de4',
  scss: '#cc6699',
  sass: '#cc6699',
  less: '#1d365d',

  // HTML/Templates
  html: '#e34c26',
  htm: '#e34c26',
  ejs: '#a91e50',
  pug: '#a86454',

  // Config/Data
  json: '#cbcb41',
  yaml: '#cb171e',
  yml: '#cb171e',
  toml: '#9c4221',
  xml: '#f16529',

  // Markdown/Docs
  md: '#083fa1',
  mdx: '#1b1f24',
  txt: '#6e7681',

  // Python
  py: '#3776ab',
  pyi: '#3776ab',
  pyc: '#3776ab',

  // Rust
  rs: '#dea584',

  // Go
  go: '#00add8',

  // Ruby
  rb: '#cc342d',

  // PHP
  php: '#777bb4',

  // Java/Kotlin
  java: '#b07219',
  kt: '#a97bff',
  kts: '#a97bff',

  // C/C++
  c: '#555555',
  h: '#555555',
  cpp: '#f34b7d',
  hpp: '#f34b7d',
  cc: '#f34b7d',

  // Shell
  sh: '#89e051',
  bash: '#89e051',
  zsh: '#89e051',

  // SQL
  sql: '#e38c00',

  // GraphQL
  graphql: '#e535ab',
  gql: '#e535ab',

  // Misc
  env: '#ecd53f',
  gitignore: '#f14e32',
  dockerfile: '#384d54',
  makefile: '#427819',
  lock: '#6e7681',

  // Default
  default: '#71717a',
};

export default languageColors;

export function getColorForExtension(extension?: string): string {
  if (!extension) return languageColors.default;
  return languageColors[extension.toLowerCase()] || languageColors.default;
}
