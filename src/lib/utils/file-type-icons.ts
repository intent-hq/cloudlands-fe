import { getIcon } from 'material-file-icons';

/**
 * Get a material-style SVG icon string for a given filename.
 * Uses the material-file-icons library (VS Code Material Icon Theme icons).
 * Returns an SVG string that can be rendered with {@html ...} in Svelte.
 */
export function getFileTypeIconSvg(filename: string): string {
  return getIcon(filename).svg;
}
