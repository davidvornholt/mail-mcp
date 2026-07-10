import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { UnknownAccountError } from '../errors/errors';
import { MailConfig } from './config';

Bun.env.MAIL_ACCOUNTS_CONFIG = Bun.fileURLToPath(
  new URL('./accounts.fixture.toml', import.meta.url),
);

const getAccount = (email: string) =>
  Effect.gen(function* () {
    const config = yield* MailConfig;
    return yield* config.getAccount(email);
  });

describe('MailConfig', () => {
  it('loads and resolves an account from the configured TOML file', async () => {
    const account = await Effect.runPromise(
      Effect.provide(getAccount('test@example.com'), MailConfig.Default),
    );
    expect(account.host).toBe('imap.test.example');
  });

  it('fails with UnknownAccountError for an unknown account', async () => {
    const error = await Effect.runPromise(
      Effect.provide(
        getAccount('nobody@example.com').pipe(Effect.flip),
        MailConfig.Default,
      ),
    );
    expect(error).toBeInstanceOf(UnknownAccountError);
    expect(error._tag).toBe('UnknownAccountError');
  });
});
