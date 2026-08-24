import type { MarkedExtension, Tokens } from 'marked';

/**
 * Matches only double-tilde strikethrough spans (`~~text~~`).
 *
 * marked's default GFM `del` tokenizer matches one OR two tildes (`^(~~?)…`),
 * so prose containing two incidental single tildes (e.g. "~$130K … ~$300K")
 * gets a huge span struck through. This regex requires exactly two tildes on
 * each side: the span must start and end with a non-space, non-tilde
 * character, and the closing `~~` must not be followed by another tilde.
 */
const DOUBLE_TILDE_DEL_REGEX = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?!~)/;

/**
 * Marked extension that restricts strikethrough to the double-tilde form.
 *
 * Apply with `marked.use(strikethroughDoubleTilde)` (or spread into an
 * existing `use({...})` call) on every marked instance/configuration.
 *
 * IMPORTANT: when there is no double-tilde match the tokenizer returns
 * `undefined`, NOT `false` — in marked, returning `false` from a tokenizer
 * override falls back to the default (single-tilde) tokenizer, which would
 * defeat the fix.
 */
export const strikethroughDoubleTilde: MarkedExtension = {
  tokenizer: {
    del(src: string): Tokens.Del | undefined {
      const match = DOUBLE_TILDE_DEL_REGEX.exec(src);
      if (!match) {
        return undefined;
      }
      return {
        type: 'del',
        raw: match[0],
        text: match[1],
        tokens: this.lexer.inlineTokens(match[1]),
      };
    },
  },
};
