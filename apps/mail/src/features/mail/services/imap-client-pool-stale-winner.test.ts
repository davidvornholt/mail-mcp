import { describe, expect, it } from 'bun:test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { ControlledClient, lifecycleHit } from './imap-client.fixture';
import { makeClientPool } from './imap-client-pool';
import type { MailboxSearchHit } from './imap-search';

const account = 'me@example.com';
const peerConsumptionRead = 3;
const ignoreUsableRead = (_read: number): void => undefined;

class TransitionClient {
  readonly result: ReadonlyArray<MailboxSearchHit> = [lifecycleHit];
  closeCalls = 0;
  usableReads = 0;
  onUsableRead = ignoreUsableRead;
  #usable = true;

  get usable(): boolean {
    this.usableReads += 1;
    this.onUsableRead(this.usableReads);
    return this.#usable;
  }

  set usable(value: boolean) {
    this.#usable = value;
  }

  close = (): void => {
    this.closeCalls += 1;
    this.#usable = false;
  };

  logout = (): Promise<void> => {
    this.close();
    return Promise.resolve();
  };
}

const candidate = (client: TransitionClient, activate: Effect.Effect<void>) =>
  Effect.succeed({ client, activate });

describe('makeClientPool winner validity', () => {
  it('rejects a candidate that becomes unusable before admission', async () => {
    const client = new ControlledClient([lifecycleHit]);
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<ControlledClient>();
      const result = yield* Effect.exit(
        pool.clientFor(
          account,
          Effect.succeed({
            client,
            activate: Effect.sync(() => {
              client.usable = false;
            }),
          }),
        ),
      );
      yield* pool.closeAll;
      return result;
    });

    const result = await Effect.runPromise(program);
    expect(Exit.isFailure(result)).toBe(true);
    expect(client.closeCalls).toBe(1);
  });

  it('keeps a healthy candidate when a published winner becomes unusable', async () => {
    const stale = new TransitionClient();
    const healthy = new TransitionClient();
    stale.onUsableRead = (read) => {
      if (read === 2) {
        stale.usable = false;
      }
    };
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<TransitionClient>();
      const staleStarted = yield* Deferred.make<void>();
      const healthyStarted = yield* Deferred.make<void>();
      const releaseStale = yield* Deferred.make<void>();
      const releaseHealthy = yield* Deferred.make<void>();
      const healthyFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          candidate(
            healthy,
            Deferred.succeed(healthyStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseHealthy)),
            ),
          ),
        ),
      );
      const staleFiber = yield* Effect.fork(
        Effect.exit(
          pool.clientFor(
            account,
            candidate(
              stale,
              Deferred.succeed(staleStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseStale)),
              ),
            ),
          ),
        ),
      );
      yield* Deferred.await(healthyStarted);
      yield* Deferred.await(staleStarted);
      yield* Deferred.succeed(releaseStale, undefined);
      const staleExit = yield* Fiber.join(staleFiber);
      const healthyClosesBeforeActivation = healthy.closeCalls;
      yield* Deferred.succeed(releaseHealthy, undefined);
      const result = yield* Fiber.join(healthyFiber);
      yield* pool.closeAll;
      return { healthyClosesBeforeActivation, result, staleExit };
    });

    const result = await Effect.runPromise(program);
    expect(Exit.isFailure(result.staleExit)).toBe(true);
    expect(result.healthyClosesBeforeActivation).toBe(0);
    expect(result.result).toBe(healthy);
    expect(stale.closeCalls).toBe(1);
    expect(healthy.closeCalls).toBe(1);
  });
});

describe('makeClientPool terminal winner validity', () => {
  it('fails a peer when shutdown wins before winner consumption', async () => {
    const winner = new TransitionClient();
    const peer = new TransitionClient();
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<TransitionClient>();
      winner.onUsableRead = (read) => {
        if (read === peerConsumptionRead) {
          Effect.runSync(pool.closeAll);
        }
      };
      const winnerStarted = yield* Deferred.make<void>();
      const peerStarted = yield* Deferred.make<void>();
      const releaseWinner = yield* Deferred.make<void>();
      const winnerFiber = yield* Effect.fork(
        Effect.exit(
          pool.clientFor(
            account,
            candidate(
              winner,
              Deferred.succeed(winnerStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseWinner)),
              ),
            ),
          ),
        ),
      );
      const peerFiber = yield* Effect.fork(
        Effect.exit(
          pool.clientFor(
            account,
            candidate(
              peer,
              Deferred.succeed(peerStarted, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
            ),
          ),
        ),
      );
      yield* Deferred.await(winnerStarted);
      yield* Deferred.await(peerStarted);
      yield* Deferred.succeed(releaseWinner, undefined);
      const winnerExit = yield* Fiber.join(winnerFiber);
      const peerExit = yield* Fiber.join(peerFiber);
      return { peerExit, winnerExit };
    });

    const result = await Effect.runPromise(program);
    expect(Exit.isSuccess(result.winnerExit)).toBe(true);
    expect(result.peerExit).toMatchObject({
      _tag: 'Failure',
      cause: {
        _tag: 'Fail',
        error: { _tag: 'ClientPoolClosedError' },
      },
    });
    expect(winner.closeCalls).toBe(1);
    expect(peer.closeCalls).toBe(1);
  });
});
