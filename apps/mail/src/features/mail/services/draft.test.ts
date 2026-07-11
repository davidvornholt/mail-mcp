import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { simpleParser } from 'mailparser';
import type { Account } from '../schemas/account';
import { buildMime, requireDraftsFolder } from './draft';

const account: Account = {
  email: 'sender@example.com',
  name: 'Example Sender',
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'sender@example.com',
};

describe('buildMime', () => {
  it('preserves authored plain-text line breaks without quoted-printable wrapping', async () => {
    const repetitionsPastTransferLineLength = 12;
    const text = 'A deliberately long paragraph '
      .repeat(repetitionsPastTransferLineLength)
      .trim();
    const raw = await Effect.runPromise(
      buildMime(account, {
        account: account.email,
        to: 'recipient@example.com',
        subject: 'Long line',
        text,
      }),
    );
    const parsed = await simpleParser(raw);

    expect(raw.toString()).toContain('Content-Transfer-Encoding: base64');
    expect(parsed.text?.trimEnd()).toBe(text);
  });

  it('builds HTML alternatives and file attachments', async () => {
    const attachmentPath = Bun.fileURLToPath(
      new URL('attachment.fixture.txt', import.meta.url),
    );
    const raw = await Effect.runPromise(
      buildMime(account, {
        account: account.email,
        to: 'recipient@example.com',
        subject: 'Rich message',
        text: 'Plain fallback',
        html: '<p><strong>Rich</strong> message</p>',
        attachments: [{ path: attachmentPath, filename: 'notes.txt' }],
      }),
    );
    const parsed = await simpleParser(raw);

    expect(parsed.text?.trim()).toBe('Plain fallback');
    expect(parsed.html).toContain('<strong>Rich</strong>');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe('notes.txt');
    expect(parsed.attachments[0]?.content.toString().trim()).toBe(
      'attachment contents',
    );
  });
});

describe('requireDraftsFolder', () => {
  const folders = [
    {
      path: 'INBOX',
      name: 'INBOX',
      specialUse: null,
      subscribed: true,
    },
    {
      path: 'Drafts',
      name: 'Drafts',
      specialUse: '\\Drafts',
      subscribed: true,
    },
  ];

  it('accepts the selected drafts folder', async () => {
    await expect(
      Effect.runPromise(requireDraftsFolder(folders, 'Drafts')),
    ).resolves.toBe('Drafts');
  });

  it('refuses folders outside drafts', async () => {
    const error = await Effect.runPromise(
      Effect.flip(requireDraftsFolder(folders, 'INBOX')),
    );
    expect(error._tag).toBe('DraftError');
  });
});
