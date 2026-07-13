import { describe, expect, it } from 'bun:test';
import { parseMessageHandle } from './cli-args';

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
