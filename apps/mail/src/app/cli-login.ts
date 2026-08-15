import { Console, Effect } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { Imap } from '../features/mail/services/imap';
import { storeVerifiedPassword } from '../features/mail/services/login';
import { Secrets } from '../features/mail/services/secrets';
import { promptHidden } from '../shared/terminal';

type LoginAttempt =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

const loginAccount = (
  email: string,
): Effect.Effect<LoginAttempt, MailError, Imap | Secrets> =>
  Effect.gen(function* () {
    const password = yield* promptHidden(
      `Password for ${email} (input hidden): `,
    );
    if (password === '') {
      return { ok: false, message: 'empty password — skipped.' };
    }
    const secrets = yield* Secrets;
    const imap = yield* Imap;
    yield* storeVerifiedPassword(
      email,
      password,
      imap.verifyCredentials,
      secrets.setPassword,
    );
    return {
      ok: true,
      message:
        'verified and stored password in the OS keyring (service "mail-mcp").',
    };
  });

export const loginCommand = (
  emails: ReadonlyArray<string>,
  flagFailure: Effect.Effect<void>,
): Effect.Effect<void, never, Imap | Secrets> =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(
      emails,
      (email) =>
        loginAccount(email).pipe(
          Effect.map((result) => ({ email, ...result })),
          Effect.catchAll((error) =>
            Effect.succeed({ email, ok: false, message: error.message }),
          ),
        ),
      { concurrency: 1 },
    );
    yield* Effect.forEach(
      results,
      (result) =>
        result.ok
          ? Console.log(`${result.email}: ${result.message}`)
          : Console.error(`${result.email}: ${result.message}`),
      { discard: true },
    );
    if (results.some((result) => !result.ok)) {
      yield* flagFailure;
    }
  });
