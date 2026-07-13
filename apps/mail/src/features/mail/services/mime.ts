import { Effect } from 'effect';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { DraftError } from '../errors/errors';
import type { Account } from '../schemas/account';
import type { DraftInput, FullMessage } from '../schemas/mail';
import { buildReplyContent } from './reply-quote';
import { textToHtml } from './text-to-html';

export const buildMime = (
  account: Account,
  input: DraftInput,
  repliedTo: FullMessage | undefined,
): Effect.Effect<Buffer, DraftError> =>
  Effect.tryPromise({
    try: () => {
      const html = input.html ?? textToHtml(input.text);
      const content =
        repliedTo === undefined
          ? {
              text: input.text,
              html,
              inReplyTo: input.inReplyTo,
              references: input.references,
            }
          : buildReplyContent(input.text, html, repliedTo);
      return new MailComposer({
        from: `"${account.name}" <${account.email}>`,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: content.text,
        html: content.html,
        attachments: input.attachments?.map((attachment) => ({
          path: attachment.path,
          filename: attachment.filename,
          contentType: attachment.contentType,
          cid: attachment.cid,
        })),
        textEncoding: 'base64',
        disableUrlAccess: true,
        inReplyTo: content.inReplyTo,
        references:
          content.references === undefined
            ? undefined
            : [...content.references],
      })
        .compile()
        .build();
    },
    catch: (cause) =>
      new DraftError({ message: `failed to build draft: ${String(cause)}` }),
  });
