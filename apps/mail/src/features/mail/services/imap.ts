import { Effect } from 'effect';
import type { MailError } from '../errors/errors';
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
  retireClient,
  type WarmClient,
  withClientSearchDeadline,
} from './imap-client';
import { listFolders, readMessage } from './imap-ops';
import { searchMailboxes } from './imap-search';
import { makeWarmClientCache } from './imap-warm-cache';
import { Secrets } from './secrets';

export const searchWithDedicatedClient = <Client extends WarmClient, Result>(
  account: string,
  createClient: () => Client,
  activate: (client: Client) => Effect.Effect<void, MailError>,
  search: (client: Client) => Effect.Effect<Result, MailError>,
) => {
  const client = createClient();
  return withClientSearchDeadline(
    account,
    client,
    (candidate) =>
      activate(candidate).pipe(
        Effect.andThen(Effect.suspend(() => search(candidate))),
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
    const { clientFor, closeAll } = yield* makeWarmClientCache(
      (email: string) =>
        Effect.gen(function* () {
          const account = yield* config.getAccount(email);
          const password = yield* secrets.getPassword(email);
          const client = makeClient(account, password);
          yield* connectClient(client, account.host);
          return client;
        }),
    );
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
        return yield* searchWithDedicatedClient(
          email,
          () => makeClient(account, password),
          (candidate) => connectClient(candidate, account.host),
          (candidate) => searchMailboxes(candidate, options),
        );
      });
    yield* Effect.addFinalizer(() => closeAll);
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
