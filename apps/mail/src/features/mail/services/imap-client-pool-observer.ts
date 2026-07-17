import { Effect, PubSub, Queue, Ref } from 'effect';
import { type ClientPoolClosedError, ImapError } from '../errors/errors';
import type { WarmClient } from './imap-client';
import type { ClientPoolState } from './imap-client-pool-state';

export type PoolContext<Client> = {
  readonly state: Ref.Ref<ClientPoolState<Client>>;
  readonly changes: PubSub.PubSub<void>;
  readonly closedError: ClientPoolClosedError;
};

export type WinnerClaim<Client> =
  | { readonly _tag: 'current'; readonly client: Client }
  | { readonly _tag: 'stale'; readonly client: Client | undefined }
  | { readonly _tag: 'closed' };

export const unavailableError = new ImapError({
  message: 'IMAP client became unusable before it could be returned.',
});

export const currentClient = <Client extends WarmClient>(
  context: PoolContext<Client>,
  email: string,
): Effect.Effect<Client, ClientPoolClosedError | ImapError> =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.get(context.state);
    if (snapshot.closed) {
      return yield* Effect.fail(context.closedError);
    }
    const client = snapshot.clients.get(email);
    if (client?.usable === true) {
      return client;
    }
    const latest = yield* Ref.get(context.state);
    return yield* Effect.fail(
      latest.closed ? context.closedError : unavailableError,
    );
  });

export const claimCurrentWinner = <Client extends WarmClient>(
  context: PoolContext<Client>,
  email: string,
): Effect.Effect<WinnerClaim<Client>> =>
  Ref.modify(
    context.state,
    (current): readonly [WinnerClaim<Client>, ClientPoolState<Client>] => {
      if (current.closed) {
        return [{ _tag: 'closed' }, current] as const;
      }
      const client = current.clients.get(email);
      if (client?.usable === true) {
        return [{ _tag: 'current', client }, current] as const;
      }
      if (client === undefined) {
        return [{ _tag: 'stale', client }, current] as const;
      }
      const clients = new Map(current.clients);
      clients.delete(email);
      return [
        { _tag: 'stale', client },
        { ...current, clients },
      ];
    },
  ).pipe(
    Effect.tap((claim) =>
      claim._tag === 'stale'
        ? PubSub.publish(context.changes, undefined)
        : Effect.void,
    ),
  );

export const awaitCurrentWinner = <Client extends WarmClient>(
  context: PoolContext<Client>,
  email: string,
) =>
  Effect.scoped(
    PubSub.subscribe(context.changes).pipe(
      Effect.flatMap((events) => {
        const wait: Effect.Effect<
          { readonly _tag: 'winner'; readonly client: Client },
          ClientPoolClosedError
        > = Effect.suspend(() =>
          Ref.get(context.state).pipe(
            Effect.flatMap((snapshot) => {
              if (snapshot.closed) {
                return Effect.fail(context.closedError);
              }
              const client = snapshot.clients.get(email);
              return client?.usable === true
                ? Effect.succeed({ _tag: 'winner', client } as const)
                : Queue.take(events).pipe(Effect.andThen(wait));
            }),
          ),
        );
        return wait;
      }),
    ),
  );
