import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  ImapError,
  type MailError,
  MissingPasswordError,
} from '../errors/errors';
import type { SearchOptions } from '../schemas/mail';
import { searchAllAccounts, searchOneAccount } from './account-search';
import type { MailboxSearchHit } from './imap-search';

const options: SearchOptions = {
  scope: 'all',
  query: 'invoice',
  limit: 2,
};
const duplicateNewerUid = 3;
const newestUid = 4;

const hit = (
  uid: number,
  messageId: string,
  receivedAt: string,
): MailboxSearchHit => ({
  hit: {
    uid,
    folder: 'INBOX',
    from: 'sender@example.com',
    to: 'me@example.com',
    subject: messageId,
    date: receivedAt,
  },
  mailboxDeduplicationId: messageId,
  messageId,
  receivedAt,
});

describe('searchAllAccounts', () => {
  it('merges, deduplicates, sorts, limits, and reports account failures', async () => {
    const searchMailbox = (
      account: string,
    ): Effect.Effect<ReadonlyArray<MailboxSearchHit>, MailError> => {
      switch (account) {
        case 'first@example.com':
          return Effect.succeed([
            {
              ...hit(1, '<duplicate@example.com>', '2026-07-14T08:00:00Z'),
              mailboxDeduplicationId: 'server-one-id',
            },
            hit(2, '<older@example.com>', '2026-07-13T08:00:00Z'),
          ]);
        case 'second@example.com':
          return Effect.succeed([
            {
              ...hit(
                duplicateNewerUid,
                '<duplicate@example.com>',
                '2026-07-15T08:00:00Z',
              ),
              mailboxDeduplicationId: 'server-two-id',
            },
            hit(newestUid, '<newest@example.com>', '2026-07-16T08:00:00Z'),
          ]);
        default:
          return Effect.fail(
            new MissingPasswordError({
              account,
              message: `No stored password for ${account}`,
            }),
          );
      }
    };

    const result = await Effect.runPromise(
      searchAllAccounts(
        ['first@example.com', 'second@example.com', 'unavailable@example.com'],
        options,
        searchMailbox,
      ),
    );

    expect(
      result.hits.map(({ account, subject }) => ({ account, subject })),
    ).toEqual([
      {
        account: 'second@example.com',
        subject: '<newest@example.com>',
      },
      {
        account: 'second@example.com',
        subject: '<duplicate@example.com>',
      },
    ]);
    expect(result.failures).toEqual([
      {
        account: 'unavailable@example.com',
        errorTag: 'MissingPasswordError',
        message: 'No stored password for unavailable@example.com',
      },
    ]);
  });

  it('fails with every account error when no account can be searched', async () => {
    const result = await Effect.runPromise(
      Effect.flip(
        searchAllAccounts(
          ['first@example.com', 'second@example.com'],
          options,
          (account) =>
            Effect.fail(
              new MissingPasswordError({
                account,
                message: `No stored password for ${account}`,
              }),
            ),
        ),
      ),
    );

    expect(result).toMatchObject({ _tag: 'SearchAccountsError' });
    expect(result.message).toContain(
      'first@example.com: No stored password for first@example.com',
    );
    expect(result.message).toContain(
      'second@example.com: No stored password for second@example.com',
    );
  });
});

describe('searchOneAccount', () => {
  it('adds the account handle and preserves explicit-account failures', async () => {
    const successful = await Effect.runPromise(
      searchOneAccount('me@example.com', options, () =>
        Effect.succeed([
          hit(1, '<message@example.com>', '2026-07-16T08:00:00Z'),
        ]),
      ),
    );

    expect(successful).toMatchObject({
      hits: [{ account: 'me@example.com', uid: 1 }],
      failures: [],
    });

    const failed = await Effect.runPromise(
      Effect.flip(
        searchOneAccount('me@example.com', options, () =>
          Effect.fail(new ImapError({ message: 'authentication failed' })),
        ),
      ),
    );
    expect(failed).toMatchObject({
      _tag: 'ImapError',
      message: 'authentication failed',
    });
  });
});
