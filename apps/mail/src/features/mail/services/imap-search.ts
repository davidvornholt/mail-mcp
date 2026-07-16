import { Chunk, Effect, Stream } from 'effect';
import type { FetchMessageObject, ImapFlow } from 'imapflow';
import type { ImapError } from '../errors/errors';
import type { SearchHit, SearchOptions } from '../schemas/mail';
import { imapError, listMailboxes } from './imap-ops';
import { buildSearchQuery } from './imap-query';
import { lockMailbox } from './mailbox-lock';
import { selectSearchFolders } from './search-folders';

export type MailboxSearchHit = {
  readonly hit: Omit<SearchHit, 'account'>;
  readonly mailboxDeduplicationId: string;
  readonly messageId: string;
  readonly receivedAt: string;
};

const joinAddresses = (
  list: ReadonlyArray<{ readonly address?: string }> | undefined,
): string =>
  (list ?? [])
    .map((entry) => entry.address)
    .filter((address): address is string => address !== undefined)
    .join(', ');

const toIsoDate = (value: Date | string | undefined): string =>
  value instanceof Date ? value.toISOString() : (value ?? '');

const toCandidate = (
  message: FetchMessageObject,
  folder: string,
): MailboxSearchHit => {
  const { envelope } = message;
  return {
    hit: {
      uid: message.uid,
      folder,
      from: joinAddresses(envelope?.from),
      to: joinAddresses(envelope?.to),
      subject: envelope?.subject ?? '',
      date: toIsoDate(envelope?.date ?? message.internalDate),
    },
    mailboxDeduplicationId: message.emailId ?? envelope?.messageId ?? '',
    messageId: envelope?.messageId ?? '',
    receivedAt: toIsoDate(message.internalDate ?? envelope?.date),
  };
};

const searchOneFolder = (
  client: ImapFlow,
  folder: string,
  options: SearchOptions,
): Effect.Effect<ReadonlyArray<MailboxSearchHit>, ImapError> =>
  Effect.gen(function* () {
    yield* lockMailbox(client, folder);
    const found = yield* Effect.tryPromise({
      try: () => client.search(buildSearchQuery(options), { uid: true }),
      catch: imapError(`search ${folder}`),
    });
    const uids = found === false ? [] : found;
    const selected = uids.slice(-options.limit).reverse();
    if (selected.length === 0) {
      return [];
    }
    const messages = yield* Stream.runCollect(
      Stream.fromAsyncIterable(
        client.fetch(
          selected,
          { uid: true, envelope: true, internalDate: true },
          { uid: true },
        ),
        imapError(`fetch search results from ${folder}`),
      ),
    );
    return Chunk.toReadonlyArray(messages).map((message) =>
      toCandidate(message, folder),
    );
  }).pipe(Effect.scoped);

const newestFirst = (left: MailboxSearchHit, right: MailboxSearchHit): number =>
  right.receivedAt.localeCompare(left.receivedAt) ||
  right.hit.uid - left.hit.uid ||
  left.hit.folder.localeCompare(right.hit.folder);

const uniqueCandidates = (
  candidates: ReadonlyArray<MailboxSearchHit>,
): ReadonlyArray<MailboxSearchHit> => {
  const seenMessageIds = new Set<string>();
  return candidates.filter((candidate) => {
    const messageId = candidate.mailboxDeduplicationId.trim().toLowerCase();
    if (messageId === '') {
      return true;
    }
    if (seenMessageIds.has(messageId)) {
      return false;
    }
    seenMessageIds.add(messageId);
    return true;
  });
};

const foldersForSearch = (client: ImapFlow, options: SearchOptions) =>
  options.scope === 'folder'
    ? Effect.succeed([options.folder])
    : Effect.flatMap(listMailboxes(client), (folders) =>
        selectSearchFolders(folders, options),
      );

export const searchMailboxes = (client: ImapFlow, options: SearchOptions) =>
  Effect.gen(function* () {
    const folders = yield* foldersForSearch(client, options);
    const matches = yield* Effect.forEach(folders, (folder) =>
      searchOneFolder(client, folder, options),
    );
    const sorted = matches.flat().sort(newestFirst);
    const candidates =
      options.scope === 'folder' ? sorted : uniqueCandidates(sorted);
    return candidates.slice(0, options.limit);
  });
