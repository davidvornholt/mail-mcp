import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, TestClock, TestContext } from 'effect';
import { ImapError } from '../errors/errors';
import { searchAllAccounts } from './account-search';
import { mailboxHit, searchOptions } from './account-search.fixture';
import { makeClientPool, withClientSearchDeadline } from './imap-client';
import type { MailboxSearchHit } from './imap-search';

class ControlledClient {
  usable = true;
  outstanding = 0;
  closeCalls = 0;
  readonly result: ReadonlyArray<MailboxSearchHit> | undefined;
  readonly #waiters = new Set<
    (effect: Effect.Effect<ReadonlyArray<MailboxSearchHit>, ImapError>) => void
  >();

  constructor(result: ReadonlyArray<MailboxSearchHit> | undefined) {
    this.result = result;
  }

  search = (): Effect.Effect<ReadonlyArray<MailboxSearchHit>, ImapError> => {
    if (this.result !== undefined) {
      return Effect.succeed(this.result);
    }
    return Effect.uninterruptible(
      Effect.async((resume) => {
        this.outstanding += 1;
        this.#waiters.add(resume);
      }),
    );
  };

  close = (): void => {
    this.closeCalls += 1;
    this.usable = false;
    for (const resume of this.#waiters) {
      resume(Effect.fail(new ImapError({ message: 'retired stalled client' })));
    }
    this.#waiters.clear();
    this.outstanding = 0;
  };

  logout = (): Promise<void> => {
    this.close();
    return Promise.resolve();
  };
}

const healthyHit = mailboxHit(
  1,
  '<healthy@example.com>',
  '2026-07-16T08:00:00Z',
);

describe('searchAllAccounts timeout retirement', () => {
  it('retires repeated stalled clients before returning and uses a replacement for the next operation', async () => {
    const opened: Array<ControlledClient> = [];
    let stalledOpenings = 0;
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const open = (account: string) =>
        Effect.sync(() => {
          const client = new ControlledClient(
            account === 'healthy@example.com' || stalledOpenings >= 2
              ? [healthyHit]
              : undefined,
          );
          if (account === 'stalled@example.com') {
            stalledOpenings += 1;
          }
          opened.push(client);
          return client;
        });
      const boundedSearch = (account: string) =>
        withClientSearchDeadline(
          account,
          pool.clientFor(account, open(account)),
          (client) => client.search(),
          (client) => pool.retire(account, client),
        );

      const results = yield* Effect.forEach([0, 1], () =>
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            searchAllAccounts(
              ['healthy@example.com', 'stalled@example.com'],
              searchOptions,
              boundedSearch,
            ),
          );
          yield* TestClock.adjust('30 seconds');
          return yield* Fiber.join(fiber);
        }),
      );
      const replacement = yield* pool.clientFor(
        'stalled@example.com',
        open('stalled@example.com'),
      );
      const laterHits = yield* replacement.search();
      return { results, laterHits, replacement };
    });

    const { results, laterHits, replacement } = await Effect.runPromise(
      program.pipe(Effect.provide(TestContext.TestContext)),
    );
    const [, firstStalled, secondStalled] = opened;
    expect(
      results.every(
        (result) =>
          result.hits[0]?.account === 'healthy@example.com' &&
          result.failures[0]?.errorTag === 'AccountSearchTimeoutError',
      ),
    ).toBeTrue();
    for (const stalled of [firstStalled, secondStalled]) {
      expect(stalled).toMatchObject({
        usable: false,
        outstanding: 0,
        closeCalls: 1,
      });
      expect(replacement).not.toBe(stalled);
    }
    expect(laterHits).toEqual([healthyHit]);
  });
});

describe('searchAllAccounts all-stalled lifecycle', () => {
  it('retires every stalled client when all accounts time out', async () => {
    const opened: Array<ControlledClient> = [];
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const boundedSearch = (account: string) =>
        withClientSearchDeadline(
          account,
          pool.clientFor(
            account,
            Effect.sync(() => {
              const client = new ControlledClient(undefined);
              opened.push(client);
              return client;
            }),
          ),
          (client) => client.search(),
          (client) => pool.retire(account, client),
        );
      const fiber = yield* Effect.fork(
        Effect.flip(
          searchAllAccounts(
            ['first@example.com', 'second@example.com'],
            searchOptions,
            boundedSearch,
          ),
        ),
      );
      yield* TestClock.adjust('30 seconds');
      return yield* Fiber.join(fiber);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result).toMatchObject({ _tag: 'SearchAccountsError' });
    expect(result.message).toContain('first@example.com');
    expect(result.message).toContain('second@example.com');
    expect(opened).toHaveLength(2);
    expect(
      opened.every(
        (client) =>
          !client.usable && client.outstanding === 0 && client.closeCalls === 1,
      ),
    ).toBeTrue();
  });
});
