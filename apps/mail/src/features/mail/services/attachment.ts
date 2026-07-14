import { Chunk, Effect, Stream } from 'effect';
import type { ImapFlow } from 'imapflow';
import {
  AttachmentNotFoundError,
  AttachmentTooLargeError,
  ImapError,
  MessageNotFoundError,
} from '../errors/errors';
import type { AttachmentContent } from '../schemas/mail';
import {
  bodyStructureSizeIsDecoded,
  findAttachmentNode,
} from './attachment-metadata';
import { lockMailbox } from './mailbox-lock';

const bytesPerKibibyte = 1024;
const kibibytesPerMebibyte = 1024;
const maxAttachmentMebibytes = 10;
export const maxAttachmentBytes =
  maxAttachmentMebibytes * bytesPerKibibyte * kibibytesPerMebibyte;

const toBuffer = (chunk: unknown): Effect.Effect<Buffer, ImapError> => {
  if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
    return Effect.succeed(Buffer.from(chunk));
  }
  return Effect.fail(
    new ImapError({ message: 'read attachment returned a non-binary chunk' }),
  );
};

const collectContent = (content: AsyncIterable<unknown>) =>
  Stream.fromAsyncIterable(
    content,
    (cause) =>
      new ImapError({
        message: `read attachment stream failed: ${String(cause)}`,
      }),
  ).pipe(
    Stream.mapEffect(toBuffer),
    Stream.runCollect,
    Effect.map((chunks) => Buffer.concat(Chunk.toReadonlyArray(chunks))),
  );

const contentTypeOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value !== '' ? value : fallback;

const tooLarge = (
  folder: string,
  uid: number,
  part: string,
  size: number,
): AttachmentTooLargeError =>
  new AttachmentTooLargeError({
    folder,
    uid,
    part,
    size,
    limit: maxAttachmentBytes,
    message: `Attachment part ${part} in message uid ${uid} is ${size} bytes; the read limit is ${maxAttachmentBytes} bytes, so download it in Thunderbird instead`,
  });

export const readAttachment = (
  client: ImapFlow,
  folder: string,
  uid: number,
  part: string,
) =>
  Effect.gen(function* () {
    yield* lockMailbox(client, folder);
    const message = yield* Effect.tryPromise({
      try: () =>
        client.fetchOne(
          String(uid),
          { uid: true, bodyStructure: true },
          { uid: true },
        ),
      catch: (cause) =>
        new ImapError({
          message: `fetch attachment metadata failed: ${String(cause)}`,
        }),
    });
    if (message === false) {
      return yield* Effect.fail(
        new MessageNotFoundError({
          folder,
          uid,
          message: `Message uid ${uid} not found in "${folder}"`,
        }),
      );
    }
    const located = findAttachmentNode(message.bodyStructure, part);
    if (located === undefined) {
      return yield* Effect.fail(
        new AttachmentNotFoundError({
          folder,
          uid,
          part,
          message: `Attachment part ${part} not found in message uid ${uid} in "${folder}"; call read_message again to refresh its attachment handles`,
        }),
      );
    }
    const { attachment, node } = located;
    if (
      attachment.size !== null &&
      bodyStructureSizeIsDecoded(node.encoding) &&
      attachment.size > maxAttachmentBytes
    ) {
      return yield* Effect.fail(tooLarge(folder, uid, part, attachment.size));
    }
    const download = yield* Effect.tryPromise({
      try: () =>
        client.download(String(uid), part, {
          uid: true,
          maxBytes: maxAttachmentBytes + 1,
        }),
      catch: (cause) =>
        new ImapError({
          message: `download attachment part ${part} failed: ${String(cause)}`,
        }),
    });
    if (download.meta === undefined || download.content === undefined) {
      return yield* Effect.fail(
        new AttachmentNotFoundError({
          folder,
          uid,
          part,
          message: `Attachment part ${part} could not be downloaded from message uid ${uid} in "${folder}"; call read_message again to refresh its attachment handles`,
        }),
      );
    }
    const content = yield* collectContent(
      download.content as AsyncIterable<unknown>,
    );
    if (content.byteLength > maxAttachmentBytes) {
      return yield* Effect.fail(
        tooLarge(folder, uid, part, content.byteLength),
      );
    }
    return {
      ...attachment,
      filename: download.meta.filename ?? attachment.filename,
      contentType: contentTypeOr(
        download.meta.contentType,
        attachment.contentType,
      ),
      size: content.byteLength,
      content,
    } satisfies AttachmentContent;
  }).pipe(Effect.scoped);
