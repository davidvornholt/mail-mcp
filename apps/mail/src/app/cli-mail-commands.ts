import { Console, Effect } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { Imap } from '../features/mail/services/imap';

export const foldersCommand = (
  email: string,
): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    const imap = yield* Imap;
    const folders = yield* imap.listFolders(email);
    yield* Console.log(JSON.stringify(folders, null, 2));
  });

export const searchCommand = (
  email: string,
  terms: ReadonlyArray<string>,
): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    const imap = yield* Imap;
    const hits = yield* imap.search(email, {
      folder: 'INBOX',
      query: terms.length > 0 ? terms.join(' ') : undefined,
      limit: defaultSearchLimit,
    });
    yield* Console.log(JSON.stringify(hits, null, 2));
  });
