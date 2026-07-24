import { describe, expect, it } from 'vitest';
import { posixSingleQuote } from '../posix-single-quote';

describe('posixSingleQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(posixSingleQuote('hello world')).toBe("'hello world'");
  });

  it('escapes embedded single quotes', () => {
    expect(posixSingleQuote("it's done")).toBe("'it'\\''s done'");
  });

  it('leaves backticks inert inside single quotes', () => {
    expect(posixSingleQuote('run `whoami` now')).toBe("'run `whoami` now'");
  });

  it('leaves $() command substitution inert inside single quotes', () => {
    expect(posixSingleQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });

  it('quotes the empty string', () => {
    expect(posixSingleQuote('')).toBe("''");
  });
});
