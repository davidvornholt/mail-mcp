import { Effect, PubSub, Ref } from 'effect';
import type { ClientPoolClosedError, ImapError } from '../errors/errors';
import { retireClient, type WarmClient } from './imap-client';
import {
  awaitCurrentWinner,
  currentClient,
  discardUnavailable,
  type PoolContext,
} from './imap-client-pool-observer';
import {
  type Admission,
  admitCandidate,
  registerCandidate,
  removeOpening,
} from './imap-client-pool-state';

export type ClientCandidate<Client, Error> = {
  readonly client: Client;
  readonly activate: Effect.Effect<void, Error>;
};

const retirementFor = <Client extends WarmClient>(
  admission: Admission<Client>,
  candidate: Client,
): Effect.Effect<void> => {
  if (admission._tag === 'admit' && admission.replaced !== undefined) {
    return retireClient(admission.replaced);
  }
  if (admission._tag === 'reuse' || admission._tag === 'unusable') {
    return retireClient(candidate);
  }
  return Effect.void;
};

const finishAdmission = <Client extends WarmClient>(
  context: PoolContext<Client>,
  email: string,
  admission: Admission<Client>,
  candidate: Client,
): Effect.Effect<Client, ClientPoolClosedError | ImapError> => {
  if (admission._tag === 'closed') {
    return retireClient(candidate).pipe(
      Effect.andThen(Effect.fail(context.closedError)),
    );
  }
  return retirementFor(admission, candidate).pipe(
    Effect.andThen(currentClient(context, email)),
    Effect.catchTag('ImapError', (error) =>
      discardUnavailable(context, email, candidate, error),
    ),
  );
};

const settleFailure = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
  error: Error,
): Effect.Effect<Client, Error | ClientPoolClosedError | ImapError> =>
  Effect.gen(function* () {
    const outcome = yield* Ref.modify(context.state, (current) => {
      let result: 'closed' | 'winner' | 'original' = 'original';
      if (current.closed) {
        result = 'closed';
      } else if (current.clients.get(email)?.usable === true) {
        result = 'winner';
      }
      return [result, removeOpening(current, candidate)] as const;
    });
    yield* retireClient(candidate);
    if (outcome === 'closed') {
      return yield* Effect.fail(context.closedError);
    }
    if (outcome === 'winner') {
      return yield* currentClient(context, email);
    }
    return yield* Effect.fail(error);
  });

const finishActivation = <Client extends WarmClient>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
): Effect.Effect<Client, ClientPoolClosedError | ImapError> =>
  Ref.modify(context.state, (current) =>
    admitCandidate(current, email, candidate),
  ).pipe(
    Effect.tap((admission) =>
      admission._tag === 'admit'
        ? PubSub.publish(context.changes, undefined)
        : Effect.void,
    ),
    Effect.flatMap((admission) =>
      finishAdmission(context, email, admission, candidate),
    ),
  );

export const activateAndAdmit = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: ClientCandidate<Client, Error>,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Effect.Effect<Client, Error | ClientPoolClosedError | ImapError> =>
  Ref.modify(context.state, (current) =>
    registerCandidate(current, email, candidate.client),
  ).pipe(
    Effect.flatMap((registration) => {
      if (registration._tag === 'closed') {
        return retireClient(candidate.client).pipe(
          Effect.andThen(Effect.fail(context.closedError)),
        );
      }
      if (registration._tag === 'reuse') {
        return retireClient(candidate.client).pipe(
          Effect.andThen(currentClient(context, email)),
        );
      }
      const activation = restore(
        candidate.activate.pipe(
          Effect.disconnect,
          Effect.as({ _tag: 'activated' } as const),
        ),
      );
      const peerWinner = restore(awaitCurrentWinner(context, email));
      return Effect.raceFirst(activation, peerWinner).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            settleFailure(context, email, candidate.client, error),
          onSuccess: (result) =>
            result._tag === 'activated'
              ? finishActivation(context, email, candidate.client)
              : Ref.update(context.state, (current) =>
                  removeOpening(current, candidate.client),
                ).pipe(
                  Effect.andThen(retireClient(candidate.client)),
                  Effect.andThen(currentClient(context, email)),
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
