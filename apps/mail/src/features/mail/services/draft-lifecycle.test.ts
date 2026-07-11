import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import type { Account } from '../schemas/account';
import { removeDraft, replaceDraft } from './draft';

const account: Account = {
  email: 'sender@example.com',
  name: 'Example Sender',
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'sender@example.com',
};

const draftFolders = [
  { path: 'INBOX', name: 'INBOX', specialUse: null, subscribed: true },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts', subscribed: true },
];

const targetUid = 7;

describe('replaceDraft', () => {
  const fakeClient = (
    events: Array<string>,
    options: { readonly deleteResult?: boolean } = {},
  ): ImapFlow =>
    ({
      list: () => Promise.resolve(draftFolders),
      append: (_folder: string, _raw: Buffer, flags: ReadonlyArray<string>) => {
        events.push(`append:${[...flags].join(',')}`);
        return Promise.resolve({ uid: 42, uidValidity: 111n });
      },
      getMailboxLock: () => Promise.resolve({ release: () => undefined }),
      fetchOne: () => Promise.resolve({ uid: targetUid }),
      messageDelete: () => {
        events.push('delete');
        return Promise.resolve(options.deleteResult ?? true);
      },
    }) as unknown as ImapFlow;

  const input = {
    account: account.email,
    folder: 'Drafts',
    uid: targetUid,
    to: 'recipient@example.com',
    subject: 'Updated',
    text: 'Updated body',
  };

  it('appends a \\Seen replacement before deleting the old draft and returns its uidValidity', async () => {
    const events: Array<string> = [];
    const location = await Effect.runPromise(
      replaceDraft(fakeClient(events), account, input),
    );

    expect(events).toEqual(['append:\\Draft,\\Seen', 'delete']);
    expect(location).toEqual({ folder: 'Drafts', uid: 42, uidValidity: '111' });
  });

  it('keeps the appended replacement and reports its uid when the delete fails', async () => {
    const events: Array<string> = [];
    const error = await Effect.runPromise(
      Effect.flip(
        replaceDraft(
          fakeClient(events, { deleteResult: false }),
          account,
          input,
        ),
      ),
    );

    expect(events).toContain('append:\\Draft,\\Seen');
    expect(error._tag).toBe('ImapError');
    expect(error.message).toContain('saved as uid 42');
  });

  it('maps a non-UIDPLUS append with no uid/uidValidity to null handles', async () => {
    const client = {
      list: () => Promise.resolve(draftFolders),
      append: () => Promise.resolve({ destination: 'Drafts' }),
      getMailboxLock: () => Promise.resolve({ release: () => undefined }),
      fetchOne: () => Promise.resolve({ uid: targetUid }),
      messageDelete: () => Promise.resolve(true),
    } as unknown as ImapFlow;

    const location = await Effect.runPromise(
      replaceDraft(client, account, input),
    );

    expect(location).toEqual({
      folder: 'Drafts',
      uid: null,
      uidValidity: null,
    });
  });
});

describe('removeDraft', () => {
  it('fails with MessageNotFoundError when the target draft uid does not exist', async () => {
    const client = {
      list: () => Promise.resolve(draftFolders),
      getMailboxLock: () => Promise.resolve({ release: () => undefined }),
      fetchOne: () => Promise.resolve(false),
      messageDelete: () => Promise.resolve(true),
    } as unknown as ImapFlow;

    const missingUid = 999;
    const error = await Effect.runPromise(
      Effect.flip(removeDraft(client, 'Drafts', missingUid)),
    );

    expect(error._tag).toBe('MessageNotFoundError');
  });

  it('refuses to expunge, without deleting, when the folder uidValidity no longer matches the handle', async () => {
    const events: Array<string> = [];
    const client = {
      list: () => Promise.resolve(draftFolders),
      getMailboxLock: () => Promise.resolve({ release: () => undefined }),
      mailbox: { uidValidity: 222n },
      fetchOne: () => Promise.resolve({ uid: targetUid }),
      messageDelete: () => {
        events.push('delete');
        return Promise.resolve(true);
      },
    } as unknown as ImapFlow;

    const error = await Effect.runPromise(
      Effect.flip(removeDraft(client, 'Drafts', targetUid, '111')),
    );

    expect(error._tag).toBe('StaleUidError');
    expect(events).toEqual([]);
  });

  it('expunges when the folder uidValidity still matches the handle', async () => {
    const events: Array<string> = [];
    const client = {
      list: () => Promise.resolve(draftFolders),
      getMailboxLock: () => Promise.resolve({ release: () => undefined }),
      mailbox: { uidValidity: 111n },
      fetchOne: () => Promise.resolve({ uid: targetUid }),
      messageDelete: () => {
        events.push('delete');
        return Promise.resolve(true);
      },
    } as unknown as ImapFlow;

    await Effect.runPromise(removeDraft(client, 'Drafts', targetUid, '111'));

    expect(events).toEqual(['delete']);
  });
});
