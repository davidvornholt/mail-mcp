import { Effect } from 'effect';
import type { ImapFlow, ListResponse } from 'imapflow';
import { type AddressObject, type ParsedMail, simpleParser } from 'mailparser';
import { ImapError, MessageNotFoundError } from '../errors/errors';
import type { FolderInfo, FullMessage } from '../schemas/mail';
import { listAttachments } from './attachment-metadata';
import { lockMailbox } from './mailbox-lock';

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

const rawHeaderValue = (parsed: ParsedMail, key: string): string => {
  const line = parsed.headerLines.find((header) => header.key === key)?.line;
  if (line === undefined) {
    return '';
  }
  const separator = line.indexOf(':');
  return separator === -1 ? '' : line.slice(separator + 1).trim();
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
  attributionDate: rawHeaderValue(parsed, 'date'),
  messageId: parsed.messageId ?? '',
  inReplyTo: parsed.inReplyTo ?? '',
  references: toReferences(parsed.references),
  text: parsed.text ?? '',
  html: typeof parsed.html === 'string' ? parsed.html : null,
  attachments: [],
});

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
          { uid: true, source: true, envelope: true, bodyStructure: true },
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
    return {
      ...toFullMessage(parsed, folder, uid),
      attachments: listAttachments(message.bodyStructure),
    };
  }).pipe(Effect.scoped);
