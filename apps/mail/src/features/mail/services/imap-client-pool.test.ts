import { describe, expect, it } from 'bun:test';
import { Deferred, Effect, Fiber } from 'effect';
import { ImapError } from '../errors/errors';
import { makeClientPool, retireClient } from './imap-client';
import { ControlledClient, lifecycleHit } from './imap-client.fixture';

const account = 'me@example.com';

describe('makeClientPool same-account ownership', () => {
  it('single-flights concurrent misses and closes the one admitted client', async () => {
    let opens = 0;
    const client = new ControlledClient([lifecycleHit]);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const open = Effect.gen(function* () {
        opens += 1;
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return client;
      });
      const firstFiber = yield* Effect.fork(pool.clientFor(account, open));
      yield* Deferred.await(started);
      const secondFiber = yield* Effect.fork(pool.clientFor(account, open));
      yield* Effect.yieldNow();
      const opensBeforeRelease = opens;
      yield* Deferred.succeed(release, undefined);
      const first = yield* Fiber.join(firstFiber);
      const second = yield* Fiber.join(secondFiber);
      yield* pool.closeAll;
      return { first, second, opensBeforeRelease };
    });

    const result = await Effect.runPromise(program);
    expect(result.opensBeforeRelease).toBe(1);
    expect(result.first).toBe(client);
    expect(result.second).toBe(client);
    expect(client.closeCalls).toBe(1);
  });

  it('lets a waiting caller replace a failed opener', async () => {
    const replacement = new ControlledClient([lifecycleHit]);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const firstFiber = yield* Effect.fork(
        Effect.flip(
          pool.clientFor(
            account,
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return yield* Effect.fail(
                new ImapError({ message: 'connect failed' }),
              );
            }),
          ),
        ),
      );
      yield* Deferred.await(started);
      const secondFiber = yield* Effect.fork(
        pool.clientFor(account, Effect.succeed(replacement)),
      );
      yield* Deferred.succeed(release, undefined);
      const firstError = yield* Fiber.join(firstFiber);
      const second = yield* Fiber.join(secondFiber);
      yield* pool.closeAll;
      return { firstError, second };
    });

    const result = await Effect.runPromise(program);
    expect(result.firstError).toMatchObject({
      _tag: 'ImapError',
      message: 'connect failed',
    });
    expect(result.second).toBe(replacement);
    expect(replacement.closeCalls).toBe(1);
  });
});

describe('makeClientPool replacement ownership', () => {
  it('retires an unusable client once while its replacement opens', async () => {
    const initial = new ControlledClient([lifecycleHit]);
    const replacement = new ControlledClient([lifecycleHit]);
    let replacementOpens = 0;
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      yield* pool.clientFor(account, Effect.succeed(initial));
      initial.usable = false;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const opening = yield* Effect.fork(
        pool.clientFor(
          account,
          Effect.gen(function* () {
            replacementOpens += 1;
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return replacement;
          }),
        ),
      );
      yield* Deferred.await(started);
      yield* retireClient(initial);
      yield* Deferred.succeed(release, undefined);
      const opened = yield* Fiber.join(opening);
      const reused = yield* pool.clientFor(
        account,
        Effect.sync(() => {
          replacementOpens += 1;
          return new ControlledClient([lifecycleHit]);
        }),
      );
      yield* pool.closeAll;
      return { opened, reused };
    });

    const result = await Effect.runPromise(program);
    expect(initial.closeCalls).toBe(1);
    expect(result.opened).toBe(replacement);
    expect(result.reused).toBe(replacement);
    expect(replacementOpens).toBe(1);
    expect(replacement.closeCalls).toBe(1);
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
      const open = (
        client: ControlledClient,
        started: Deferred.Deferred<void>,
      ) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return client;
        });
      const firstFiber = yield* Effect.fork(
        pool.clientFor('first@example.com', open(first, firstStarted)),
      );
      const secondFiber = yield* Effect.fork(
        pool.clientFor('second@example.com', open(second, secondStarted)),
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
