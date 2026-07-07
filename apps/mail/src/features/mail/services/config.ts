import { Effect } from 'effect';
import { UnknownAccountError } from '../errors/errors';
import { type Account, accountEmails, findAccount } from '../schemas/account';

export class MailConfig extends Effect.Service<MailConfig>()(
  'mail/MailConfig',
  {
    succeed: {
      getAccount: (
        email: string,
      ): Effect.Effect<Account, UnknownAccountError> => {
        const account = findAccount(email);
        return account === undefined
          ? Effect.fail(
              new UnknownAccountError({
                email,
                message: `Unknown account "${email}". Known accounts: ${accountEmails.join(', ')}`,
              }),
            )
          : Effect.succeed(account);
      },
    },
  },
) {}
