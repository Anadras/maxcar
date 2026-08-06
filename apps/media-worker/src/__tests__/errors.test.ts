import { describe, expect, it } from 'vitest';
import { sanitizeError } from '../errors.js';

describe('sanitizeError', () => {
  it('keeps only the first line of an Error message', () => {
    const err = new Error(
      'ffmpeg exited with code 1\n  at somewhere (file.js:1:1)\n  more stack',
    );
    expect(sanitizeError(err)).toBe('ffmpeg exited with code 1');
  });

  it('redacts filesystem paths', () => {
    const err = new Error(
      'ENOENT: /Users/someone/tmp/maxcar-media-abc123/original.mp4 not found',
    );
    expect(sanitizeError(err)).toBe('ENOENT: <path> not found');
  });

  it('truncates an overly long message', () => {
    const err = new Error('x'.repeat(1000));
    const result = sanitizeError(err);
    expect(result.length).toBeLessThanOrEqual(501);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles a non-Error thrown value', () => {
    expect(sanitizeError('plain string failure')).toBe('plain string failure');
  });
});
