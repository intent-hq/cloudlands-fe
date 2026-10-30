import interFontData from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';
import {
  buildInlineHtmlRuntimeDocument,
  INLINE_HTML_THEME_TOKENS,
  type InlineHtmlTheme,
} from './inline-html-runtime';
import type { InlineVisualSnapshot } from './inline-visual-types';

export {
  INLINE_HTML_MAX_HEIGHT,
  INLINE_HTML_MAX_SCROLL_DELTA,
  INLINE_HTML_MIN_HEIGHT,
  type InlineHtmlTheme,
} from './inline-html-runtime';

export function readInlineHtmlTheme(element: Element): InlineHtmlTheme {
  const styles = getComputedStyle(element);
  return {
    dark: document.documentElement.classList.contains('dark'),
    variables: {
      ...Object.fromEntries(
        INLINE_HTML_THEME_TOKENS.map((token) => [
          `--${token}`,
          styles.getPropertyValue(`--${token}`).trim(),
        ]),
      ),
      // rem-based app tokens must use the host root, not the iframe's browser default.
      '--inline-html-root-font-size': getComputedStyle(document.documentElement).fontSize,
    },
  };
}

/** Renderer entry: the shared runtime builder with the bundled Inter font. */
export function buildInlineHtmlDocument(
  source: string,
  channel: string,
  theme: InlineHtmlTheme,
  frameTitle: string,
  initialSnapshot: InlineVisualSnapshot | null = null,
): string {
  return buildInlineHtmlRuntimeDocument(
    source,
    channel,
    theme,
    frameTitle,
    initialSnapshot,
    interFontData,
  );
}
