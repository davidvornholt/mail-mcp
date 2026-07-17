import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import type { MailError } from '../errors/errors';
import type { Account } from '../schemas/account';
import type {
  AttachmentContent,
  DraftInput,
  DraftLocation,
  FullMessage,
  SearchOptions,
  SearchOptionsInput,
  SearchResult,
  UpdateDraftInput,
} from '../schemas/mail';
import { searchAccounts } from './account-search';
import { readAttachment } from './attachment';
import { MailConfig } from './config';
import { removeDraft, replaceDraft, writeDraft } from './draft';
import {
  closeClient,
  connectClient,
  makeClient,
  makeClientPool,
  retireClient,
  withClientSearchDeadline,
} from './imap-client';
import { listFolders, readMessage } from './imap-ops';
import { searchMailboxes } from './imap-search';
import { Secrets } from './secrets';

const searchWithDedicatedClient = (
  account: Account,
  password: string,
  options: SearchOptions,
) => {
  const client = makeClient(account, password);
  return withClientSearchDeadline(
    account.email,
    client,
    (candidate) =>
      connectClient(candidate, account.host).pipe(
        Effect.andThen(searchMailboxes(candidate, options)),
      ),
    retireClient(client),
  );
};

// One IMAP service instance keeps a warm, authenticated connection per account
// so the MCP server reuses it across tool calls. Connections are closed by the
// scope finalizer when the runtime is disposed.
export class Imap extends Effect.Service<Imap>()('mail/Imap', {
  dependencies: [MailConfig.Default, Secrets.Default],
  scoped: Effect.gen(function* () {
    const config = yield* MailConfig;
    const secrets = yield* Secrets;
    const clientPool = yield* makeClientPool<ImapFlow>();

    const open = (email: string) =>
      Effect.gen(function* () {
        const account = yield* config.getAccount(email);
        const password = yield* secrets.getPassword(email);
        const client = makeClient(account, password);
        yield* connectClient(client, account.host);
        return client;
      });

    const clientFor = (email: string) =>
      clientPool.clientFor(email, open(email));

    const searchMailbox = (email: string, options: SearchOptions) =>
      clientFor(email).pipe(
        Effect.flatMap((client) => searchMailboxes(client, options)),
      );

    const searchMailboxWithinDeadline = (
      email: string,
      options: SearchOptions,
    ) =>
      Effect.gen(function* () {
        const account = yield* config.getAccount(email);
        const password = yield* secrets.getPassword(email);
        return yield* searchWithDedicatedClient(account, password, options);
      });

    yield* Effect.addFinalizer(() => clientPool.closeAll);

    return {
      verify: (email: string) => clientFor(email).pipe(Effect.asVoid),
      verifyCredentials: (
        email: string,
        password: string,
      ): Effect.Effect<void, MailError> =>
        Effect.gen(function* () {
          const account = yield* config.getAccount(email);
          const client = makeClient(account, password);
          yield* Effect.acquireUseRelease(
            Effect.succeed(client),
            (candidate) => connectClient(candidate, account.host),
            closeClient,
          );
        }),
      listFolders: (email: string) =>
        clientFor(email).pipe(Effect.flatMap(listFolders)),
      search: (
        email: string | undefined,
        options: SearchOptionsInput,
      ): Effect.Effect<SearchResult, MailError> =>
        searchAccounts({
          accounts: config.emails,
          account: email,
          options,
          validateAccount: config.getAccount,
          searchMailbox,
          searchMailboxWithinDeadline,
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
