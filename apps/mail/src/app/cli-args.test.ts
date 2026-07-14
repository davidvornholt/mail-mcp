import { describe, expect, it } from 'bun:test';
import { parseMessageHandle, parseSearchArgs } from './cli-args';

describe('parseSearchArgs', () => {
  it('keeps positional terms and parses folder scope flags', () => {
    expect(
      parseSearchArgs([
        'quarterly',
        '--scope',
        'subtree',
        '--folder',
        'Projects',
        'invoice',
      ]),
    ).toEqual({
      _tag: 'valid',
      input: {
        scope: 'subtree',
        folder: 'Projects',
        query: 'quarterly invoice',
      },
    });
  });

  it('rejects unsupported scopes', () => {
    expect(parseSearchArgs(['--scope', 'recursive'])._tag).toBe('invalid');
  });

  it('rejects unknown flags', () => {
    expect(parseSearchArgs(['--recursive'])._tag).toBe('invalid');
  });
});

describe('parseMessageHandle', () => {
  it('parses a complete positive message handle', () => {
    const flags = new Map([
      ['reply-folder', 'INBOX'],
      ['reply-uid', '42'],
    ]);

    expect(parseMessageHandle(flags, 'reply')).toEqual({
      _tag: 'valid',
      handle: { folder: 'INBOX', uid: 42 },
    });
  });

  it('rejects incomplete and invalid handles', () => {
    expect(
      parseMessageHandle(new Map([['reply-folder', 'INBOX']]), 'reply')._tag,
    ).toBe('invalid');
    expect(
      parseMessageHandle(
        new Map([
          ['reply-folder', 'INBOX'],
          ['reply-uid', '0'],
        ]),
        'reply',
      )._tag,
    ).toBe('invalid');
  });
});
