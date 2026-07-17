import { Duration, Effect, Ref } from 'effect';
import { ImapFlow } from 'imapflow';
import {
  AccountSearchTimeoutError,
  ImapError,
  type MailError,
} from '../errors/errors';
import type { Account } from '../schemas/account';

type WarmClient = {
  usable: boolean;
  close: () => void;
  logout: () => Promise<void>;
};

const accountSearchTimeoutSeconds = 30;

export const makeClient = (account: Account, password: string): ImapFlow => {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    // Force STARTTLS on non-implicit-TLS connections so the password is never sent in cleartext; leave it unset for secure=true, which imapflow rejects alongside doSTARTTLS.
    doSTARTTLS: account.secure ? undefined : true,
    auth: { user: account.user, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    // Backstop for operations outside global search and for connection phases.
    socketTimeout: 60_000,
  });
  client.on('error', () => client.close());
  return client;
};

export const connectClient = (
  client: ImapFlow,
  host: string,
): Effect.Effect<void, ImapError> =>
  Effect.tryPromise({
    try: () => client.connect(),
    catch: (cause) =>
      new ImapError({
        message: `connect to ${host} failed: ${String(cause)}`,
      }),
  });

export const closeClient = (client: WarmClient): Effect.Effect<void> =>
  Effect.promise(() => client.logout().catch(() => undefined));

export const makeClientPool = <Client extends WarmClient>() =>
  Effect.gen(function* () {
    const clients = yield* Ref.make<ReadonlyMap<string, Client>>(new Map());

    const remember = (email: string, client: Client) =>
      Ref.update(clients, (map) => new Map(map).set(email, client));

    const clientFor = <E>(
      email: string,
      open: Effect.Effect<Client, E>,
    ): Effect.Effect<Client, E> =>
      Ref.get(clients).pipe(
        Effect.flatMap((map) => {
          const existing = map.get(email);
          return existing?.usable === true
            ? Effect.succeed(existing)
            : open.pipe(Effect.tap((client) => remember(email, client)));
        }),
      );

    const retire = (email: string, client: Client): Effect.Effect<void> =>
      Ref.update(clients, (map) => {
        if (map.get(email) !== client) {
          return map;
        }
        const remaining = new Map(map);
        remaining.delete(email);
        return remaining;
      }).pipe(Effect.andThen(Effect.sync(() => client.close())));

    const closeAll = Ref.get(clients).pipe(
      Effect.flatMap((map) =>
        Effect.forEach([...map.values()], closeClient, { discard: true }),
      ),
    );

    return { clientFor, retire, closeAll } as const;
  });

export const withClientSearchDeadline = <Client, Result>(
  account: string,
  acquire: Effect.Effect<Client, MailError>,
  search: (client: Client) => Effect.Effect<Result, MailError>,
  retire: (client: Client) => Effect.Effect<void>,
): Effect.Effect<Result, MailError> =>
  Effect.gen(function* () {
    const activeClient = yield* Ref.make<Client | undefined>(undefined);
    const operation = acquire.pipe(
      Effect.tap((client) => Ref.set(activeClient, client)),
      Effect.flatMap(search),
      // The deadline may win while native IMAP promises or iterators continue.
      Effect.disconnect,
      Effect.timeoutFail({
        duration: Duration.seconds(accountSearchTimeoutSeconds),
        onTimeout: () =>
          new AccountSearchTimeoutError({
            account,
            message: `Search for ${account} did not complete within ${accountSearchTimeoutSeconds} seconds. Retry with this account alone or check the server.`,
          }),
      }),
    );
    return yield* operation.pipe(
      Effect.catchTag('AccountSearchTimeoutError', (error) =>
        Ref.get(activeClient).pipe(
          Effect.flatMap((client) =>
            client === undefined ? Effect.void : retire(client),
          ),
          Effect.andThen(Effect.fail(error)),
        ),
      ),
    );
  });
