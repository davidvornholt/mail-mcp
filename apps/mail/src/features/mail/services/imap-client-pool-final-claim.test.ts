import { describe, expect, it } from 'bun:test';
import { Deferred, Effect, Fiber } from 'effect';
import { makeClientPool } from './imap-client-pool';
import {
  TransitionClient,
  transitionCandidate,
} from './imap-client-pool.fixture';

const account = 'me@example.com';
const finalClaimRead = 4;

const invalidateAtFinalClaim = (
  client: TransitionClient,
  invalidated: Deferred.Deferred<void>,
): void => {
  client.onUsableRead = (read) => {
    if (read === finalClaimRead) {
      client.usable = false;
      Effect.runSync(Deferred.succeed(invalidated, undefined));
    }
  };
};

describe('makeClientPool final winner claim', () => {
  it('continues peer activation when an observed winner fails final validation', async () => {
    const stale = new TransitionClient();
    const viable = new TransitionClient();
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<TransitionClient>();
      const viableStarted = yield* Deferred.make<void>();
      const releaseViable = yield* Deferred.make<void>();
      const invalidated = yield* Deferred.make<void>();
      invalidateAtFinalClaim(stale, invalidated);
      const viableFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          transitionCandidate(
            viable,
            Deferred.succeed(viableStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseViable)),
            ),
          ),
        ),
      );
      yield* Deferred.await(viableStarted);
      const staleResult = yield* pool.clientFor(
        account,
        transitionCandidate(stale, Effect.void),
      );
      yield* Deferred.await(invalidated);
      const closesBeforeRelease = viable.closeCalls;
      yield* Deferred.succeed(releaseViable, undefined);
      const viableResult = yield* Fiber.join(viableFiber);
      yield* pool.closeAll;
      return { closesBeforeRelease, staleResult, viableResult };
    });

    const result = await Effect.runPromise(program);
    expect(result.staleResult).toBe(stale);
    expect(result.closesBeforeRelease).toBe(0);
    expect(result.viableResult).toBe(viable);
    expect(stale.closeCalls).toBe(1);
    expect(viable.closeCalls).toBe(1);
  });

  it('activates a constructed candidate when registration reuse is stale', async () => {
    const stale = new TransitionClient();
    const viable = new TransitionClient();
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<TransitionClient>();
      const constructionStarted = yield* Deferred.make<void>();
      const releaseConstruction = yield* Deferred.make<void>();
      const invalidated = yield* Deferred.make<void>();
      invalidateAtFinalClaim(stale, invalidated);
      const viableFiber = yield* Effect.fork(
        pool.clientFor(
          account,
          Deferred.succeed(constructionStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseConstruction)),
            Effect.as({ client: viable, activate: Effect.void }),
          ),
        ),
      );
      yield* Deferred.await(constructionStarted);
      const staleResult = yield* pool.clientFor(
        account,
        transitionCandidate(stale, Effect.void),
      );
      yield* Deferred.succeed(releaseConstruction, undefined);
      yield* Deferred.await(invalidated);
      const viableResult = yield* Fiber.join(viableFiber);
      yield* pool.closeAll;
      return { staleResult, viableResult };
    });

    const result = await Effect.runPromise(program);
    expect(result.staleResult).toBe(stale);
    expect(result.viableResult).toBe(viable);
    expect(stale.closeCalls).toBe(1);
    expect(viable.closeCalls).toBe(1);
  });
});

describe('makeClientPool final admission claim', () => {
  it('admits an activated candidate when admission reuse is stale', async () => {
    const stale = new TransitionClient();
    const viable = new TransitionClient();
    let nestedWinner: TransitionClient | undefined;
    const program = Effect.gen(function* () {
      const pool = yield* makeClientPool<TransitionClient>();
      const invalidated = yield* Deferred.make<void>();
      invalidateAtFinalClaim(stale, invalidated);
      const result = yield* pool.clientFor(
        account,
        transitionCandidate(
          viable,
          Effect.sync(() => {
            nestedWinner = Effect.runSync(
              pool.clientFor(account, transitionCandidate(stale, Effect.void)),
            );
          }),
        ),
      );
      yield* Deferred.await(invalidated);
      const viableClosesBeforeShutdown = viable.closeCalls;
      yield* pool.closeAll;
      return { result, viableClosesBeforeShutdown };
    });

    const result = await Effect.runPromise(program);
    expect(nestedWinner).toBe(stale);
    expect(result.result).toBe(viable);
    expect(result.viableClosesBeforeShutdown).toBe(0);
    expect(stale.closeCalls).toBe(1);
    expect(viable.closeCalls).toBe(1);
  });
});
