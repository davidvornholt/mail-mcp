import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { FetchMessageObject, ImapFlow, ListResponse } from 'imapflow';
import { searchMailboxes } from './imap-search';

type MailboxMessages = ReadonlyMap<string, ReadonlyArray<FetchMessageObject>>;

const listedFolder = (path: string, specialUse?: string): ListResponse => ({
  path,
  pathAsListed: path,
  name: path,
  delimiter: '/',
  parent: [],
  parentPath: '',
  flags: new Set(),
  specialUse,
  listed: true,
  subscribed: true,
});

const fakeClient = (
  folders: ReadonlyArray<ListResponse>,
  messages: MailboxMessages,
  events: Array<string>,
): ImapFlow => {
  let selectedFolder = '';
  return {
    list: () => {
      events.push('list');
      return Promise.resolve([...folders]);
    },
    getMailboxLock: (folder: string) => {
      selectedFolder = folder;
      events.push(`lock:${folder}`);
      return Promise.resolve({
        release: () => events.push(`release:${folder}`),
      });
    },
    search: () =>
      Promise.resolve(
        (messages.get(selectedFolder) ?? []).map(({ uid }) => uid),
      ),
    fetch: (uids: ReadonlyArray<number>) =>
      (async function* () {
        await Promise.resolve();
        const selectedUids = new Set(uids);
        for (const message of messages.get(selectedFolder) ?? []) {
          if (selectedUids.has(message.uid)) {
            yield message;
          }
        }
      })(),
  } as unknown as ImapFlow;
};

const message = (
  uid: number,
  date: string,
  messageId: string,
  emailId?: string,
): FetchMessageObject => ({
  seq: uid,
  uid,
  emailId,
  internalDate: new Date(date),
  envelope: {
    date: new Date(date),
    messageId,
    subject: messageId,
  },
});

describe('searchMailboxes', () => {
  it('searches an exact folder without listing mailboxes', async () => {
    const events: Array<string> = [];
    const client = fakeClient(
      [],
      new Map([
        ['INBOX', [message(1, '2026-07-13T08:00:00Z', '<one@example.com>')]],
      ]),
      events,
    );
    const hits = await Effect.runPromise(
      searchMailboxes(client, {
        scope: 'folder',
        folder: 'INBOX',
        query: 'one',
        limit: 20,
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.hit).toMatchObject({ folder: 'INBOX', uid: 1 });
    expect(events).toEqual(['lock:INBOX', 'release:INBOX']);
  });

  it('merges, deduplicates, sorts, and limits fallback folder results', async () => {
    const events: Array<string> = [];
    const folders = [
      listedFolder('INBOX', '\\Inbox'),
      listedFolder('Archive', '\\Archive'),
      listedFolder('Sent', '\\Sent'),
    ];
    const sentUid = 3;
    const client = fakeClient(
      folders,
      new Map([
        ['INBOX', [message(1, '2026-07-12T08:00:00Z', '<same@example.com>')]],
        ['Archive', [message(2, '2026-07-14T08:00:00Z', '<new@example.com>')]],
        [
          'Sent',
          [message(sentUid, '2026-07-13T08:00:00Z', '<same@example.com>')],
        ],
      ]),
      events,
    );
    const hits = await Effect.runPromise(
      searchMailboxes(client, { scope: 'all', query: 'mail', limit: 2 }),
    );
    expect(hits.map(({ hit: { folder, uid } }) => ({ folder, uid }))).toEqual([
      { folder: 'Archive', uid: 2 },
      { folder: 'Sent', uid: sentUid },
    ]);
    expect(events).toEqual([
      'list',
      'lock:INBOX',
      'release:INBOX',
      'lock:Archive',
      'release:Archive',
      'lock:Sent',
      'release:Sent',
    ]);
  });

  it('preserves case-distinct IMAP email IDs', async () => {
    const folders = [
      listedFolder('INBOX', '\\Inbox'),
      listedFolder('Archive', '\\Archive'),
    ];
    const client = fakeClient(
      folders,
      new Map([
        [
          'INBOX',
          [
            message(
              1,
              '2026-07-15T08:00:00Z',
              '<same@example.com>',
              'ObjectId',
            ),
          ],
        ],
        [
          'Archive',
          [
            message(
              2,
              '2026-07-16T08:00:00Z',
              '<same@example.com>',
              'objectid',
            ),
          ],
        ],
      ]),
      [],
    );

    const hits = await Effect.runPromise(
      searchMailboxes(client, { scope: 'all', query: 'mail', limit: 20 }),
    );

    expect(hits.map(({ hit: { uid } }) => uid)).toEqual([2, 1]);
  });
});
