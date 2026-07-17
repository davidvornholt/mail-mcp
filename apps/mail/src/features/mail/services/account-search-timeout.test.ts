import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, TestClock, TestContext } from 'effect';
import { searchAllAccounts } from './account-search';
import { mailboxHit, searchOptions } from './account-search.fixture';

describe('searchAllAccounts timeout', () => {
  it('returns healthy hits and a structured failure when one account stalls past the deadline', async () => {
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        searchAllAccounts(
          ['healthy@example.com', 'stalled@example.com'],
          searchOptions,
          (account) =>
            account === 'stalled@example.com'
              ? Effect.never
              : Effect.succeed([
                  mailboxHit(
                    1,
                    '<healthy@example.com>',
                    '2026-07-16T08:00:00Z',
                  ),
                ]),
        ),
      );
      yield* TestClock.adjust('30 seconds');
      return yield* Fiber.join(fiber);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(result.hits.map(({ account }) => account)).toEqual([
      'healthy@example.com',
    ]);
    expect(result.failures).toMatchObject([
      {
        account: 'stalled@example.com',
        errorTag: 'AccountSearchTimeoutError',
      },
    ]);
    expect(result.failures[0]?.message).toContain('30 seconds');
  });

  it('fails with the timeout error when every account stalls', async () => {
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.flip(
          searchAllAccounts(
            ['first@example.com', 'second@example.com'],
            searchOptions,
            () => Effect.never,
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
  });
});
