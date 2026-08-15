import { Console, Effect } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { Imap } from '../features/mail/services/imap';
import { storeVerifiedPassword } from '../features/mail/services/login';
import { Secrets } from '../features/mail/services/secrets';
import {
  type HiddenPromptResult,
  promptHidden,
} from '../shared/terminal';

type LoginAttempt =
  | { readonly _tag: 'success'; readonly message: string }
  | { readonly _tag: 'skipped'; readonly message: string }
  | { readonly _tag: 'cancelled'; readonly message: string }
  | { readonly _tag: 'failed'; readonly message: string };

type LoginResult = LoginAttempt & { readonly email: string };

type HiddenPrompt = (question: string) => Effect.Effect<HiddenPromptResult>;

const loginAccount = (
  email: string,
  prompt: HiddenPrompt,
): Effect.Effect<LoginAttempt, MailError, Imap | Secrets> =>
  Effect.gen(function* () {
    const promptResult = yield* prompt(
      `Password for ${email} (input hidden): `,
    );
    if (promptResult._tag === 'cancelled') {
      return {
        _tag: 'cancelled',
        message: 'cancelled — remaining accounts skipped.',
      } as const;
    }
    if (promptResult.value === '') {
      return { _tag: 'skipped', message: 'empty password — skipped.' } as const;
    }
    const secrets = yield* Secrets;
    const imap = yield* Imap;
    yield* storeVerifiedPassword(
      email,
      promptResult.value,
      imap.verifyCredentials,
      secrets.setPassword,
    );
    return {
      _tag: 'success',
      message:
        'verified and stored password in the OS keyring (service "mail-mcp").',
    } as const;
  });

export const loginCommand = (
  emails: ReadonlyArray<string>,
  flagFailure: Effect.Effect<void>,
  prompt: HiddenPrompt = promptHidden,
): Effect.Effect<void, never, Imap | Secrets> =>
  Effect.gen(function* () {
    const results = yield* Effect.reduceWhile(
      emails,
      [] as ReadonlyArray<LoginResult>,
      {
        while: (previous) => previous.at(-1)?._tag !== 'cancelled',
        body: (previous, email) =>
          loginAccount(email, prompt).pipe(
            Effect.map(
              (result): ReadonlyArray<LoginResult> => [
                ...previous,
                { email, ...result },
              ],
            ),
            Effect.catchAll((error) =>
              Effect.succeed([
                ...previous,
                { email, _tag: 'failed', message: error.message } as const,
              ]),
            ),
          ),
      },
    );
    yield* Effect.forEach(
      results,
      (result) =>
        result._tag === 'success'
          ? Console.log(`${result.email}: ${result.message}`)
          : Console.error(`${result.email}: ${result.message}`),
      { discard: true },
    );
    if (results.some((result) => result._tag !== 'success')) {
      yield* flagFailure;
    }
  });
