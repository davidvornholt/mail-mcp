import { describe, expect, it } from 'bun:test';
import { Deferred, Effect, Fiber, Option } from 'effect';
import { ImapError } from '../errors/errors';
import { ControlledClient, lifecycleHit } from './imap-client.fixture';
import { makeClientPool } from './imap-client-pool';

const account = 'me@example.com';

const candidate = <Error>(
  client: ControlledClient,
  activate: Effect.Effect<void, Error>,
) => Effect.succeed({ client, activate });

describe('makeClientPool same-account convergence', () => {
  it('reuses an admitted winner when a registered peer later fails', async () => {
    const winner = new ControlledClient([lifecycleHit]);
    const loser = new ControlledClient([lifecycleHit]);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const winnerStarted = yield* Deferred.make<void>();
      const loserStarted = yield* Deferred.make<void>();
      const releaseWinner = yield* Deferred.make<void>();
      const failLoser = yield* Deferred.make<never, ImapError>();
      const winnerFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            winner,
            Deferred.succeed(winnerStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseWinner)),
            ),
          ),
        ),
      );
      const loserFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            loser,
            Deferred.succeed(loserStarted, undefined).pipe(
              Effect.andThen(Deferred.await(failLoser)),
            ),
          ),
        ),
      );
      yield* Deferred.await(winnerStarted);
      yield* Deferred.await(loserStarted);
      yield* Deferred.succeed(releaseWinner, undefined);
      const winnerResult = yield* Fiber.join(winnerFiber);
      yield* Deferred.fail(
        failLoser,
        new ImapError({ message: 'redundant activation failed' }),
      );
      const loserResult = yield* Fiber.join(loserFiber);
      yield* pool.closeAll;
      return { winnerResult, loserResult };
    });

    const result = await Effect.runPromise(program);
    expect(result.winnerResult).toBe(winner);
    expect(result.loserResult).toBe(winner);
    expect(loser.closeCalls).toBe(1);
    expect(winner.closeCalls).toBe(1);
  });

  it('settles a stalled peer as soon as another candidate wins', async () => {
    const winner = new ControlledClient([lifecycleHit]);
    const stalled = new ControlledClient(undefined);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const winnerStarted = yield* Deferred.make<void>();
      const stalledStarted = yield* Deferred.make<void>();
      const releaseWinner = yield* Deferred.make<void>();
      const winnerFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            winner,
            Deferred.succeed(winnerStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseWinner)),
            ),
          ),
        ),
      );
      const stalledFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            stalled,
            Deferred.succeed(stalledStarted, undefined).pipe(
              Effect.andThen(stalled.search()),
              Effect.asVoid,
            ),
          ),
        ),
      );
      yield* Deferred.await(winnerStarted);
      yield* Deferred.await(stalledStarted);
      yield* Deferred.succeed(releaseWinner, undefined);
      yield* Fiber.join(winnerFiber);
      const settled = yield* Fiber.join(stalledFiber).pipe(
        Effect.timeoutOption('50 millis'),
      );
      yield* Fiber.interrupt(stalledFiber);
      yield* pool.closeAll;
      return settled;
    });

    const settled = await Effect.runPromise(program);
    expect(Option.getOrUndefined(settled)).toBe(winner);
    expect(stalled.closeCalls).toBe(1);
    expect(winner.closeCalls).toBe(1);
  });
});

describe('makeClientPool activation failures', () => {
  it('preserves a failure that settles before a peer wins', async () => {
    const failed = new ControlledClient([lifecycleHit]);
    const winner = new ControlledClient([lifecycleHit]);
    const expected = new ImapError({ message: 'activation failed first' });
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const failedStarted = yield* Deferred.make<void>();
      const winnerStarted = yield* Deferred.make<void>();
      const fail = yield* Deferred.make<never, ImapError>();
      const releaseWinner = yield* Deferred.make<void>();
      const failedFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            failed,
            Deferred.succeed(failedStarted, undefined).pipe(
              Effect.andThen(Deferred.await(fail)),
            ),
          ),
        ),
      );
      const winnerFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            winner,
            Deferred.succeed(winnerStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseWinner)),
            ),
          ),
        ),
      );
      yield* Deferred.await(failedStarted);
      yield* Deferred.await(winnerStarted);
      yield* Deferred.fail(fail, expected);
      const error = yield* Effect.flip(Fiber.join(failedFiber));
      yield* Deferred.succeed(releaseWinner, undefined);
      const result = yield* Fiber.join(winnerFiber);
      yield* pool.closeAll;
      return { error, result };
    });

    const result = await Effect.runPromise(program);
    expect(result.error).toBe(expected);
    expect(result.result).toBe(winner);
    expect(failed.closeCalls).toBe(1);
    expect(winner.closeCalls).toBe(1);
  });

  it('preserves an activation error when no winner exists yet', async () => {
    const client = new ControlledClient([lifecycleHit]);
    const expected = new ImapError({ message: 'only activation failed' });
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const error = yield* Effect.flip(
        pool.clientFor(account, candidate(client, Effect.fail(expected))),
      );
      yield* pool.closeAll;
      return error;
    });

    const error = await Effect.runPromise(program);
    expect(error).toBe(expected);
    expect(client.closeCalls).toBe(1);
  });
});
