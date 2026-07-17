import { Effect, PubSub, Ref } from 'effect';
import type { ClientPoolClosedError, ImapError } from '../errors/errors';
import { retireClient, type WarmClient } from './imap-client';
import {
  claimCurrentWinner,
  currentClient,
  type PoolContext,
  unavailableError,
  type WinnerClaim,
} from './imap-client-pool-observer';
import { type Admission, admitCandidate } from './imap-client-pool-state';

export const retireStale = <Client extends WarmClient>(
  claim: WinnerClaim<Client>,
): Effect.Effect<void> =>
  claim._tag === 'stale' && claim.client !== undefined
    ? retireClient(claim.client)
    : Effect.void;

export const selectWinnerOr = <Client extends WarmClient, Error, Environment>(
  context: PoolContext<Client>,
  email: string,
  candidate: Client,
  onStale: Effect.Effect<Client, Error, Environment>,
): Effect.Effect<Client, Error | ClientPoolClosedError, Environment> =>
  Effect.gen(function* () {
    const claim = yield* claimCurrentWinner(context, email);
    if (claim._tag === 'closed') {
      yield* retireClient(candidate);
      return yield* Effect.fail(context.closedError);
    }
    if (claim._tag === 'current') {
      yield* retireClient(candidate);
      return claim.client;
    }
    yield* retireStale(claim);
    return yield* onStale;
  });

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
  if (admission._tag === 'reuse') {
    return selectWinnerOr(
      context,
      email,
      candidate,
      finishActivation(context, email, candidate),
    );
  }
  if (admission._tag === 'unusable') {
    return retireClient(candidate).pipe(
      Effect.andThen(currentClient(context, email)),
    );
  }
  return Effect.gen(function* () {
    if (admission.replaced !== undefined) {
      yield* retireClient(admission.replaced);
    }
    const claim = yield* claimCurrentWinner(context, email);
    if (claim._tag === 'closed') {
      yield* retireClient(candidate);
      return yield* Effect.fail(context.closedError);
    }
    if (claim._tag === 'current') {
      if (claim.client !== candidate) {
        yield* retireClient(candidate);
      }
      return claim.client;
    }
    yield* retireStale(claim);
    return yield* Effect.fail(unavailableError);
  });
};

export const finishActivation = <Client extends WarmClient>(
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
