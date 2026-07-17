import { describe, expect, it } from 'bun:test';
import { Deferred, Effect, Fiber } from 'effect';
import { ControlledClient, lifecycleHit } from './imap-client.fixture';
import { makeClientPool } from './imap-client-pool';

const account = 'me@example.com';

const candidate = <Error>(
  client: ControlledClient,
  activate: Effect.Effect<void, Error>,
) => Effect.succeed({ client, activate });

describe('makeClientPool optimistic ownership', () => {
  it('admits one concurrent candidate and retires every loser', async () => {
    const first = new ControlledClient([lifecycleHit]);
    const second = new ControlledClient([lifecycleHit]);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const activation = (started: Deferred.Deferred<void>) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
      const firstFiber = yield* Effect.fork(
        pool.clientFor(account, candidate(first, activation(firstStarted))),
      );
      const secondFiber = yield* Effect.fork(
        pool.clientFor(account, candidate(second, activation(secondStarted))),
      );
      yield* Deferred.await(firstStarted);
      yield* Deferred.await(secondStarted);
      yield* Deferred.succeed(release, undefined);
      const firstResult = yield* Fiber.join(firstFiber);
      const secondResult = yield* Fiber.join(secondFiber);
      const closesBeforeShutdown = first.closeCalls + second.closeCalls;
      yield* pool.closeAll;
      return { firstResult, secondResult, closesBeforeShutdown };
    });

    const result = await Effect.runPromise(program);
    expect(result.firstResult).toBe(result.secondResult);
    expect(result.closesBeforeShutdown).toBe(1);
    expect(first.closeCalls).toBe(1);
    expect(second.closeCalls).toBe(1);
  });

  it('lets a healthy same-account opener bypass and replace a stalled owner', async () => {
    const stalled = new ControlledClient(undefined);
    const healthy = new ControlledClient([lifecycleHit]);
    let waiterCandidates = 0;
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const stalledStarted = yield* Deferred.make<void>();
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
      yield* Deferred.await(stalledStarted);
      const admitted = yield* pool.clientFor(
        account,
        candidate(healthy, Effect.void),
      );
      const waiter = yield* pool.clientFor(
        account,
        Effect.sync(() => {
          waiterCandidates += 1;
          return {
            client: new ControlledClient([lifecycleHit]),
            activate: Effect.void,
          };
        }),
      );
      yield* Fiber.interrupt(stalledFiber);
      yield* pool.closeAll;
      return { admitted, waiter };
    });

    const result = await Effect.runPromise(program);
    expect(result.admitted).toBe(healthy);
    expect(result.waiter).toBe(healthy);
    expect(waiterCandidates).toBe(0);
    expect(stalled).toMatchObject({
      usable: false,
      outstanding: 0,
      closeCalls: 1,
    });
    expect(healthy.closeCalls).toBe(1);
  });
});

describe('makeClientPool account concurrency', () => {
  it('opens different accounts concurrently', async () => {
    const first = new ControlledClient([lifecycleHit]);
    const second = new ControlledClient([lifecycleHit]);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const activation = (started: Deferred.Deferred<void>) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
      const firstFiber = yield* Effect.fork(
        pool.clientFor(
          'first@example.com',
          candidate(first, activation(firstStarted)),
        ),
      );
      const secondFiber = yield* Effect.fork(
        pool.clientFor(
          'second@example.com',
          candidate(second, activation(secondStarted)),
        ),
      );
      yield* Deferred.await(firstStarted);
      yield* Deferred.await(secondStarted);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(firstFiber);
      yield* Fiber.join(secondFiber);
      yield* pool.closeAll;
    });

    await Effect.runPromise(program);
    expect(first.closeCalls).toBe(1);
    expect(second.closeCalls).toBe(1);
  });
});
