import { Console, Effect } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { accountEmails, findAccount } from '../features/mail/schemas/account';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { Imap } from '../features/mail/services/imap';
import { Secrets } from '../features/mail/services/secrets';
import { at, parseFlags } from '../shared/args';
import { promptHidden } from '../shared/terminal';
import { appLayer } from './runtime';

const cliArgs: ReadonlyArray<string> = Bun.argv.slice(2);
const command: string = at(cliArgs, 0) ?? '';
const account = at(cliArgs, 1);
const tail = cliArgs.slice(2);
const knownAccounts = accountEmails.join(', ');

const usage = `mail — draft-only IMAP helper

Commands:
  mail login <email>                       store password in the OS keyring (hidden prompt)
  mail accounts                            list configured accounts
  mail folders <email>                     list folders
  mail search <email> <query...>           search (newest first)
  mail read <email> <folder> <uid>         print one message
  mail draft <email> --to <addr> --subject <s> [--cc <addr>] [--in-reply-to <id>]   body from stdin

Accounts: ${knownAccounts}`;

const badAccount = (): Effect.Effect<void> =>
  Console.error(`Unknown or missing account. Known: ${knownAccounts}`);

const loginCommand = (email: string): Effect.Effect<void, MailError, Secrets> =>
  Effect.gen(function* () {
    const password = yield* promptHidden(
      `Password for ${email} (input hidden): `,
    );
    if (password === '') {
      yield* Console.error('Empty password — aborted.');
      return;
    }
    const secrets = yield* Secrets;
    yield* secrets.setPassword(email, password);
    yield* Console.log(
      `Stored password for ${email} in the OS keyring (service "mail-mcp").`,
    );
  });

const foldersCommand = (email: string): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    const imap = yield* Imap;
    const folders = yield* imap.listFolders(email);
    yield* Console.log(JSON.stringify(folders, null, 2));
  });

const searchCommand = (
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

const readCommand = (
  email: string,
  folder: string | undefined,
  uid: string | undefined,
): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    if (folder === undefined || uid === undefined) {
      yield* Console.error('Usage: mail read <email> <folder> <uid>');
      return;
    }
    const imap = yield* Imap;
    const message = yield* imap.read(email, folder, Number(uid));
    yield* Console.log(JSON.stringify(message, null, 2));
  });

const draftCommand = (
  email: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, MailError, Imap> =>
  Effect.gen(function* () {
    const flags = parseFlags(args);
    const to = flags.get('to');
    if (to === undefined) {
      yield* Console.error('Missing --to');
      return;
    }
    const body = yield* Effect.promise(() => Bun.stdin.text());
    if (body.trim() === '') {
      yield* Console.error('Draft body is empty — pipe the body via stdin.');
      return;
    }
    const imap = yield* Imap;
    const folder = yield* imap.saveDraft({
      account: email,
      to,
      cc: flags.get('cc'),
      subject: flags.get('subject') ?? '',
      text: body,
      inReplyTo: flags.get('in-reply-to'),
    });
    yield* Console.log(`Draft saved to "${folder}".`);
  });

const withAccount = (
  email: string | undefined,
  make: (email: string) => Effect.Effect<void, MailError, Imap | Secrets>,
): Effect.Effect<void, MailError, Imap | Secrets> =>
  email !== undefined && findAccount(email) !== undefined
    ? make(email)
    : badAccount();

const program = (): Effect.Effect<void, MailError, Imap | Secrets> => {
  switch (command) {
    case 'accounts':
      return Console.log(accountEmails.join('\n'));
    case 'login':
      return withAccount(account, loginCommand);
    case 'folders':
      return withAccount(account, foldersCommand);
    case 'search':
      return withAccount(account, (value) => searchCommand(value, tail));
    case 'read':
      return withAccount(account, (value) =>
        readCommand(value, at(tail, 0), at(tail, 1)),
      );
    case 'draft':
      return withAccount(account, (value) => draftCommand(value, tail));
    default:
      return Console.log(usage);
  }
};

const main = program().pipe(
  Effect.catchAll((error) => Console.error(`Error: ${error.message}`)),
);

await Effect.runPromise(Effect.provide(main, appLayer));
