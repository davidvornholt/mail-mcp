import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { UnknownAccountError } from '../errors/errors';
import { MailConfig } from './config';

const getAccount = (email: string) =>
  Effect.gen(function* () {
    const config = yield* MailConfig;
    return yield* config.getAccount(email);
  });

describe('MailConfig.getAccount', () => {
  it('resolves a configured account', () => {
    const account = Effect.runSync(
      Effect.provide(getAccount('user1@example.com'), MailConfig.Default),
    );
    expect(account.email).toBe('user1@example.com');
  });

  it('fails with UnknownAccountError for an unknown account', () => {
    const error = Effect.runSync(
      Effect.provide(
        getAccount('nobody@example.com').pipe(Effect.flip),
        MailConfig.Default,
      ),
    );
    expect(error).toBeInstanceOf(UnknownAccountError);
    expect(error._tag).toBe('UnknownAccountError');
  });
});
