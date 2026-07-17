import { Deferred, Effect, Ref } from 'effect';
import { ClientPoolClosedError } from '../errors/errors';
import { retireClient, type WarmClient } from './imap-client';
import {
  type Admission,
  admitCandidate,
  type ClientPoolState,
  closePool,
  initialClientPoolState,
  registerCandidate,
  removeOpening,
} from './imap-client-pool-state';

type ClientCandidate<Client, Error> = {
  readonly client: Client;
  readonly activate: Effect.Effect<void, Error>;
};

type PoolContext<Client> = {
  readonly state: Ref.Ref<ClientPoolState<Client>>;
  readonly closedError: ClientPoolClosedError;
};

const finishAdmission = <Client extends WarmClient>(
  admission: Admission<Client>,
  candidate: Client,
  closedError: ClientPoolClosedError,
): Effect.Effect<Client, ClientPoolClosedError> => {
  if (admission._tag === 'admit') {
    return admission.replaced === undefined
      ? Effect.succeed(candidate)
      : retireClient(admission.replaced).pipe(Effect.as(candidate));
  }
  if (admission._tag === 'reuse') {
    return retireClient(candidate).pipe(Effect.as(admission.client));
  }
  return retireClient(candidate).pipe(Effect.andThen(Effect.fail(closedError)));
};

const settleFailure = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
  error: Error,
): Effect.Effect<Client, Error> =>
  Ref.modify(context.state, (current) => {
    const existing = current.clients.get(email);
    return [
      existing?.usable === true ? existing : undefined,
      removeOpening(current, candidate),
    ];
  }).pipe(
    Effect.flatMap((winner) =>
      retireClient(candidate).pipe(
        Effect.andThen(
          winner === undefined ? Effect.fail(error) : Effect.succeed(winner),
        ),
      ),
    ),
  );

const finishActivation = <Client extends WarmClient>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
  winner: Deferred.Deferred<Client>,
): Effect.Effect<Client, ClientPoolClosedError> =>
  Ref.modify(context.state, (current) =>
    admitCandidate(current, email, candidate),
  ).pipe(
    Effect.tap((admission) =>
      admission._tag === 'admit'
        ? Deferred.succeed(winner, candidate)
        : Effect.void,
    ),
    Effect.flatMap((admission) =>
      finishAdmission(admission, candidate, context.closedError),
    ),
  );

const activateAndAdmit = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: ClientCandidate<Client, Error>,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Effect.Effect<Client, Error | ClientPoolClosedError> =>
  Deferred.make<Client>().pipe(
    Effect.flatMap((createdWinner) =>
      Ref.modify(context.state, (current) =>
        registerCandidate(current, email, candidate.client, createdWinner),
      ),
    ),
    Effect.flatMap((registration) => {
      if (registration._tag === 'closed') {
        return retireClient(candidate.client).pipe(
          Effect.andThen(Effect.fail(context.closedError)),
        );
      }
      if (registration._tag === 'reuse') {
        return retireClient(candidate.client).pipe(
          Effect.as(registration.client),
        );
      }
      const activation = restore(
        candidate.activate.pipe(
          Effect.disconnect,
          Effect.as({ _tag: 'activated' } as const),
        ),
      );
      const peerWinner = restore(
        Deferred.await(registration.winner).pipe(
          Effect.map((client) => ({ _tag: 'winner', client }) as const),
        ),
      );
      return Effect.raceFirst(activation, peerWinner).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            settleFailure(context, email, candidate.client, error),
          onSuccess: (result) =>
            result._tag === 'activated'
              ? finishActivation(
                  context,
                  email,
                  candidate.client,
                  registration.winner,
                )
              : Ref.update(context.state, (current) =>
                  removeOpening(current, candidate.client),
                ).pipe(
                  Effect.andThen(retireClient(candidate.client)),
                  Effect.as(result.client),
                ),
        }),
        Effect.onInterrupt(() =>
          Ref.update(context.state, (current) =>
            removeOpening(current, candidate.client),
          ).pipe(Effect.andThen(retireClient(candidate.client))),
        ),
      );
    }),
  );

export const makeClientPool = <Client extends WarmClient>() =>
  Effect.gen(function* () {
    const state = yield* Ref.make(initialClientPoolState<Client>());
    const closedError = new ClientPoolClosedError({
      message: 'IMAP client pool is closed.',
    });
    const context = { state, closedError };
    const clientFor = <OpenError, ActivationError>(
      email: string,
      makeCandidate: Effect.Effect<
        ClientCandidate<Client, ActivationError>,
        OpenError
      >,
    ): Effect.Effect<
      Client,
      OpenError | ActivationError | ClientPoolClosedError
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
      Effect.flatMap(({ clients, opening }) =>
        Effect.forEach([...clients, ...opening], retireClient, {
          concurrency: 'unbounded',
          discard: true,
        }),
      ),
    );
    return { clientFor, closeAll } as const;
  });
