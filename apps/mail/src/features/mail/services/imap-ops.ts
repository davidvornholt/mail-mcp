import { Effect } from 'effect';
import type { ImapFlow, ListResponse } from 'imapflow';
import { type AddressObject, type ParsedMail, simpleParser } from 'mailparser';
import { ImapError, MessageNotFoundError } from '../errors/errors';
import type { FolderInfo, FullMessage } from '../schemas/mail';

export const imapError =
  (label: string) =>
  (cause: unknown): ImapError =>
    new ImapError({ message: `${label} failed: ${String(cause)}` });

const addressText = (
  field: AddressObject | Array<AddressObject> | undefined,
): string => {
  if (field === undefined) {
    return '';
  }
  return Array.isArray(field)
    ? field.map((entry) => entry.text).join(', ')
    : field.text;
};

const toReferences = (
  references: string | Array<string> | undefined,
): ReadonlyArray<string> => {
  if (references === undefined) {
    return [];
  }
  return Array.isArray(references) ? references : [references];
};

const toFolderInfo = (folder: ListResponse): FolderInfo => ({
  path: folder.path,
  name: folder.name,
  specialUse: folder.specialUse ?? null,
  subscribed: folder.subscribed,
});

const toFullMessage = (
  parsed: ParsedMail,
  folder: string,
  uid: number,
): FullMessage => ({
  uid,
  folder,
  from: addressText(parsed.from),
  to: addressText(parsed.to),
  cc: addressText(parsed.cc),
  subject: parsed.subject ?? '',
  date: parsed.date?.toISOString() ?? '',
  messageId: parsed.messageId ?? '',
  inReplyTo: parsed.inReplyTo ?? '',
  references: toReferences(parsed.references),
  text: parsed.text ?? '',
  html: typeof parsed.html === 'string' ? parsed.html : null,
});

export const lockMailbox = (client: ImapFlow, folder: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => client.getMailboxLock(folder),
      catch: imapError(`lock ${folder}`),
    }),
    (lock) =>
      Effect.sync(() => {
        lock.release();
      }),
  );

export const listFolders = (
  client: ImapFlow,
): Effect.Effect<ReadonlyArray<FolderInfo>, ImapError> =>
  listMailboxes(client).pipe(
    Effect.map((folders) => folders.map(toFolderInfo)),
  );

export const listMailboxes = (
  client: ImapFlow,
): Effect.Effect<ReadonlyArray<ListResponse>, ImapError> =>
  Effect.tryPromise({
    try: () => client.list(),
    catch: imapError('list folders'),
  });

export const readMessage = (
  client: ImapFlow,
  folder: string,
  uid: number,
): Effect.Effect<FullMessage, ImapError | MessageNotFoundError> =>
  Effect.gen(function* () {
    yield* lockMailbox(client, folder);
    const message = yield* Effect.tryPromise({
      try: () =>
        client.fetchOne(
          String(uid),
          { uid: true, source: true, envelope: true },
          { uid: true },
        ),
      catch: imapError('fetch message'),
    });
    if (message === false || message.source === undefined) {
      return yield* Effect.fail(
        new MessageNotFoundError({
          folder,
          uid,
          message: `Message uid ${uid} not found in "${folder}"`,
        }),
      );
    }
    const { source } = message;
    const parsed = yield* Effect.tryPromise({
      try: () => simpleParser(source),
      catch: imapError('parse message'),
    });
    return toFullMessage(parsed, folder, uid);
  }).pipe(Effect.scoped);
