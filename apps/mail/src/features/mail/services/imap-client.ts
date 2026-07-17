import { Duration, Effect, Exit, Ref } from 'effect';
import { ImapFlow } from 'imapflow';
import {
  AccountSearchTimeoutError,
  ImapError,
  type MailError,
} from '../errors/errors';
import type { Account } from '../schemas/account';

export type WarmClient = {
  usable: boolean;
  close: () => void;
  logout: () => Promise<void>;
};

const accountSearchTimeoutSeconds = 30;
const retiredClients = new WeakSet<object>();

const beginRetirement = (client: object): boolean => {
  if (retiredClients.has(client)) {
    return false;
  }
  retiredClients.add(client);
  return true;
};

export const retireClient = (client: WarmClient): Effect.Effect<void> =>
  Effect.sync(() => {
    if (beginRetirement(client)) {
      client.close();
    }
  });

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
  client.on('error', () => {
    Effect.runSync(retireClient(client));
  });
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
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) ? retireClient(client) : Effect.void,
    ),
  );

export const closeClient = (client: WarmClient): Effect.Effect<void> =>
  Effect.suspend(() =>
    beginRetirement(client)
      ? Effect.promise(() => client.logout().catch(() => undefined))
      : Effect.void,
  );

export const withClientSearchDeadline = <Client, Result>(
  account: string,
  client: Client,
  search: (client: Client) => Effect.Effect<Result, MailError>,
  retire: Effect.Effect<void>,
): Effect.Effect<Result, MailError> =>
  Effect.gen(function* () {
    const retired = yield* Ref.make(false);
    const retireOnce = Ref.modify(retired, (alreadyRetired) => [
      alreadyRetired,
      true,
    ]).pipe(
      Effect.flatMap((alreadyRetired) =>
        alreadyRetired ? Effect.void : retire,
      ),
    );
    return yield* search(client).pipe(
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
      // Keep retirement outside disconnect so caller interruption also owns it.
      Effect.ensuring(retireOnce),
    );
  });
