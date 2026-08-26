import { describe, expect, it } from 'vitest';
import { extractHandleFromPath } from './handle';

describe('extractHandleFromPath', () => {
  it.each([
    ['/kim/status/123', 'kim'],
    ['/Kim/status/123?s=20#m', 'kim'],
    ['https://x.com/kim/status/123', 'kim'],
    ['https://twitter.com/kim', 'kim'],
  ])('extracts handle from %s', (input, expected) => {
    expect(extractHandleFromPath(input)).toBe(expected);
  });

  it.each([
    ['/home'],
    ['/i/flow/login'],
    ['/search?q=spam'],
    ['/hashtag/foo'],
    ['/'],
    [''],
    ['not a url'],
    ['https://evil.example.com/kim/status/1'],
  ])('rejects non-account input %s', (input) => {
    expect(extractHandleFromPath(input)).toBeNull();
  });
});
