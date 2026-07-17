import { describe, expect, it } from 'bun:test';
import { Deferred, Effect, Fiber, Option } from 'effect';
import { ControlledClient, lifecycleHit } from './imap-client.fixture';
import { makeClientPool } from './imap-client-pool';

const account = 'me@example.com';

class StalledLogoutClient extends ControlledClient {
  logoutStarted = false;

  override logout = (): Promise<void> => {
    this.logoutStarted = true;
    return new Promise(() => undefined);
  };
}

const stalledCandidate = (
  client: ControlledClient,
  started: Deferred.Deferred<void>,
) =>
  Effect.succeed({
    client,
    activate: Deferred.succeed(started, undefined).pipe(
      Effect.andThen(client.search()),
      Effect.asVoid,
    ),
  });

describe('makeClientPool terminal shutdown', () => {
  it('retires an in-progress candidate and rejects post-close requests without constructing', async () => {
    const opening = new ControlledClient(undefined);
    let postCloseCandidates = 0;
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const started = yield* Deferred.make<void>();
      const openingFiber = yield* Effect.fork(
        pool.clientFor(account, stalledCandidate(opening, started)),
      );
      yield* Deferred.await(started);
      yield* Effect.all([pool.closeAll, pool.closeAll], {
        concurrency: 'unbounded',
        discard: true,
      });
      const openingExit = yield* Fiber.await(openingFiber);
      const postCloseError = yield* Effect.flip(
        pool.clientFor(
          account,
          Effect.sync(() => {
            postCloseCandidates += 1;
            return {
              client: new ControlledClient([lifecycleHit]),
              activate: Effect.void,
            };
          }),
        ),
      );
      return { openingExit, postCloseError };
    });

    const result = await Effect.runPromise(program);
    expect(result.openingExit._tag).toBe('Failure');
    expect(result.postCloseError).toMatchObject({
      _tag: 'ClientPoolClosedError',
      message: 'IMAP client pool is closed.',
    });
    expect(postCloseCandidates).toBe(0);
    expect(opening.closeCalls).toBe(1);
  });

  it('closes both an unusable client and its in-progress replacement', async () => {
    const initial = new ControlledClient([lifecycleHit]);
    const replacement = new ControlledClient(undefined);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      yield* pool.clientFor(
        account,
        Effect.succeed({ client: initial, activate: Effect.void }),
      );
      initial.usable = false;
      const started = yield* Deferred.make<void>();
      const replacementFiber = yield* Effect.fork(
        pool.clientFor(account, stalledCandidate(replacement, started)),
      );
      yield* Deferred.await(started);
      yield* pool.closeAll;
      return yield* Fiber.await(replacementFiber);
    });

    const replacementExit = await Effect.runPromise(program);
    expect(replacementExit._tag).toBe('Failure');
    expect(initial.closeCalls).toBe(1);
    expect(replacement.closeCalls).toBe(1);
  });

  it('retires every snapshot without waiting for a stalled logout', async () => {
    const first = new StalledLogoutClient([lifecycleHit]);
    const second = new ControlledClient([lifecycleHit]);
    const opening = new ControlledClient(undefined);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      yield* pool.clientFor(
        'first@example.com',
        Effect.succeed({ client: first, activate: Effect.void }),
      );
      yield* pool.clientFor(
        'second@example.com',
        Effect.succeed({ client: second, activate: Effect.void }),
      );
      const started = yield* Deferred.make<void>();
      const openingFiber = yield* Effect.fork(
        pool.clientFor('third@example.com', stalledCandidate(opening, started)),
      );
      yield* Deferred.await(started);
      const closeFiber = yield* Effect.fork(pool.closeAll);
      const closeResult = yield* Fiber.join(closeFiber).pipe(
        Effect.timeoutOption('50 millis'),
      );
      const closeCalls = [
        first.closeCalls,
        second.closeCalls,
        opening.closeCalls,
      ];
      yield* Fiber.interrupt(closeFiber);
      yield* Fiber.interrupt(openingFiber);
      return { closeCalls, closeResult };
    });

    const result = await Effect.runPromise(program);
    expect(result.closeCalls).toEqual([1, 1, 1]);
    expect(Option.isSome(result.closeResult)).toBe(true);
  });
});
