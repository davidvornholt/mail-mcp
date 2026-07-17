import { Console, Effect } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { Imap } from '../features/mail/services/imap';
import type { ParsedSearchArgs } from './cli-args';

export const foldersCommand = (
  email: string,
): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    const imap = yield* Imap;
    const folders = yield* imap.listFolders(email);
    yield* Console.log(JSON.stringify(folders, null, 2));
  });

export const searchCommand = (
  email: string | undefined,
  input: Extract<ParsedSearchArgs, { readonly _tag: 'valid' }>['input'],
): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    const imap = yield* Imap;
    const hits = yield* imap.search(email, {
      ...input,
      limit: defaultSearchLimit,
    });
    yield* Console.log(JSON.stringify(hits, null, 2));
  });
