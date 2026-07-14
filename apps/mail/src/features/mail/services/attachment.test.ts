import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { ImapFlow, MessageStructureObject } from 'imapflow';
import { maxAttachmentBytes, readAttachment } from './attachment';

const messageUid = 42;
const attachmentPart = '2';
const pdfContent = 'pdf bytes';
const attachmentStructure: MessageStructureObject = {
  type: 'multipart/mixed',
  childNodes: [
    {
      part: attachmentPart,
      type: 'application/pdf',
      encoding: 'base64',
      disposition: 'attachment',
      dispositionParameters: { filename: 'invoice.pdf' },
      size: maxAttachmentBytes + 1,
    },
  ],
};

const mailboxLock = (released: { value: boolean }) => () =>
  Promise.resolve({
    release: () => {
      released.value = true;
    },
  });

describe('readAttachment', () => {
  it('downloads only the selected decoded body part', async () => {
    const released = { value: false };
    const calls: Array<ReadonlyArray<unknown>> = [];
    const client = {
      getMailboxLock: mailboxLock(released),
      fetchOne: () =>
        Promise.resolve({
          uid: messageUid,
          bodyStructure: attachmentStructure,
        }),
      download: (...args: ReadonlyArray<unknown>) => {
        calls.push(args);
        return Promise.resolve({
          meta: {
            expectedSize: 10_000_000,
            contentType: 'application/pdf',
            filename: 'invoice.pdf',
          },
          content: new Blob([pdfContent]).stream(),
        });
      },
    } as unknown as ImapFlow;

    const result = await Effect.runPromise(
      readAttachment(client, 'INBOX', messageUid, attachmentPart),
    );

    expect(calls).toEqual([
      [
        String(messageUid),
        attachmentPart,
        { uid: true, maxBytes: maxAttachmentBytes + 1 },
      ],
    ]);
    expect(Buffer.from(result.content).toString()).toBe(pdfContent);
    expect(result.size).toBe(Buffer.byteLength(pdfContent));
    expect(released.value).toBe(true);
  });

  it('rejects unknown and oversized decoded parts before downloading', async () => {
    let downloads = 0;
    const oversized: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        {
          part: attachmentPart,
          type: 'application/octet-stream',
          encoding: 'binary',
          disposition: 'attachment',
          size: maxAttachmentBytes + 1,
        },
      ],
    };
    const client = {
      getMailboxLock: mailboxLock({ value: false }),
      fetchOne: () =>
        Promise.resolve({ uid: messageUid, bodyStructure: oversized }),
      download: () => {
        downloads += 1;
        return Promise.resolve({});
      },
    } as unknown as ImapFlow;

    const missing = await Effect.runPromise(
      Effect.flip(readAttachment(client, 'INBOX', messageUid, '9')),
    );
    const tooLarge = await Effect.runPromise(
      Effect.flip(readAttachment(client, 'INBOX', messageUid, attachmentPart)),
    );

    expect(missing._tag).toBe('AttachmentNotFoundError');
    expect(tooLarge._tag).toBe('AttachmentTooLargeError');
    expect(downloads).toBe(0);
  });
});

describe('readAttachment download results', () => {
  it('catches decoded content that exceeds the advertised size', async () => {
    const client = {
      getMailboxLock: mailboxLock({ value: false }),
      fetchOne: () =>
        Promise.resolve({
          uid: messageUid,
          bodyStructure: attachmentStructure,
        }),
      download: () =>
        Promise.resolve({
          meta: { expectedSize: 1, contentType: 'application/pdf' },
          content: new Blob([new Uint8Array(maxAttachmentBytes + 1)]).stream(),
        }),
    } as unknown as ImapFlow;

    const error = await Effect.runPromise(
      Effect.flip(readAttachment(client, 'INBOX', messageUid, attachmentPart)),
    );

    expect(error._tag).toBe('AttachmentTooLargeError');
  });

  it('reports a missing attachment when ImapFlow returns no download', async () => {
    const client = {
      getMailboxLock: mailboxLock({ value: false }),
      fetchOne: () =>
        Promise.resolve({
          uid: messageUid,
          bodyStructure: attachmentStructure,
        }),
      download: () => Promise.resolve({}),
    } as unknown as ImapFlow;

    const error = await Effect.runPromise(
      Effect.flip(readAttachment(client, 'INBOX', messageUid, attachmentPart)),
    );

    expect(error._tag).toBe('AttachmentNotFoundError');
  });

  it('keeps the BODYSTRUCTURE type when downloaded MIME headers omit it', async () => {
    const client = {
      getMailboxLock: mailboxLock({ value: false }),
      fetchOne: () =>
        Promise.resolve({
          uid: messageUid,
          bodyStructure: attachmentStructure,
        }),
      download: () =>
        Promise.resolve({
          meta: { expectedSize: Buffer.byteLength(pdfContent) },
          content: new Blob([pdfContent]).stream(),
        }),
    } as unknown as ImapFlow;

    const result = await Effect.runPromise(
      readAttachment(client, 'INBOX', messageUid, attachmentPart),
    );

    expect(result.contentType).toBe('application/pdf');
  });
});
