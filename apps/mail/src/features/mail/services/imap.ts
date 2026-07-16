import { Effect, Ref } from 'effect';
import { ImapFlow } from 'imapflow';
import { ImapError, type MailError } from '../errors/errors';
import type { Account } from '../schemas/account';
import type {
  AttachmentContent,
  DraftInput,
  DraftLocation,
  FolderInfo,
  FullMessage,
  SearchOptions,
  SearchResult,
  UpdateDraftInput,
} from '../schemas/mail';
import { searchAccounts } from './account-search';
import { readAttachment } from './attachment';
import { MailConfig } from './config';
import { removeDraft, replaceDraft, writeDraft } from './draft';
import { listFolders, readMessage } from './imap-ops';
import { searchMailboxes } from './imap-search';
import { Secrets } from './secrets';

const closeClient = (client: ImapFlow): Effect.Effect<void> =>
  Effect.promise(() => client.logout().catch(() => undefined));

const makeClient = (account: Account, password: string): ImapFlow =>
  new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    // Force STARTTLS on non-implicit-TLS connections so the password is never sent in cleartext; leave it unset for secure=true, which imapflow rejects alongside doSTARTTLS.
    doSTARTTLS: account.secure ? undefined : true,
    auth: { user: account.user, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });

const connect = (
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
        const client = makeClient(account, password);
        yield* connect(client, account.host);
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

    const searchMailbox = (email: string, options: SearchOptions) =>
      clientFor(email).pipe(
        Effect.flatMap((client) => searchMailboxes(client, options)),
      );

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(clients), closeAll),
    );

    return {
      verify: (email: string): Effect.Effect<void, MailError> =>
        clientFor(email).pipe(Effect.asVoid),
      verifyCredentials: (
        email: string,
        password: string,
      ): Effect.Effect<void, MailError> =>
        Effect.gen(function* () {
          const account = yield* config.getAccount(email);
          const client = makeClient(account, password);
          yield* Effect.acquireUseRelease(
            Effect.succeed(client),
            (candidate) => connect(candidate, account.host),
            closeClient,
          );
        }),
      listFolders: (
        email: string,
      ): Effect.Effect<ReadonlyArray<FolderInfo>, MailError> =>
        clientFor(email).pipe(Effect.flatMap(listFolders)),
      search: (
        email: string | undefined,
        options: SearchOptions,
      ): Effect.Effect<SearchResult, MailError> =>
        searchAccounts({
          accounts: config.emails,
          account: email,
          options,
          validateAccount: config.getAccount,
          searchMailbox,
        }),
      read: (
        email: string,
        folder: string,
        uid: number,
      ): Effect.Effect<FullMessage, MailError> =>
        clientFor(email).pipe(
          Effect.flatMap((client) => readMessage(client, folder, uid)),
        ),
      readAttachment: (
        email: string,
        folder: string,
        uid: number,
        part: string,
      ): Effect.Effect<AttachmentContent, MailError> =>
        clientFor(email).pipe(
          Effect.flatMap((client) => readAttachment(client, folder, uid, part)),
        ),
      saveDraft: (input: DraftInput): Effect.Effect<DraftLocation, MailError> =>
        Effect.gen(function* () {
          const account = yield* config.getAccount(input.account);
          const client = yield* clientFor(input.account);
          return yield* writeDraft(client, account, input);
        }),
      updateDraft: (
        input: UpdateDraftInput,
      ): Effect.Effect<DraftLocation, MailError> =>
        Effect.gen(function* () {
          const account = yield* config.getAccount(input.account);
          const client = yield* clientFor(input.account);
          return yield* replaceDraft(client, account, input);
        }),
      deleteDraft: (
        email: string,
        folder: string,
        uid: number,
        uidValidity?: string,
      ): Effect.Effect<void, MailError> =>
        clientFor(email).pipe(
          Effect.flatMap((client) =>
            removeDraft(client, folder, uid, uidValidity),
          ),
        ),
    } as const;
  }),
}) {}
