import { Entry } from '@napi-rs/keyring';
import { Effect } from 'effect';
import { KeyringError, MissingPasswordError } from '../errors/errors';
import { keyringService } from '../schemas/account';

export class Secrets extends Effect.Service<Secrets>()('mail/Secrets', {
  succeed: {
    getPassword: (
      account: string,
    ): Effect.Effect<string, MissingPasswordError | KeyringError> =>
      Effect.try({
        try: () => new Entry(keyringService, account).getPassword(),
        catch: (cause) =>
          new KeyringError({
            message: `keyring read failed for ${account}: ${String(cause)}`,
          }),
      }).pipe(
        Effect.flatMap((password) =>
          password === null
            ? Effect.fail(
                new MissingPasswordError({
                  account,
                  message: `No stored password for ${account}. Run: mail login ${account}`,
                }),
              )
            : Effect.succeed(password),
        ),
      ),
    setPassword: (
      account: string,
      password: string,
    ): Effect.Effect<void, KeyringError> =>
      Effect.try({
        try: () => {
          new Entry(keyringService, account).setPassword(password);
        },
        catch: (cause) =>
          new KeyringError({
            message: `keyring write failed for ${account}: ${String(cause)}`,
          }),
      }),
  },
}) {}
