import { Effect } from 'effect';
import { ConfigError, UnknownAccountError } from '../errors/errors';
import { type Account, accountsFileSchema } from '../schemas/account';

// Default config lives next to the app root so a spawned MCP server resolves it
// regardless of the working directory Claude Code launches it from. Override the
// path with MAIL_ACCOUNTS_CONFIG (used by tests to point at a fixture).
const defaultConfigPath = Bun.fileURLToPath(
  new URL('../../../../accounts.toml', import.meta.url),
);

const resolveConfigPath = (): string =>
  Bun.env.MAIL_ACCOUNTS_CONFIG ?? defaultConfigPath;

const loadAccounts = Effect.gen(function* () {
  const path = resolveConfigPath();
  const text = yield* Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (cause) =>
      new ConfigError({
        message: `Could not read account config at ${path}: ${String(cause)}. Copy apps/mail/accounts.example.toml to accounts.toml and add your accounts.`,
      }),
  });
  return yield* Effect.try({
    try: (): ReadonlyArray<Account> =>
      accountsFileSchema.parse(Bun.TOML.parse(text)).accounts,
    catch: (cause) =>
      new ConfigError({
        message: `Invalid account config at ${path}: ${String(cause)}`,
      }),
  });
});

export class MailConfig extends Effect.Service<MailConfig>()(
  'mail/MailConfig',
  {
    effect: Effect.gen(function* () {
      const accounts = yield* loadAccounts;
      const emails = accounts.map((account) => account.email);
      return {
        accounts,
        emails,
        getAccount: (
          email: string,
        ): Effect.Effect<Account, UnknownAccountError> => {
          const account = accounts.find((item) => item.email === email);
          return account === undefined
            ? Effect.fail(
                new UnknownAccountError({
                  email,
                  message: `Unknown account "${email}". Known accounts: ${emails.join(', ')}`,
                }),
              )
            : Effect.succeed(account);
        },
      } as const;
    }),
  },
) {}
