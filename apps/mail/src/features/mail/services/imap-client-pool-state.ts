import type { WarmClient } from './imap-client';

export type ClientPoolState<Client> = {
  readonly clients: ReadonlyMap<string, Client>;
  readonly opening: ReadonlyMap<Client, string>;
  readonly closed: boolean;
};

export type ClientPoolSnapshot<Client> = {
  readonly clients: ReadonlyArray<Client>;
  readonly opening: ReadonlyArray<Client>;
};

export type Registration<Client> =
  | { readonly _tag: 'activate' }
  | { readonly _tag: 'reuse'; readonly client: Client }
  | { readonly _tag: 'closed' };

export type Admission<Client> =
  | { readonly _tag: 'admit'; readonly replaced: Client | undefined }
  | { readonly _tag: 'reuse'; readonly client: Client }
  | { readonly _tag: 'unusable' }
  | { readonly _tag: 'closed' };

export const initialClientPoolState = <Client>(): ClientPoolState<Client> => ({
  clients: new Map(),
  opening: new Map(),
  closed: false,
});

export const registerCandidate = <Client extends WarmClient>(
  state: ClientPoolState<Client>,
  email: string,
  client: Client,
): readonly [Registration<Client>, ClientPoolState<Client>] => {
  if (state.closed) {
    return [{ _tag: 'closed' }, state];
  }
  const existing = state.clients.get(email);
  if (existing?.usable === true) {
    return [{ _tag: 'reuse', client: existing }, state];
  }
  return [
    { _tag: 'activate' },
    {
      ...state,
      opening: new Map(state.opening).set(client, email),
    },
  ];
};

export const removeOpening = <Client>(
  state: ClientPoolState<Client>,
  client: Client,
): ClientPoolState<Client> => {
  const opening = new Map(state.opening);
  opening.delete(client);
  return { ...state, opening };
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
  if (!candidate.usable) {
    return [{ _tag: 'unusable' }, withoutOpening];
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
          closed: true,
        },
      ];
