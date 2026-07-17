import type { Deferred } from 'effect';
import type { WarmClient } from './imap-client';

export type ClientPoolState<Client> = {
  readonly clients: ReadonlyMap<string, Client>;
  readonly opening: ReadonlyMap<Client, string>;
  readonly winners: ReadonlyMap<string, Deferred.Deferred<Client>>;
  readonly closed: boolean;
};

export type ClientPoolSnapshot<Client> = {
  readonly clients: ReadonlyArray<Client>;
  readonly opening: ReadonlyArray<Client>;
};

export type Registration<Client> =
  | { readonly _tag: 'activate'; readonly winner: Deferred.Deferred<Client> }
  | { readonly _tag: 'reuse'; readonly client: Client }
  | { readonly _tag: 'closed' };

export type Admission<Client> =
  | { readonly _tag: 'admit'; readonly replaced: Client | undefined }
  | { readonly _tag: 'reuse'; readonly client: Client }
  | { readonly _tag: 'closed' };

export const initialClientPoolState = <Client>(): ClientPoolState<Client> => ({
  clients: new Map(),
  opening: new Map(),
  winners: new Map(),
  closed: false,
});

export const registerCandidate = <Client extends WarmClient>(
  state: ClientPoolState<Client>,
  email: string,
  client: Client,
  createdWinner: Deferred.Deferred<Client>,
): readonly [Registration<Client>, ClientPoolState<Client>] => {
  if (state.closed) {
    return [{ _tag: 'closed' }, state];
  }
  const existing = state.clients.get(email);
  if (existing?.usable === true) {
    return [{ _tag: 'reuse', client: existing }, state];
  }
  const winner = state.winners.get(email) ?? createdWinner;
  return [
    { _tag: 'activate', winner },
    {
      ...state,
      opening: new Map(state.opening).set(client, email),
      winners: new Map(state.winners).set(email, winner),
    },
  ];
};

export const removeOpening = <Client>(
  state: ClientPoolState<Client>,
  client: Client,
): ClientPoolState<Client> => {
  const email = state.opening.get(client);
  const opening = new Map(state.opening);
  opening.delete(client);
  if (
    email === undefined ||
    [...opening.values()].some((openingEmail) => openingEmail === email)
  ) {
    return { ...state, opening };
  }
  const winners = new Map(state.winners);
  winners.delete(email);
  return { ...state, opening, winners };
};

export const admitCandidate = <Client extends WarmClient>(
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

export const closePool = <Client>(
  state: ClientPoolState<Client>,
): readonly [ClientPoolSnapshot<Client>, ClientPoolState<Client>] =>
  state.closed
    ? [{ clients: [], opening: [] }, state]
    : [
        {
          clients: [...state.clients.values()],
          opening: [...state.opening.keys()],
        },
        {
          clients: new Map<string, Client>(),
          opening: new Map<Client, string>(),
          winners: new Map<string, Deferred.Deferred<Client>>(),
          closed: true,
        },
      ];
