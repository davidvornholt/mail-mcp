import { Effect, Exit, Fiber, Ref } from 'effect';
import type { ClientPoolClosedError, ImapError } from '../errors/errors';
import { retireClient, type WarmClient } from './imap-client';
import {
  finishActivation,
  retireStale,
  selectWinnerOr,
} from './imap-client-pool-admission';
import {
  awaitCurrentWinner,
  claimCurrentWinner,
  type PoolContext,
} from './imap-client-pool-observer';
import { registerCandidate, removeOpening } from './imap-client-pool-state';

export type ClientCandidate<Client, Error> = {
  readonly client: Client;
  readonly activate: Effect.Effect<void, Error>;
};

const cleanupCandidate = <Client extends WarmClient>(
  context: PoolContext<Client>,
  candidate: Client,
): Effect.Effect<void> =>
  Ref.update(context.state, (current) =>
    removeOpening(current, candidate),
  ).pipe(Effect.andThen(retireClient(candidate)));

const settleFailure = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
  error: Error,
): Effect.Effect<Client, Error | ClientPoolClosedError | ImapError> =>
  Effect.gen(function* () {
    yield* cleanupCandidate(context, candidate);
    const claim = yield* claimCurrentWinner(context, email);
    if (claim._tag === 'closed') {
      return yield* Effect.fail(context.closedError);
    }
    if (claim._tag === 'current') {
      return claim.client;
    }
    yield* retireStale(claim);
    return yield* Effect.fail(error);
  });

const completeActivation = <Client extends WarmClient, Error>(
  exit: Exit.Exit<void, Error>,
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
): Effect.Effect<Client, Error | ClientPoolClosedError | ImapError> =>
  Exit.matchEffect(exit, {
    onFailure: (cause) =>
      Effect.failCause(cause).pipe(
        Effect.catchAll((error) =>
          settleFailure(context, email, candidate, error),
        ),
      ),
    onSuccess: () => finishActivation(context, email, candidate),
  });

const finishObservedWinner = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
  activationFiber: Fiber.Fiber<void, Error>,
): Effect.Effect<Client, Error | ClientPoolClosedError | ImapError> =>
  Effect.gen(function* () {
    const claim = yield* claimCurrentWinner(context, email);
    if (claim._tag === 'closed') {
      yield* Fiber.interrupt(activationFiber);
      yield* cleanupCandidate(context, candidate);
      return yield* Effect.fail(context.closedError);
    }
    if (claim._tag === 'current') {
      yield* Fiber.interrupt(activationFiber);
      yield* cleanupCandidate(context, candidate);
      return claim.client;
    }
    yield* retireStale(claim);
    const exit = yield* Fiber.await(activationFiber);
    return yield* completeActivation(exit, context, email, candidate);
  });

const raceActivationWithWinner = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  race: {
    readonly candidate: Client;
    readonly activation: Effect.Effect<void, Error>;
    readonly peerWinner: Effect.Effect<
      { readonly _tag: 'winner'; readonly client: Client },
      ClientPoolClosedError
    >;
  },
): Effect.Effect<Client, Error | ClientPoolClosedError | ImapError> =>
  Effect.raceWith(race.activation, race.peerWinner, {
    onSelfDone: (exit, observerFiber) =>
      Fiber.interrupt(observerFiber).pipe(
        Effect.andThen(
          completeActivation(exit, context, email, race.candidate),
        ),
      ),
    onOtherDone: (exit, activationFiber) =>
      Exit.matchEffect(exit, {
        onFailure: (cause) =>
          Fiber.interrupt(activationFiber).pipe(
            Effect.andThen(cleanupCandidate(context, race.candidate)),
            Effect.andThen(Effect.failCause(cause)),
          ),
        onSuccess: () =>
          finishObservedWinner(context, email, race.candidate, activationFiber),
      }),
  });

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
        return selectWinnerOr(
          context,
          email,
          candidate.client,
          activateAndAdmit(context, email, candidate, restore),
        );
      }
      return raceActivationWithWinner(context, email, {
        candidate: candidate.client,
        activation: restore(candidate.activate.pipe(Effect.disconnect)),
        peerWinner: restore(awaitCurrentWinner(context, email)),
      }).pipe(
        Effect.onInterrupt(() => cleanupCandidate(context, candidate.client)),
      );
    }),
  );
