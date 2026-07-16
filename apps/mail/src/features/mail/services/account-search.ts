import { Effect } from 'effect';
import {
  type MailError,
  SearchAccountsError,
  SearchInputError,
} from '../errors/errors';
import type { SearchHit, SearchOptions, SearchResult } from '../schemas/mail';
import type { MailboxSearchHit } from './imap-search';

type AccountSearchHit = MailboxSearchHit & {
  readonly account: string;
};

type AccountSearchOutcome =
  | {
      readonly _tag: 'success';
      readonly hits: ReadonlyArray<AccountSearchHit>;
    }
  | {
      readonly _tag: 'failure';
      readonly account: string;
      readonly error: MailError;
    };

type SearchMailbox = (
  account: string,
  options: SearchOptions,
) => Effect.Effect<ReadonlyArray<MailboxSearchHit>, MailError>;

type SearchAccountsInput = {
  readonly accounts: ReadonlyArray<string>;
  readonly account: string | undefined;
  readonly options: SearchOptions;
  readonly validateAccount: (
    account: string,
  ) => Effect.Effect<unknown, MailError>;
  readonly searchMailbox: SearchMailbox;
};

const searchConcurrency = 5;

const newestFirst = (left: AccountSearchHit, right: AccountSearchHit): number =>
  right.receivedAt.localeCompare(left.receivedAt) ||
  left.account.localeCompare(right.account) ||
  left.hit.folder.localeCompare(right.hit.folder) ||
  right.hit.uid - left.hit.uid;

const uniqueHits = (
  hits: ReadonlyArray<AccountSearchHit>,
): ReadonlyArray<AccountSearchHit> => {
  const seenMessageIds = new Set<string>();
  return hits.filter(({ messageId }) => {
    const normalized = messageId.trim().toLowerCase();
    if (normalized === '') {
      return true;
    }
    if (seenMessageIds.has(normalized)) {
      return false;
    }
    seenMessageIds.add(normalized);
    return true;
  });
};

const toSearchHit = ({ account, hit }: AccountSearchHit): SearchHit => ({
  account,
  ...hit,
});

export const searchOneAccount = (
  account: string,
  options: SearchOptions,
  searchMailbox: SearchMailbox,
): Effect.Effect<SearchResult, MailError> =>
  searchMailbox(account, options).pipe(
    Effect.map((hits) => ({
      hits: hits.map((hit) => toSearchHit({ account, ...hit })),
      failures: [],
    })),
  );

export const searchAllAccounts = (
  accounts: ReadonlyArray<string>,
  options: SearchOptions,
  searchMailbox: SearchMailbox,
): Effect.Effect<SearchResult, SearchAccountsError> =>
  Effect.gen(function* () {
    const outcomes = yield* Effect.forEach(
      accounts,
      (account) =>
        searchMailbox(account, options).pipe(
          Effect.match({
            onFailure: (error): AccountSearchOutcome => ({
              _tag: 'failure',
              account,
              error,
            }),
            onSuccess: (mailboxHits): AccountSearchOutcome => ({
              _tag: 'success',
              hits: mailboxHits.map((hit) => ({ account, ...hit })),
            }),
          }),
        ),
      { concurrency: searchConcurrency },
    );
    const successes = outcomes.filter((outcome) => outcome._tag === 'success');
    if (successes.length === 0) {
      const details = outcomes
        .filter((outcome) => outcome._tag === 'failure')
        .map(({ account, error }) => `${account}: ${error.message}`)
        .join('; ');
      return yield* Effect.fail(
        new SearchAccountsError({
          message: `Search failed for every account. ${details}`,
        }),
      );
    }
    const mergedHits = successes.flatMap(
      ({ hits: accountHits }) => accountHits,
    );
    const failures = outcomes.flatMap((outcome) =>
      outcome._tag === 'failure'
        ? [
            {
              account: outcome.account,
              errorTag: outcome.error._tag,
              message: outcome.error.message,
            },
          ]
        : [],
    );
    return {
      hits: uniqueHits(mergedHits.sort(newestFirst))
        .slice(0, options.limit)
        .map(toSearchHit),
      failures,
    };
  });

export const searchAccounts = ({
  accounts,
  account,
  options,
  validateAccount,
  searchMailbox,
}: SearchAccountsInput): Effect.Effect<SearchResult, MailError> =>
  Effect.gen(function* () {
    if (account === undefined) {
      if (options.scope !== 'all') {
        return yield* Effect.fail(
          new SearchInputError({
            message: `Search scope "${options.scope}" requires an account.`,
          }),
        );
      }
      return yield* searchAllAccounts(accounts, options, searchMailbox);
    }
    yield* validateAccount(account);
    return yield* searchOneAccount(account, options, searchMailbox);
  });
