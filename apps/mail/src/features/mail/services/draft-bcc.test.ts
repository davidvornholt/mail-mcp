import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Account } from '../schemas/account';
import type { UpdateDraftInput } from '../schemas/mail';
import { replaceDraft } from './draft';
import { readMessage } from './imap-ops';

const account: Account = {
  email: 'sender@example.com',
  name: 'Example Sender',
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'sender@example.com',
};
const existingBcc = 'hidden@example.com';
const draftSource = Buffer.from(
  [
    'From: sender@example.com',
    'To: recipient@example.com',
    `Bcc: ${existingBcc}`,
    'Subject: Original',
    '',
    'Original body',
  ].join('\r\n'),
);
const draftFolders = [
  { path: 'INBOX', name: 'INBOX', specialUse: null, subscribed: true },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts', subscribed: true },
];
const input: UpdateDraftInput = {
  account: account.email,
  folder: 'Drafts',
  uid: 7,
  to: 'recipient@example.com',
  subject: 'Updated',
  text: 'Updated body',
};

const clientWith = (appended: Array<Buffer>): ImapFlow =>
  ({
    list: () => Promise.resolve(draftFolders),
    append: (_folder: string, raw: Buffer) => {
      appended.push(raw);
      return Promise.resolve({ uid: 42, uidValidity: 111n });
    },
    getMailboxLock: () => Promise.resolve({ release: () => undefined }),
    fetchOne: () => Promise.resolve({ uid: input.uid, source: draftSource }),
    messageDelete: () => Promise.resolve(true),
  }) as unknown as ImapFlow;

const parseReplacement = async (update: UpdateDraftInput) => {
  const appended: Array<Buffer> = [];
  await Effect.runPromise(replaceDraft(clientWith(appended), account, update));
  const [raw] = appended;
  if (raw === undefined) {
    throw new Error('expected one appended draft');
  }
  return await simpleParser(raw);
};

describe('draft Bcc lifecycle', () => {
  it('returns Bcc recipients when reading stored draft MIME', async () => {
    const message = await Effect.runPromise(
      readMessage(clientWith([]), input.folder, input.uid),
    );

    expect(message.bcc).toBe(existingBcc);
  });

  it('preserves existing Bcc recipients when an update omits bcc', async () => {
    const parsed = await parseReplacement(input);
    const parsedBcc = Array.isArray(parsed.bcc) ? parsed.bcc[0] : parsed.bcc;

    expect(parsedBcc?.text).toBe(existingBcc);
  });

  it('removes existing Bcc recipients when an update passes an empty bcc', async () => {
    const parsed = await parseReplacement({ ...input, bcc: '' });

    expect(parsed.bcc).toBeUndefined();
  });
});
