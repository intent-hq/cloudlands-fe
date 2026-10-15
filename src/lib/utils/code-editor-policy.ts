/** Shared source editor budget; the React host additionally checks UTF-8 bytes. */
export const MAX_CODE_EDITOR_CONTENT_SIZE = 500 * 1024;

export function getCodeEditorLanguage(lang: string): string {
  const langMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    rs: 'rust',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    cpp: 'cpp',
    c: 'c',
    java: 'java',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    svelte: 'svelte',
    vue: 'html', // Vue is similar to HTML
    go: 'go',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    r: 'r',
    lua: 'lua',
    dockerfile: 'dockerfile',
    toml: 'ini',
    ini: 'ini',
    graphql: 'graphql',
    gql: 'graphql',
  };
  return langMap[lang] || lang;
}
