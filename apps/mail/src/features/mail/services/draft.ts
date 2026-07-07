import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { DraftError, ImapError } from '../errors/errors';
import type { Account } from '../schemas/account';
import type { DraftInput } from '../schemas/mail';
import { selectDraftsFolder } from './draft-folder';
import { listFolders } from './imap-ops';

const buildMime = (
  account: Account,
  input: DraftInput,
): Effect.Effect<Buffer, DraftError> =>
  Effect.tryPromise({
    try: () =>
      new MailComposer({
        from: `"${account.name}" <${account.email}>`,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.text,
        inReplyTo: input.inReplyTo,
        references:
          input.references === undefined ? undefined : [...input.references],
      })
        .compile()
        .build(),
    catch: (cause) =>
      new DraftError({ message: `failed to build draft: ${String(cause)}` }),
  });

export const writeDraft = (
  client: ImapFlow,
  account: Account,
  input: DraftInput,
): Effect.Effect<string, ImapError | DraftError> =>
  Effect.gen(function* () {
    const folders = yield* listFolders(client);
    const folder = selectDraftsFolder(folders);
    const raw = yield* buildMime(account, input);
    yield* Effect.tryPromise({
      try: () => client.append(folder, raw, ['\\Draft']),
      catch: (cause) =>
        new ImapError({
          message: `append draft to ${folder} failed: ${String(cause)}`,
        }),
    });
    return folder;
  });
