/**
 * Tests for detectBinaryContent in shared/binary-file-extensions.ts
 *
 * Verifies the content-based binary detection function correctly identifies
 * binary buffers (null bytes, high non-printable ratio) and passes clean text.
 */

import { describe, it, expect } from 'vitest';
import { detectBinaryContent, isBinaryExtension } from '../binary-file-extensions';

describe('isBinaryExtension', () => {
  it('should not treat .app file paths as binary by extension', () => {
    expect(isBinaryExtension('foo.app')).toBe(false);
  });
});

describe('detectBinaryContent', () => {
  it('should return true for buffer with null bytes', () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    expect(detectBinaryContent(buf)).toBe(true);
  });

  it('should return true for buffer with null byte at the start', () => {
    const buf = Buffer.from([0x00, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(detectBinaryContent(buf)).toBe(true);
  });

  it('should return true for buffer with >30% non-printable bytes', () => {
    // Create a 100-byte buffer where 40 bytes are non-printable (bytes 1-8, not tab/newline/CR)
    const bytes: number[] = [];
    // 60 printable ASCII characters
    for (let i = 0; i < 60; i++) {
      bytes.push(0x41); // 'A'
    }
    // 40 non-printable bytes (byte value 1, which is not tab/newline/CR/printable/UTF-8)
    for (let i = 0; i < 40; i++) {
      bytes.push(0x01);
    }
    const buf = Buffer.from(bytes);
    expect(detectBinaryContent(buf)).toBe(true);
  });

  it('should return false for clean ASCII text buffer', () => {
    const text = 'Hello, world!\nThis is a test file.\nWith multiple lines.\n';
    const buf = Buffer.from(text, 'ascii');
    expect(detectBinaryContent(buf)).toBe(false);
  });

  it('should return false for clean UTF-8 text buffer with multibyte chars', () => {
    const text = 'Héllo wörld! こんにちは 🌍\nMultibyte UTF-8 content here.\n';
    const buf = Buffer.from(text, 'utf-8');
    expect(detectBinaryContent(buf)).toBe(false);
  });

  it('should return false for empty buffer', () => {
    const buf = Buffer.alloc(0);
    expect(detectBinaryContent(buf)).toBe(false);
  });

  it('should return false for buffer with tabs and newlines', () => {
    const text = 'line1\tvalue1\nline2\tvalue2\r\nline3\tvalue3\n';
    const buf = Buffer.from(text, 'ascii');
    expect(detectBinaryContent(buf)).toBe(false);
  });

  it('should respect sampleSize parameter', () => {
    // Create buffer: 10 clean bytes followed by a null byte
    const bytes = [0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x00];
    const buf = Buffer.from(bytes);
    // With sampleSize=10, the null byte at index 10 should not be checked
    expect(detectBinaryContent(buf, 10)).toBe(false);
    // With default sampleSize (8192), the null byte should be detected
    expect(detectBinaryContent(buf)).toBe(true);
  });

  it('should return false for buffer at exactly 30% non-printable threshold', () => {
    // 70 printable + 30 non-printable = exactly 30%, which should NOT trigger (> 0.3 required)
    const bytes: number[] = [];
    for (let i = 0; i < 70; i++) {
      bytes.push(0x41); // 'A'
    }
    for (let i = 0; i < 30; i++) {
      bytes.push(0x01); // non-printable
    }
    const buf = Buffer.from(bytes);
    expect(detectBinaryContent(buf)).toBe(false);
  });

  it('should return true for buffer just above 30% non-printable threshold', () => {
    // 69 printable + 31 non-printable = 31%, which should trigger (> 0.3)
    const bytes: number[] = [];
    for (let i = 0; i < 69; i++) {
      bytes.push(0x41); // 'A'
    }
    for (let i = 0; i < 31; i++) {
      bytes.push(0x01); // non-printable
    }
    const buf = Buffer.from(bytes);
    expect(detectBinaryContent(buf)).toBe(true);
  });
});

