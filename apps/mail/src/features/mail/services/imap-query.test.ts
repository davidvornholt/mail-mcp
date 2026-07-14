import { describe, expect, it } from 'bun:test';
import { buildSearchQuery } from './imap-query';

describe('buildSearchQuery', () => {
  it('matches everything when no criteria are given', () => {
    expect(
      buildSearchQuery({ scope: 'folder', folder: 'INBOX', limit: 20 }),
    ).toEqual({
      all: true,
    });
  });

  it('maps a general query to a full-text search', () => {
    expect(
      buildSearchQuery({
        scope: 'folder',
        folder: 'INBOX',
        limit: 20,
        query: 'invoice',
      }),
    ).toEqual({ text: 'invoice' });
  });

  it('combines narrow criteria', () => {
    expect(
      buildSearchQuery({
        folder: 'INBOX',
        scope: 'folder',
        limit: 10,
        from: 'a@b.com',
        subject: 'hi',
      }),
    ).toEqual({ from: 'a@b.com', subject: 'hi' });
  });
});
