import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { tagDrafts } from './draft-tags';

const draftFolders = [
  { path: 'INBOX', name: 'INBOX', specialUse: null, subscribed: true },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts', subscribed: true },
];
const draftsFolder = 'Drafts';
const tagKey = '$label1';
const existingUid = 7;
const missingUid = 8;
const secondUid = 9;
const expectedUidValidity = '111';
const defaultUidValidity = 111n;
const reindexedUidValidity = 222n;

type ClientOptions = {
  readonly found?: ReadonlyArray<number>;
  readonly permanentFlags?: ReadonlyArray<string>;
  readonly updateResult?: boolean;
  readonly uidValidity?: bigint;
};

const fakeClient = (
  events: Array<string>,
  options: ClientOptions = {},
): ImapFlow =>
  ({
    list: () => Promise.resolve(draftFolders),
    getMailboxLock: () => Promise.resolve({ release: () => undefined }),
    mailbox: {
      permanentFlags: new Set(options.permanentFlags ?? ['\\*']),
      uidValidity: options.uidValidity ?? defaultUidValidity,
    },
    fetchAll: (uids: ReadonlyArray<number>) =>
      Promise.resolve((options.found ?? uids).map((uid) => ({ uid }))),
    messageFlagsAdd: (
      uids: ReadonlyArray<number>,
      tags: ReadonlyArray<string>,
    ) => {
      events.push(`tag:${uids.join(',')}:${tags.join(',')}`);
      return Promise.resolve(options.updateResult ?? true);
    },
  }) as unknown as ImapFlow;

describe('tagDrafts', () => {
  it('validates and tags all unique draft uids in one update', async () => {
    const events: Array<string> = [];
    const result = await Effect.runPromise(
      tagDrafts(fakeClient(events), {
        folder: draftsFolder,
        uids: [existingUid, secondUid, existingUid],
        uidValidity: expectedUidValidity,
        tagKey,
      }),
    );

    expect(events).toEqual([`tag:${existingUid},${secondUid}:${tagKey}`]);
    const taggedUids = [existingUid, secondUid];
    expect(result).toEqual({
      folder: draftsFolder,
      uids: taggedUids,
      tagKey,
      tagged: taggedUids.length,
    });
  });

  it('reports every missing uid before changing flags', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient(events, { found: [existingUid] }), {
          folder: draftsFolder,
          uids: [existingUid, missingUid, secondUid],
          uidValidity: expectedUidValidity,
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain(`uids ${missingUid}, ${secondUid}`);
    expect(events).toEqual([]);
  });

  it('refuses a tag the server does not persist', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(
          fakeClient(events, { permanentFlags: ['\\Seen', '$label2'] }),
          {
            folder: draftsFolder,
            uids: [existingUid],
            uidValidity: expectedUidValidity,
            tagKey,
          },
        ),
      ),
    );

    expect(error._tag).toBe('DraftError');
    expect(error.message).toContain('does not allow tag');
    expect(events).toEqual([]);
  });

  it('reports when the server rejects the flag update', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient([], { updateResult: false }), {
          folder: draftsFolder,
          uids: [existingUid],
          uidValidity: expectedUidValidity,
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain('server rejected the update');
  });

  it('refuses messages outside the drafts folder', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient([]), {
          folder: 'INBOX',
          uids: [existingUid],
          uidValidity: expectedUidValidity,
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('DraftError');
  });

  it('refuses every update when the drafts mailbox was reindexed', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        tagDrafts(fakeClient(events, { uidValidity: reindexedUidValidity }), {
          folder: draftsFolder,
          uids: [existingUid, secondUid],
          uidValidity: expectedUidValidity,
          tagKey,
        }),
      ),
    );

    expect(error._tag).toBe('StaleUidError');
    expect(error.message).toContain('was reindexed');
    expect(events).toEqual([]);
  });
});
