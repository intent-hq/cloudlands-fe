import { Tokenizer, type MarkedExtension, type Tokens } from 'marked';

const defaultDel = Tokenizer.prototype.del;

/**
 * Marked extension that restricts strikethrough to the double-tilde form
 * (`~~text~~`).
 *
 * marked's default GFM `del` tokenizer accepts one OR two tildes as the
 * delimiter, so prose containing two incidental single tildes (e.g.
 * "~$130K … ~$300K") gets a huge span struck through. The override rejects
 * single-tilde delimiters and otherwise delegates to the default tokenizer,
 * so every other `del` semantic (delimiter flanking rules, backslash-escape
 * handling, masked source scanning) matches default marked exactly.
 *
 * Apply with `marked.use(strikethroughDoubleTilde)` on every marked
 * instance/configuration.
 *
 * IMPORTANT: when there is no double-tilde match the tokenizer returns
 * `undefined`, NOT `false` — in marked, returning `false` from a tokenizer
 * override falls back to the default (single-tilde) tokenizer, which would
 * defeat the fix.
 */
export const strikethroughDoubleTilde: MarkedExtension = {
  tokenizer: {
    del(src: string, maskedSrc: string, prevChar?: string): Tokens.Del | undefined {
      if (!src.startsWith('~~')) {
        return undefined;
      }
      const token = defaultDel.call(this, src, maskedSrc, prevChar);
      return token?.raw.startsWith('~~') ? token : undefined;
    },
  },
};
