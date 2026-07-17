import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, TestClock, TestContext } from 'effect';
import { searchWithDedicatedClient } from './imap';
import { ControlledClient, lifecycleHit } from './imap-client.fixture';

describe('searchWithDedicatedClient', () => {
  it('constructs and retires a client distinct from outstanding warm work', async () => {
    const warm = new ControlledClient(undefined);
    const created: Array<ControlledClient> = [];
    const program = Effect.gen(function* () {
      const warmFiber = yield* Effect.fork(warm.search());
      const boundedFiber = yield* Effect.fork(
        Effect.flip(
          searchWithDedicatedClient(
            'stalled@example.com',
            () => {
              const client = new ControlledClient(undefined);
              created.push(client);
              return client;
            },
            (client) => client.search(),
          ),
        ),
      );
      yield* TestClock.adjust('30 seconds');
      const boundedError = yield* Fiber.join(boundedFiber);
      const warmBeforeCompletion = {
        closeCalls: warm.closeCalls,
        outstanding: warm.outstanding,
        usable: warm.usable,
      };
      warm.complete([lifecycleHit]);
      const warmResult = yield* Fiber.join(warmFiber);
      return { boundedError, warmBeforeCompletion, warmResult };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TestContext.TestContext)),
    );
    const [bounded] = created;
    expect(bounded).not.toBe(warm);
    expect(bounded).toMatchObject({
      closeCalls: 1,
      outstanding: 0,
      usable: false,
    });
    expect(result.boundedError).toMatchObject({
      _tag: 'AccountSearchTimeoutError',
    });
    expect(result.warmBeforeCompletion).toEqual({
      closeCalls: 0,
      outstanding: 1,
      usable: true,
    });
    expect(result.warmResult).toEqual([lifecycleHit]);
  });
});
