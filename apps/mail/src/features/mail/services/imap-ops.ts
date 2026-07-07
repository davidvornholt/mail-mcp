import { Chunk, Effect, Stream } from 'effect';
import type { FetchMessageObject, ImapFlow, ListResponse } from 'imapflow';
import { type AddressObject, type ParsedMail, simpleParser } from 'mailparser';
import { ImapError, MessageNotFoundError } from '../errors/errors';
import type {
  FolderInfo,
  FullMessage,
  SearchHit,
  SearchOptions,
} from '../schemas/mail';
import { buildSearchQuery } from './imap-query';

const imapError =
  (label: string) =>
  (cause: unknown): ImapError =>
    new ImapError({ message: `${label} failed: ${String(cause)}` });

const joinAddresses = (
  list: ReadonlyArray<{ readonly address?: string }> | undefined,
): string =>
  (list ?? [])
    .map((entry) => entry.address)
    .filter((address): address is string => address !== undefined)
    .join(', ');

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

const toIsoDate = (value: Date | string | undefined): string =>
  value instanceof Date ? value.toISOString() : (value ?? '');

const toFolderInfo = (folder: ListResponse): FolderInfo => ({
  path: folder.path,
  name: folder.name,
  specialUse: folder.specialUse ?? null,
  subscribed: folder.subscribed,
});

const toSearchHit = (
  message: FetchMessageObject,
  folder: string,
): SearchHit => {
  const { envelope } = message;
  return {
    uid: message.uid,
    folder,
    from: joinAddresses(envelope?.from),
    to: joinAddresses(envelope?.to),
    subject: envelope?.subject ?? '',
    date: toIsoDate(envelope?.date ?? message.internalDate),
  };
};

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
  references: toReferences(parsed.references),
  text: parsed.text ?? '',
  html: typeof parsed.html === 'string' ? parsed.html : null,
});

const lockMailbox = (client: ImapFlow, folder: string) =>
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
  Effect.tryPromise({
    try: () => client.list(),
    catch: imapError('list folders'),
  }).pipe(Effect.map((folders) => folders.map(toFolderInfo)));

export const searchMailbox = (
  client: ImapFlow,
  options: SearchOptions,
): Effect.Effect<ReadonlyArray<SearchHit>, ImapError> =>
  Effect.gen(function* () {
    yield* lockMailbox(client, options.folder);
    const found = yield* Effect.tryPromise({
      try: () => client.search(buildSearchQuery(options), { uid: true }),
      catch: imapError('search'),
    });
    const uids = found === false ? [] : found;
    if (uids.length === 0) {
      return [];
    }
    const selected = uids.slice(-options.limit).reverse();
    const messages = yield* Stream.runCollect(
      Stream.fromAsyncIterable(
        client.fetch(
          selected,
          { uid: true, envelope: true, internalDate: true },
          { uid: true },
        ),
        imapError('fetch'),
      ),
    );
    return Chunk.toReadonlyArray(messages).map((message) =>
      toSearchHit(message, options.folder),
    );
  }).pipe(Effect.scoped);

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
