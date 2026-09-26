import { Either, ParseResult, Schema } from 'effect';

// Keyring service namespace for stored IMAP passwords. The passwords live in the
// OS keyring (see services/secrets.ts), keyed by account email.
export const keyringService = 'mailbox';

const implicitTlsPort = 993;
const maxPort = 65_535;

const AccountEntry = Schema.Struct({
  email: Schema.NonEmptyTrimmedString,
  name: Schema.NonEmptyTrimmedString,
  host: Schema.NonEmptyTrimmedString,
  port: Schema.optionalWith(Schema.Int.pipe(Schema.between(1, maxPort)), {
    default: () => implicitTlsPort,
  }),
  secure: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  user: Schema.optional(Schema.NonEmptyTrimmedString),
});

const sameEmail = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

// Emails must be unique because accounts are resolved by email.
const AccountsFile = Schema.Struct({
  accounts: Schema.NonEmptyArray(AccountEntry).pipe(
    Schema.filter(
      (accounts) =>
        accounts.every(
          (account, index) =>
            accounts.findIndex((other) =>
              sameEmail(other.email, account.email),
            ) === index,
        ) || 'account emails must be unique',
    ),
  ),
});

export type Account = {
  readonly email: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
};

export const findAccount = (
  accounts: ReadonlyArray<Account>,
  email: string,
): Account | undefined =>
  accounts.find((account) => sameEmail(account.email, email.trim()));

// Unknown keys are rejected so a typo such as `hots` fails loudly instead of
// silently falling back to a default.
export const decodeAccounts = (
  input: unknown,
): Either.Either<ReadonlyArray<Account>, string> =>
  Schema.decodeUnknownEither(AccountsFile, {
    errors: 'all',
    onExcessProperty: 'error',
  })(input).pipe(
    Either.map(({ accounts }) =>
      accounts.map((account) => ({
        ...account,
        user: account.user ?? account.email,
      })),
    ),
    Either.mapLeft((error) => ParseResult.TreeFormatter.formatErrorSync(error)),
  );
