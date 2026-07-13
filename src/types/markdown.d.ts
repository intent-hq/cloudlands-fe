/**
 * Type declarations for importing markdown files as raw text
 */

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.md' {
  const content: string;
  export default content;
}
