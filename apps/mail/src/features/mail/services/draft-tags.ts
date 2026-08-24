import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { DraftError, ImapError, StaleUidError } from '../errors/errors';
import type { TagDraftsInput, TagDraftsResult } from '../schemas/mail';
import { requireDraftsFolder } from './draft';
import { listFolders } from './imap-ops';
import { lockMailbox } from './mailbox-lock';

const requireSupportedTag = (
  client: ImapFlow,
  folder: string,
  tagKey: string,
): Effect.Effect<void, DraftError> => {
  const permanentFlags =
    client.mailbox === false ? undefined : client.mailbox.permanentFlags;
  if (
    permanentFlags === undefined ||
    permanentFlags.has('\\*') ||
    permanentFlags.has(tagKey)
  ) {
    return Effect.void;
  }
  return Effect.fail(
    new DraftError({
      message: `the IMAP server does not allow tag key "${tagKey}" in "${folder}"`,
    }),
  );
};

const requireAllDrafts = (
  client: ImapFlow,
  folder: string,
  uids: ReadonlyArray<number>,
): Effect.Effect<void, DraftError | ImapError> =>
  Effect.gen(function* () {
    const messages = yield* Effect.tryPromise({
      try: () => client.fetchAll([...uids], { uid: true }, { uid: true }),
      catch: (cause) =>
        new ImapError({
          message: `look up drafts in "${folder}" failed: ${String(cause)}`,
        }),
    });
    const found = new Set(messages.map((message) => message.uid));
    const missing = uids.filter((uid) => !found.has(uid));
    if (missing.length > 0) {
      return yield* Effect.fail(
        new DraftError({
          message: `refusing to tag drafts because uids ${missing.join(', ')} were not found in "${folder}"; search the drafts folder again`,
        }),
      );
    }
  });

const requireCurrentUidValidity = (
  client: ImapFlow,
  folder: string,
  firstUid: number,
  expectedUidValidity: string,
): Effect.Effect<void, StaleUidError> => {
  const currentUidValidity =
    client.mailbox === false ? null : client.mailbox.uidValidity.toString();
  if (currentUidValidity === expectedUidValidity) {
    return Effect.void;
  }
  return Effect.fail(
    new StaleUidError({
      folder,
      uid: firstUid,
      message: `refusing to tag drafts: "${folder}" was reindexed (uidValidity ${expectedUidValidity} → ${currentUidValidity ?? 'unknown'}); search the drafts folder again`,
    }),
  );
};

export const tagDrafts = (
  client: ImapFlow,
  input: Omit<TagDraftsInput, 'account'>,
): Effect.Effect<TagDraftsResult, DraftError | ImapError | StaleUidError> =>
  Effect.gen(function* () {
    const { folder, uids, uidValidity, tagKey } = input;
    const folders = yield* listFolders(client);
    const draftsFolder = yield* requireDraftsFolder(folders, folder);
    const uniqueUids = [...new Set(uids)];
    const [firstUid] = uniqueUids;
    if (firstUid === undefined) {
      return yield* Effect.fail(
        new DraftError({ message: 'at least one draft uid is required' }),
      );
    }
    yield* lockMailbox(client, draftsFolder);
    yield* requireCurrentUidValidity(
      client,
      draftsFolder,
      firstUid,
      uidValidity,
    );
    yield* requireSupportedTag(client, draftsFolder, tagKey);
    yield* requireAllDrafts(client, draftsFolder, uniqueUids);
    const updated = yield* Effect.tryPromise({
      try: () => client.messageFlagsAdd(uniqueUids, [tagKey], { uid: true }),
      catch: (cause) =>
        new ImapError({
          message: `tag drafts in "${draftsFolder}" failed: ${String(cause)}`,
        }),
    });
    if (!updated) {
      return yield* Effect.fail(
        new ImapError({
          message: `tag drafts in "${draftsFolder}" failed: server rejected the update`,
        }),
      );
    }
    return {
      folder: draftsFolder,
      uids: uniqueUids,
      tagKey,
      tagged: uniqueUids.length,
    };
  }).pipe(Effect.scoped);
