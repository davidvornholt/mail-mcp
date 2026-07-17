import { Effect, Exit, Ref } from 'effect';
import { ClientPoolClosedError } from '../errors/errors';
import { closeClient, retireClient, type WarmClient } from './imap-client';

type ClientCandidate<Client, Error> = {
  readonly client: Client;
  readonly activate: Effect.Effect<void, Error>;
};

type ClientPoolState<Client> = {
  readonly clients: ReadonlyMap<string, Client>;
  readonly opening: ReadonlySet<Client>;
  readonly closed: boolean;
};
type ClientPoolSnapshot<Client> = {
  readonly clients: ReadonlyArray<Client>;
  readonly opening: ReadonlyArray<Client>;
};
type Admission<Client> =
  | { readonly _tag: 'admit'; readonly replaced: Client | undefined }
  | { readonly _tag: 'reuse'; readonly client: Client }
  | { readonly _tag: 'closed' };
type PoolContext<Client> = {
  readonly state: Ref.Ref<ClientPoolState<Client>>;
  readonly closedError: ClientPoolClosedError;
};
const registerCandidate = <Client>(
  state: ClientPoolState<Client>,
  client: Client,
): readonly [boolean, ClientPoolState<Client>] =>
  state.closed
    ? [false, state]
    : [
        true,
        {
          ...state,
          opening: new Set(state.opening).add(client),
        },
      ];
const removeOpening = <Client>(
  state: ClientPoolState<Client>,
  client: Client,
): ClientPoolState<Client> => {
  const opening = new Set(state.opening);
  opening.delete(client);
  return { ...state, opening };
};

const admitCandidate = <Client extends WarmClient>(
  state: ClientPoolState<Client>,
  email: string,
  candidate: Client,
): readonly [Admission<Client>, ClientPoolState<Client>] => {
  const withoutOpening = removeOpening(state, candidate);
  if (state.closed) {
    return [{ _tag: 'closed' }, withoutOpening];
  }
  const existing = state.clients.get(email);
  if (existing?.usable === true) {
    return [{ _tag: 'reuse', client: existing }, withoutOpening];
  }
  const clients = new Map(state.clients);
  clients.set(email, candidate);
  return [
    { _tag: 'admit', replaced: existing },
    { ...withoutOpening, clients },
  ];
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

const activateAndAdmit = <Client extends WarmClient, Error>(
  context: PoolContext<Client>,
  email: string,
  candidate: ClientCandidate<Client, Error>,
  activate: Effect.Effect<void, Error>,
): Effect.Effect<Client, Error | ClientPoolClosedError> => {
  const remove = Ref.update(context.state, (current) =>
    removeOpening(current, candidate.client),
  );
  return Ref.modify(context.state, (current) =>
    registerCandidate(current, candidate.client),
  ).pipe(
    Effect.flatMap((registered) => {
      if (!registered) {
        return retireClient(candidate.client).pipe(
          Effect.andThen(Effect.fail(context.closedError)),
        );
      }
      return activate.pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? remove.pipe(Effect.andThen(retireClient(candidate.client)))
            : Effect.void,
        ),
        Effect.andThen(
          Ref.modify(context.state, (current) =>
            admitCandidate(current, email, candidate.client),
          ),
        ),
        Effect.flatMap((admission) =>
          finishAdmission(admission, candidate.client, context.closedError),
        ),
      );
    }),
  );
};

export const makeClientPool = <Client extends WarmClient>() =>
  Effect.gen(function* () {
    const state = yield* Ref.make<ClientPoolState<Client>>({
      clients: new Map(),
      opening: new Set(),
      closed: false,
    });
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
                activateAndAdmit(
                  context,
                  email,
                  candidate,
                  restore(candidate.activate.pipe(Effect.disconnect)),
                ),
              ),
            ),
          );
        }),
      );

    const closeAll = Ref.modify(
      state,
      (current): [ClientPoolSnapshot<Client>, ClientPoolState<Client>] => {
        if (current.closed) {
          return [{ clients: [], opening: [] }, current];
        }
        return [
          {
            clients: [...current.clients.values()],
            opening: [...current.opening],
          },
          {
            clients: new Map<string, Client>(),
            opening: new Set<Client>(),
            closed: true,
          },
        ];
      },
    ).pipe(
      Effect.flatMap(({ clients, opening }) =>
        Effect.all(
          [
            Effect.forEach(clients, closeClient, { discard: true }),
            Effect.forEach(opening, retireClient, { discard: true }),
          ],
          { discard: true },
        ),
      ),
    );

    return { clientFor, closeAll } as const;
  });
