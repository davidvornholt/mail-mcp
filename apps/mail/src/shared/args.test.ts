import { describe, expect, it } from 'bun:test';
import { parseFlags } from './args';

describe('parseFlags', () => {
  it('parses --key value pairs', () => {
    const flags = parseFlags(['--to', 'a@b.com', '--subject', 'Hi there']);
    expect(flags.get('to')).toBe('a@b.com');
    expect(flags.get('subject')).toBe('Hi there');
  });

  it('treats a trailing flag as an empty string', () => {
    expect(parseFlags(['--cc']).get('cc')).toBe('');
  });

  it('ignores non-flag tokens', () => {
    expect(parseFlags(['positional', '--to', 'x']).get('to')).toBe('x');
  });
});
