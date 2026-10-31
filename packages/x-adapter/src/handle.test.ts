// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { contextFromPath, extractHandleFromPath, profileFromPath } from './handle';

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

describe('contextFromPath', () => {
  it.each([
    ['/home', 'timeline'],
    ['/search?q=x', 'search'],
    ['/kim/status/123', 'reply'],
    ['/notifications', 'other'],
    ['/kim/following', 'profile'],
    ['/i/flow/login', 'other'],
  ] as const)('%s -> %s', (path, expected) => {
    expect(contextFromPath(path)).toBe(expected);
  });
});

describe('profileFromPath', () => {
  it.each([
    ['/Kim', { handle: 'kim', tab: 'posts' }],
    ['/kim/with_replies', { handle: 'kim', tab: 'replies' }],
    ['/kim/reposts', { handle: 'kim', tab: 'reposts' }],
    ['/kim/media?x=1', { handle: 'kim', tab: 'media' }],
    ['/kim/highlights', { handle: 'kim', tab: 'highlights' }],
    ['/kim/following', { handle: 'kim', tab: 'other' }],
    ['/kim/status/123', null],
    ['/home', null],
    ['/search', null],
    ['/i/bookmarks', null],
    ['/a-very-long-handle-name', null],
  ] as const)('%s', (path, expected) => {
    expect(profileFromPath(path)).toEqual(expected);
  });
});
