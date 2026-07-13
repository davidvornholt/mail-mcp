import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import {
  DraftError,
  ImapError,
  MessageNotFoundError,
  StaleUidError,
} from '../errors/errors';
import type { Account } from '../schemas/account';
import type {
  DraftInput,
  DraftLocation,
  FolderInfo,
  FullMessage,
  UpdateDraftInput,
} from '../schemas/mail';
import { selectDraftsFolder } from './draft-folder';
import { listFolders, lockMailbox, readMessage } from './imap-ops';
import { buildMime } from './mime';

const readReplySource = (
  client: ImapFlow,
  input: DraftInput,
): Effect.Effect<FullMessage | undefined, ImapError | MessageNotFoundError> =>
  input.replySource === undefined
    ? Effect.succeed(undefined)
    : readMessage(client, input.replySource.folder, input.replySource.uid);

const appendDraft = (
  client: ImapFlow,
  folder: string,
  raw: Buffer,
): Effect.Effect<DraftLocation, ImapError> =>
  Effect.tryPromise({
    // \Seen matches how MUAs store their own drafts, so agent-saved drafts
    // don't surface as unread in Thunderbird.
    try: () => client.append(folder, raw, ['\\Draft', '\\Seen']),
    catch: (cause) =>
      new ImapError({
        message: `append draft to ${folder} failed: ${String(cause)}`,
      }),
  }).pipe(
    Effect.map((response) => ({
      folder,
      uid: response === false ? null : (response.uid ?? null),
      uidValidity:
        response === false ? null : (response.uidValidity?.toString() ?? null),
    })),
  );

const deleteDraft = (
  client: ImapFlow,
  folder: string,
  uid: number,
  expectedUidValidity?: string,
): Effect.Effect<void, ImapError | MessageNotFoundError | StaleUidError> =>
  Effect.gen(function* () {
    yield* lockMailbox(client, folder);
    if (expectedUidValidity !== undefined) {
      const { mailbox } = client;
      const currentUidValidity =
        mailbox === false ? null : mailbox.uidValidity.toString();
      if (currentUidValidity !== expectedUidValidity) {
        return yield* Effect.fail(
          new StaleUidError({
            folder,
            uid,
            message: `refusing to expunge draft uid ${uid}: "${folder}" was reindexed (uidValidity ${expectedUidValidity} → ${currentUidValidity ?? 'unknown'}); re-fetch the draft handle`,
          }),
        );
      }
    }
    const existing = yield* Effect.tryPromise({
      try: () => client.fetchOne(String(uid), { uid: true }, { uid: true }),
      catch: (cause) =>
        new ImapError({
          message: `look up draft uid ${uid} failed: ${String(cause)}`,
        }),
    });
    if (existing === false) {
      return yield* Effect.fail(
        new MessageNotFoundError({
          folder,
          uid,
          message: `draft uid ${uid} not found in "${folder}"`,
        }),
      );
    }
    const deleted = yield* Effect.tryPromise({
      try: () => client.messageDelete(String(uid), { uid: true }),
      catch: (cause) =>
        new ImapError({
          message: `delete draft uid ${uid} failed: ${String(cause)}`,
        }),
    });
    if (!deleted) {
      return yield* Effect.fail(
        new ImapError({
          message: `delete draft uid ${uid} failed: server rejected the expunge`,
        }),
      );
    }
  }).pipe(Effect.scoped);

export const requireDraftsFolder = (
  folders: ReadonlyArray<FolderInfo>,
  requestedFolder: string,
): Effect.Effect<string, DraftError> => {
  const draftsFolder = selectDraftsFolder(folders);
  return requestedFolder === draftsFolder
    ? Effect.succeed(draftsFolder)
    : Effect.fail(
        new DraftError({
          message: `refusing to modify a message outside the drafts folder "${draftsFolder}"`,
        }),
      );
};

export const writeDraft = (
  client: ImapFlow,
  account: Account,
  input: DraftInput,
): Effect.Effect<
  DraftLocation,
  ImapError | DraftError | MessageNotFoundError
> =>
  Effect.gen(function* () {
    const folders = yield* listFolders(client);
    const folder = selectDraftsFolder(folders);
    const repliedTo = yield* readReplySource(client, input);
    const raw = yield* buildMime(account, input, repliedTo);
    return yield* appendDraft(client, folder, raw);
  });

export const replaceDraft = (
  client: ImapFlow,
  account: Account,
  input: UpdateDraftInput,
): Effect.Effect<
  DraftLocation,
  ImapError | DraftError | MessageNotFoundError
> =>
  Effect.gen(function* () {
    const folders = yield* listFolders(client);
    const draftsFolder = yield* requireDraftsFolder(folders, input.folder);
    const repliedTo = yield* readReplySource(client, input);
    const raw = yield* buildMime(account, input, repliedTo);
    const replacement = yield* appendDraft(client, draftsFolder, raw);
    yield* deleteDraft(client, draftsFolder, input.uid, input.uidValidity).pipe(
      Effect.mapError(
        (error) =>
          new ImapError({
            message: `replacement draft was saved as uid ${replacement.uid ?? 'unknown'}, but ${error.message}`,
          }),
      ),
    );
    return replacement;
  });

export const removeDraft = (
  client: ImapFlow,
  folder: string,
  uid: number,
  uidValidity?: string,
): Effect.Effect<
  void,
  ImapError | DraftError | MessageNotFoundError | StaleUidError
> =>
  Effect.gen(function* () {
    const folders = yield* listFolders(client);
    const draftsFolder = yield* requireDraftsFolder(folders, folder);
    yield* deleteDraft(client, draftsFolder, uid, uidValidity);
  });
