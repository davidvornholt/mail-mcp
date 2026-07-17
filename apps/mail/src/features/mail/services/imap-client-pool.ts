import { Effect, PubSub, Ref } from 'effect';
import { ClientPoolClosedError, type ImapError } from '../errors/errors';
import { retireClient, type WarmClient } from './imap-client';
import {
  activateAndAdmit,
  type ClientCandidate,
} from './imap-client-pool-lifecycle';
import { closePool, initialClientPoolState } from './imap-client-pool-state';

export const makeClientPool = <Client extends WarmClient>() =>
  Effect.gen(function* () {
    const state = yield* Ref.make(initialClientPoolState<Client>());
    const changes = yield* PubSub.unbounded<void>();
    const closedError = new ClientPoolClosedError({
      message: 'IMAP client pool is closed.',
    });
    const context = { state, changes, closedError };
    const clientFor = <OpenError, ActivationError>(
      email: string,
      makeCandidate: Effect.Effect<
        ClientCandidate<Client, ActivationError>,
        OpenError
      >,
    ): Effect.Effect<
      Client,
      OpenError | ActivationError | ClientPoolClosedError | ImapError
    > =>
      Ref.get(state).pipe(
        Effect.flatMap((snapshot) => {
          if (snapshot.closed) {
            return Effect.fail(closedError);
          }
          const existing = snapshot.clients.get(email);
          if (existing?.usable === true) {
            return Effect.succeed(existing);
          }
          return Effect.uninterruptibleMask((restore) =>
            restore(makeCandidate).pipe(
              Effect.flatMap((candidate) =>
                activateAndAdmit(context, email, candidate, restore),
              ),
            ),
          );
        }),
      );
    const closeAll = Ref.modify(state, closePool).pipe(
      Effect.tap(() => PubSub.publish(changes, undefined)),
      Effect.flatMap(({ clients, opening }) =>
        Effect.forEach([...clients, ...opening], retireClient, {
          concurrency: 'unbounded',
          discard: true,
        }),
      ),
    );
    return { clientFor, closeAll } as const;
  });
