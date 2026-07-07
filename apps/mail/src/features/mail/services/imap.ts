import { Effect, Ref } from 'effect';
import { ImapFlow } from 'imapflow';
import { ImapError, type MailError } from '../errors/errors';
import type {
  DraftInput,
  FolderInfo,
  FullMessage,
  SearchHit,
  SearchOptions,
} from '../schemas/mail';
import { MailConfig } from './config';
import { writeDraft } from './draft';
import { listFolders, readMessage, searchMailbox } from './imap-ops';
import { Secrets } from './secrets';

const closeClient = (client: ImapFlow): Effect.Effect<void> =>
  Effect.promise(() => client.logout().catch(() => undefined));

const closeAll = (
  clients: ReadonlyMap<string, ImapFlow>,
): Effect.Effect<void> =>
  Effect.forEach([...clients.values()], closeClient, { discard: true });

// One IMAP service instance keeps a warm, authenticated connection per account
// so the MCP server reuses it across tool calls. Connections are closed by the
// scope finalizer when the runtime is disposed.
export class Imap extends Effect.Service<Imap>()('mail/Imap', {
  dependencies: [MailConfig.Default, Secrets.Default],
  scoped: Effect.gen(function* () {
    const config = yield* MailConfig;
    const secrets = yield* Secrets;
    const clients = yield* Ref.make<ReadonlyMap<string, ImapFlow>>(new Map());

    const open = (email: string) =>
      Effect.gen(function* () {
        const account = yield* config.getAccount(email);
        const password = yield* secrets.getPassword(email);
        const client = new ImapFlow({
          host: account.host,
          port: account.port,
          secure: account.secure,
          auth: { user: account.user, pass: password },
          logger: false,
        });
        yield* Effect.tryPromise({
          try: () => client.connect(),
          catch: (cause) =>
            new ImapError({
              message: `connect to ${account.host} failed: ${String(cause)}`,
            }),
        });
        yield* Ref.update(clients, (map) => new Map(map).set(email, client));
        return client;
      });

    const clientFor = (email: string) =>
      Ref.get(clients).pipe(
        Effect.flatMap((map) => {
          const existing = map.get(email);
          return existing?.usable === true
            ? Effect.succeed(existing)
            : open(email);
        }),
      );

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(clients), closeAll),
    );

    return {
      listFolders: (
        email: string,
      ): Effect.Effect<ReadonlyArray<FolderInfo>, MailError> =>
        clientFor(email).pipe(Effect.flatMap(listFolders)),
      search: (
        email: string,
        options: SearchOptions,
      ): Effect.Effect<ReadonlyArray<SearchHit>, MailError> =>
        clientFor(email).pipe(
          Effect.flatMap((client) => searchMailbox(client, options)),
        ),
      read: (
        email: string,
        folder: string,
        uid: number,
      ): Effect.Effect<FullMessage, MailError> =>
        clientFor(email).pipe(
          Effect.flatMap((client) => readMessage(client, folder, uid)),
        ),
      saveDraft: (input: DraftInput): Effect.Effect<string, MailError> =>
        Effect.gen(function* () {
          const account = yield* config.getAccount(input.account);
          const client = yield* clientFor(input.account);
          return yield* writeDraft(client, account, input);
        }),
    } as const;
  }),
}) {}
