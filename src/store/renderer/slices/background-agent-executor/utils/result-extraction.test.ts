import { describe, expect, it } from 'vitest';
import {
  extractCommitResultFromText,
  extractPrResultFromText,
  extractResultFromText,
} from './result-extraction';

describe('extractCommitResultFromText ({"subject", "body"?} JSON contract)', () => {
  it('extracts a bare JSON object', () => {
    expect(extractCommitResultFromText('{"subject": "feat: add thing"}')).toEqual({
      result: 'feat: add thing',
      error: null,
    });
  });

  it('joins subject and body with a blank line', () => {
    expect(
      extractCommitResultFromText('{"subject": "fix: bug", "body": "Explains what and why."}'),
    ).toEqual({ result: 'fix: bug\n\nExplains what and why.', error: null });
  });

  it('omits the body separator when body is empty or missing', () => {
    expect(extractCommitResultFromText('{"subject": "fix: bug", "body": ""}').result).toBe(
      'fix: bug',
    );
    expect(extractCommitResultFromText('{"subject": "fix: bug", "body": "  "}').result).toBe(
      'fix: bug',
    );
  });

  it('tolerates a wrapping code fence', () => {
    const text = '```json\n{"subject": "feat: fenced"}\n```';
    expect(extractCommitResultFromText(text)).toEqual({ result: 'feat: fenced', error: null });
  });

  it('tolerates surrounding prose', () => {
    const text = 'Here is the commit message:\n{"subject": "feat: prose"}\nHope that helps!';
    expect(extractCommitResultFromText(text)).toEqual({ result: 'feat: prose', error: null });
  });

  it('handles braces and escaped quotes inside JSON strings', () => {
    const text = '{"subject": "fix: handle {braces}", "body": "Escapes \\"quotes\\" and { }."}';
    expect(extractCommitResultFromText(text)).toEqual({
      result: 'fix: handle {braces}\n\nEscapes "quotes" and { }.',
      error: null,
    });
  });

  it('skips a non-JSON brace run and parses the real object after it', () => {
    const text = 'ignore {this is not json} but use {"subject": "feat: later"}';
    expect(extractCommitResultFromText(text)).toEqual({ result: 'feat: later', error: null });
  });

  it('skips a bare {} in prose before the real payload', () => {
    const text = 'The diff replaces {} defaults. {"subject": "fix: real"}';
    expect(extractCommitResultFromText(text)).toEqual({ result: 'fix: real', error: null });
  });

  it('skips a schema-invalid object in prose before the real payload', () => {
    const text = '{"note": "context"} {"subject": "fix: real"}';
    expect(extractCommitResultFromText(text)).toEqual({ result: 'fix: real', error: null });
  });

  it('uses the first schema-valid object when two are present', () => {
    const text = '{"subject": "feat: first"} {"subject": "feat: second"}';
    expect(extractCommitResultFromText(text)).toEqual({ result: 'feat: first', error: null });
  });

  it('collapses embedded newlines in the subject into spaces', () => {
    const text = '{"subject": "feat: line one\\nline two"}';
    expect(extractCommitResultFromText(text)).toEqual({
      result: 'feat: line one line two',
      error: null,
    });
  });

  it('errors on empty output', () => {
    expect(extractCommitResultFromText('')).toEqual({
      result: null,
      error: 'Empty response from model',
    });
    expect(extractCommitResultFromText('   \n  ').result).toBeNull();
  });

  it('errors when no JSON object is present', () => {
    const { result, error } = extractCommitResultFromText('feat: bare text, not JSON');
    expect(result).toBeNull();
    expect(error).toContain('JSON object');
  });

  it('errors when subject is missing or empty', () => {
    const missing = extractCommitResultFromText('{"body": "no subject"}');
    expect(missing.result).toBeNull();
    expect(missing.error).toContain('"subject"');

    const empty = extractCommitResultFromText('{"subject": "  "}');
    expect(empty.result).toBeNull();
    expect(empty.error).toContain('"subject"');
  });
});

describe('extractPrResultFromText ({"title", "body"} JSON contract)', () => {
  it('formats the result as a first-line heading plus body', () => {
    expect(
      extractPrResultFromText('{"title": "Add retry logic", "body": "Implements retry."}'),
    ).toEqual({ result: '# Add retry logic\n\nImplements retry.', error: null });
  });

  it('preserves markdown line breaks in the body', () => {
    const text = '{"title": "T", "body": "**Summary:** s\\n\\n- one\\n- two"}';
    expect(extractPrResultFromText(text).result).toBe('# T\n\n**Summary:** s\n\n- one\n- two');
  });

  it('tolerates a code fence with surrounding prose', () => {
    const text = 'Sure!\n```json\n{"title": "Fenced", "body": "B"}\n```\nDone.';
    expect(extractPrResultFromText(text)).toEqual({ result: '# Fenced\n\nB', error: null });
  });

  it('skips a schema-invalid object in prose before the real payload', () => {
    const text = 'Context: {} then {"title": "Real title", "body": "Real body."}';
    expect(extractPrResultFromText(text)).toEqual({
      result: '# Real title\n\nReal body.',
      error: null,
    });
  });

  it('collapses embedded newlines in the title into spaces', () => {
    const text = '{"title": "Line one\\nline two", "body": "B"}';
    expect(extractPrResultFromText(text)).toEqual({
      result: '# Line one line two\n\nB',
      error: null,
    });
  });

  it('errors when body is missing or empty', () => {
    const empty = extractPrResultFromText('{"title": "Only title", "body": ""}');
    expect(empty.result).toBeNull();
    expect(empty.error).toContain('"body"');

    const missing = extractPrResultFromText('{"title": "Only title"}');
    expect(missing.result).toBeNull();
    expect(missing.error).toContain('"body"');

    const nonString = extractPrResultFromText('{"title": "Only title", "body": 42}');
    expect(nonString.result).toBeNull();
    expect(nonString.error).toContain('"body"');
  });

  it('errors when title is missing', () => {
    const { result, error } = extractPrResultFromText('{"body": "no title"}');
    expect(result).toBeNull();
    expect(error).toContain('"title"');
  });

  it('errors when no JSON object is present', () => {
    const { result, error } = extractPrResultFromText('# Markdown heading\n\nNot JSON.');
    expect(result).toBeNull();
    expect(error).toContain('JSON object');
  });
});

describe('extractResultFromText (tag contract, unchanged for review)', () => {
  it('still extracts a tagged block', () => {
    const text = 'pre <<<CODE_REVIEW>>>Looks good.<<</CODE_REVIEW>>> post';
    expect(extractResultFromText(text, 'CODE_REVIEW')).toEqual({
      result: 'Looks good.',
      error: null,
    });
  });

  it('still errors when the tag is missing', () => {
    const { result, error } = extractResultFromText('no tags', 'CODE_REVIEW');
    expect(result).toBeNull();
    expect(error).toContain('CODE_REVIEW');
  });
});
