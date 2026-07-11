#!/usr/bin/env bun
import process from 'node:process';
import { Console, Effect } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { defaultSearchLimit } from '../features/mail/schemas/mail';
import { MailConfig } from '../features/mail/services/config';
import { Imap } from '../features/mail/services/imap';
import { storeVerifiedPassword } from '../features/mail/services/login';
import { Secrets } from '../features/mail/services/secrets';
import { checkAccounts } from '../features/mail/services/status';
import { at, parseFlags } from '../shared/args';
import { promptHidden } from '../shared/terminal';
import { appLayer } from './runtime';

type Env = Imap | Secrets | MailConfig;

const cliArgs: ReadonlyArray<string> = Bun.argv.slice(2);
const command: string = at(cliArgs, 0) ?? '';
const account = at(cliArgs, 1);
const tail = cliArgs.slice(2);

const usage = (knownAccounts: string): string => `mail — draft-only IMAP helper

Commands:
  mail login <email>                       verify and store password (hidden prompt)
  mail accounts                            list configured accounts
  mail status [email] [--quick]            check auth per account (--quick: keyring only)
  mail folders <email>                     list folders
  mail search <email> <query...>           search (newest first)
  mail read <email> <folder> <uid>         print one message
  mail draft <email> --to <addr> --subject <s> [--cc <addr>] [--in-reply-to <id>]   body from stdin

Accounts: ${knownAccounts}`;

// Failure contract: every error path — typed MailErrors, unknown accounts,
// usage mistakes, and accounts that fail `mail status` — exits non-zero so
// scripts can rely on the exit code.
const flagFailure: Effect.Effect<void> = Effect.sync(() => {
  process.exitCode = 1;
});

const fail = (message: string): Effect.Effect<void> =>
  flagFailure.pipe(Effect.andThen(Console.error(message)));

const badAccount = (known: ReadonlyArray<string>): Effect.Effect<void> =>
  fail(`Unknown or missing account. Known: ${known.join(', ')}`);

const loginCommand = (
  email: string,
): Effect.Effect<void, MailError, Imap | Secrets> =>
  Effect.gen(function* () {
    const password = yield* promptHidden(
      `Password for ${email} (input hidden): `,
    );
    if (password === '') {
      yield* fail('Empty password — aborted.');
      return;
    }
    const secrets = yield* Secrets;
    const imap = yield* Imap;
    yield* storeVerifiedPassword(
      email,
      password,
      imap.verifyCredentials,
      secrets.setPassword,
    );
    yield* Console.log(
      `Verified and stored password for ${email} in the OS keyring (service "mail-mcp").`,
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
      yield* fail('Usage: mail read <email> <folder> <uid>');
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
      yield* fail('Missing --to');
      return;
    }
    const body = yield* Effect.promise(() => Bun.stdin.text());
    if (body.trim() === '') {
      yield* fail('Draft body is empty — pipe the body via stdin.');
      return;
    }
    const imap = yield* Imap;
    const location = yield* imap.saveDraft({
      account: email,
      to,
      cc: flags.get('cc'),
      subject: flags.get('subject') ?? '',
      text: body,
      inReplyTo: flags.get('in-reply-to'),
    });
    yield* Console.log(`Draft saved to "${location.folder}".`);
  });

const statusCommand = (
  only: string | undefined,
  quick: boolean,
): Effect.Effect<void, MailError, Env> =>
  Effect.gen(function* () {
    const config = yield* MailConfig;
    if (only !== undefined && !config.emails.includes(only)) {
      return yield* badAccount(config.emails);
    }
    const emails = only === undefined ? config.emails : [only];
    const results = yield* checkAccounts(emails, { verify: !quick });
    const width = Math.max(...results.map((result) => result.email.length));
    yield* Effect.forEach(
      results,
      (result) =>
        Console.log(
          `${result.email.padEnd(width)}  ${result.ok ? '✓' : '✗'} ${result.message}`,
        ),
      { discard: true },
    );
    if (results.some((result) => !result.ok)) {
      yield* flagFailure;
    }
  });

const withAccount = (
  email: string | undefined,
  make: (email: string) => Effect.Effect<void, MailError, Env>,
): Effect.Effect<void, MailError, Env> =>
  Effect.gen(function* () {
    const config = yield* MailConfig;
    if (email === undefined || !config.emails.includes(email)) {
      return yield* badAccount(config.emails);
    }
    return yield* make(email);
  });

const program: Effect.Effect<void, MailError, Env> = Effect.gen(function* () {
  switch (command) {
    case 'accounts': {
      const config = yield* MailConfig;
      return yield* Console.log(config.emails.join('\n'));
    }
    case 'status': {
      const rest = cliArgs.slice(1);
      const only = rest.find((token) => !token.startsWith('--'));
      return yield* statusCommand(only, rest.includes('--quick'));
    }
    case 'login':
      return yield* withAccount(account, loginCommand);
    case 'folders':
      return yield* withAccount(account, foldersCommand);
    case 'search':
      return yield* withAccount(account, (value) => searchCommand(value, tail));
    case 'read':
      return yield* withAccount(account, (value) =>
        readCommand(value, at(tail, 0), at(tail, 1)),
      );
    case 'draft':
      return yield* withAccount(account, (value) => draftCommand(value, tail));
    default: {
      const config = yield* MailConfig;
      return yield* Console.log(usage(config.emails.join(', ')));
    }
  }
});

// Provide first so a config-load failure (a layer build error) is caught here
// alongside command errors, rather than escaping as an unhandled rejection.
const main = Effect.provide(program, appLayer).pipe(
  Effect.catchAll((error) => fail(`Error: ${error.message}`)),
);

await Effect.runPromise(main);
