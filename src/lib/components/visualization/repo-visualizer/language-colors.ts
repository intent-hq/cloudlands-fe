/**
 * Language colors from GitHub Linguist
 * Ported from githubocto/repo-visualizer
 */

export const languageColors: Record<string, string> = {
  // Web
  js: '#f1e05a',
  jsx: '#f1e05a',
  ts: '#0060ac',
  tsx: '#0060ac',
  mjs: '#f1e05a',
  cjs: '#f1e05a',
  vue: '#41b883',
  svelte: '#ff3e00',
  html: '#e34c26',
  htm: '#e34c26',
  css: '#563d7c',
  scss: '#c6538c',
  sass: '#a53b70',
  less: '#1d365d',
  json: '#292929',
  jsonc: '#292929',

  // Backend
  py: '#3572A5',
  rb: '#701516',
  go: '#00ADD8',
  rs: '#dea584',
  java: '#b07219',
  kt: '#A97BFF',
  scala: '#c22d40',
  php: '#4F5D95',
  cs: '#178600',
  fs: '#b845fc',
  swift: '#F05138',

  // Systems
  c: '#555555',
  cpp: '#f34b7d',
  cc: '#f34b7d',
  h: '#438eff',
  hpp: '#f34b7d',
  asm: '#005daa',

  // Config
  yml: '#cb171e',
  yaml: '#cb171e',
  toml: '#9c4221',
  xml: '#0060ac',
  ini: '#d1dbe0',
  env: '#89e051',

  // Shell
  sh: '#89e051',
  bash: '#89e051',
  zsh: '#89e051',
  fish: '#4aae47',
  ps1: '#012456',

  // Data
  sql: '#e38c00',
  graphql: '#e10098',
  gql: '#e10098',
  prisma: '#0c344b',

  // Markup
  md: '#083fa1',
  mdx: '#083fa1',
  markdown: '#083fa1',
  rst: '#141414',
  tex: '#3D6117',

  // Build
  dockerfile: '#384d54',
  makefile: '#427819',
  cmake: '#DA3434',
  gradle: '#02303a',

  // Mobile
  dart: '#00B4AB',
  m: '#438eff',
  mm: '#0060ac',

  // Functional
  hs: '#5e5086',
  elm: '#60B5CC',
  clj: '#db5855',
  ex: '#6e4a7e',
  exs: '#6e4a7e',
  erl: '#B83998',

  // Other
  lua: '#000080',
  r: '#358a5b',
  jl: '#a270ba',
  nim: '#ffc200',
  zig: '#ec915c',
  sol: '#AA6746',
  wasm: '#04133b',

  // Text & docs
  txt: '#7a8599',
  log: '#7a8599',
  csv: '#89e051',
  tsv: '#89e051',

  // Lock files
  lock: '#555555',

  // Images (usually filtered but just in case)
  svg: '#ff9900',
  png: '#a855f7',
  jpg: '#a855f7',
  jpeg: '#a855f7',
  gif: '#a855f7',
  ico: '#a855f7',

  // Default fallback
  default: '#8b95a5',
};

export default languageColors;
