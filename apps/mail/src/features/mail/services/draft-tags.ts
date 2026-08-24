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
): Effect.Effect<string, DraftError> => {
  const permanentFlags =
    client.mailbox === false ? undefined : client.mailbox.permanentFlags;
  if (permanentFlags === undefined || permanentFlags.has('\\*')) {
    return Effect.succeed(tagKey);
  }
  const advertisedTag = [...permanentFlags].find(
    (flag) => flag.toLowerCase() === tagKey.toLowerCase(),
  );
  if (advertisedTag !== undefined) {
    return Effect.succeed(advertisedTag);
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

const requireAllTagged = (
  client: ImapFlow,
  folder: string,
  uids: ReadonlyArray<number>,
  tagKey: string,
): Effect.Effect<void, ImapError> =>
  Effect.gen(function* () {
    const messages = yield* Effect.tryPromise({
      try: () =>
        client.fetchAll([...uids], { uid: true, flags: true }, { uid: true }),
      catch: (cause) =>
        new ImapError({
          message: `verify tagged drafts in "${folder}" failed: ${String(cause)}`,
        }),
    });
    const byUid = new Map(messages.map((message) => [message.uid, message]));
    const missing = uids.filter((uid) => !byUid.has(uid));
    const untagged = uids.filter((uid) => {
      const message = byUid.get(uid);
      return (
        message !== undefined &&
        ![...(message.flags ?? [])].some(
          (flag) => flag.toLowerCase() === tagKey.toLowerCase(),
        )
      );
    });
    if (missing.length === 0 && untagged.length === 0) {
      return;
    }
    const details = [
      missing.length > 0 ? `missing uids ${missing.join(', ')}` : undefined,
      untagged.length > 0
        ? `tag absent from uids ${untagged.join(', ')}`
        : undefined,
    ].filter((detail): detail is string => detail !== undefined);
    return yield* Effect.fail(
      new ImapError({
        message: `tag drafts in "${folder}" was incomplete after the server update: ${details.join('; ')}`,
      }),
    );
  });

type DraftHandle = TagDraftsInput['drafts'][number];
type DraftSourceField = 'account' | 'folder' | 'uidValidity';

const rejectMixedHandles = (field: DraftSourceField) =>
  Effect.fail(
    new DraftError({
      message: `refusing to tag drafts with mixed ${field} handles; search the drafts folder again`,
    }),
  );

export const requireOneDraftSource = (
  drafts: ReadonlyArray<DraftHandle>,
): Effect.Effect<DraftHandle, DraftError> => {
  const [firstDraft] = drafts;
  if (firstDraft === undefined) {
    return Effect.fail(
      new DraftError({ message: 'at least one draft handle is required' }),
    );
  }
  if (drafts.some(({ account }) => account !== firstDraft.account)) {
    return rejectMixedHandles('account');
  }
  if (drafts.some(({ folder }) => folder !== firstDraft.folder)) {
    return rejectMixedHandles('folder');
  }
  if (
    drafts.some(({ uidValidity }) => uidValidity !== firstDraft.uidValidity)
  ) {
    return rejectMixedHandles('uidValidity');
  }
  return Effect.succeed(firstDraft);
};

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
  input: TagDraftsInput,
): Effect.Effect<TagDraftsResult, DraftError | ImapError | StaleUidError> =>
  Effect.gen(function* () {
    const { drafts, tagKey } = input;
    const firstDraft = yield* requireOneDraftSource(drafts);
    const folders = yield* listFolders(client);
    const draftsFolder = yield* requireDraftsFolder(folders, firstDraft.folder);
    const uniqueDrafts = [
      ...new Map(drafts.map((draft) => [draft.uid, draft])).values(),
    ];
    const uniqueUids = uniqueDrafts.map(({ uid }) => uid);
    yield* lockMailbox(client, draftsFolder);
    yield* requireCurrentUidValidity(
      client,
      draftsFolder,
      firstDraft.uid,
      firstDraft.uidValidity,
    );
    const storedTagKey = yield* requireSupportedTag(
      client,
      draftsFolder,
      tagKey,
    );
    yield* requireAllDrafts(client, draftsFolder, uniqueUids);
    const updated = yield* Effect.tryPromise({
      try: () =>
        client.messageFlagsAdd(uniqueUids, [storedTagKey], { uid: true }),
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
    yield* requireAllTagged(client, draftsFolder, uniqueUids, storedTagKey);
    return {
      drafts: uniqueDrafts,
      tagKey: storedTagKey,
      tagged: uniqueUids.length,
    };
  }).pipe(Effect.scoped);
