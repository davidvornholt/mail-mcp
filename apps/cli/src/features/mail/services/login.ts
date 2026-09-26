import { Effect } from 'effect';
import type { MailError } from '../errors/errors';

type VerifyCredentials = (
  email: string,
  password: string,
) => Effect.Effect<void, MailError>;

type StorePassword = (
  email: string,
  password: string,
) => Effect.Effect<void, MailError>;

// Verification intentionally precedes persistence so a failed login cannot
// replace a working password in the keyring.
export const storeVerifiedPassword = (
  email: string,
  password: string,
  verifyCredentials: VerifyCredentials,
  storePassword: StorePassword,
): Effect.Effect<void, MailError> =>
  verifyCredentials(email, password).pipe(
    Effect.andThen(storePassword(email, password)),
  );
