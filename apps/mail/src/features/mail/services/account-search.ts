import { Duration, Effect } from 'effect';
import {
  AccountSearchTimeoutError,
  type MailError,
  SearchAccountsError,
  type UnknownAccountError,
} from '../errors/errors';
import type {
  SearchHit,
  SearchOptions,
  SearchOptionsInput,
  SearchResult,
} from '../schemas/mail';
import type { MailboxSearchHit } from './imap-search';
import { resolveAccountSearchOptions } from './search-options';

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
  readonly options: SearchOptionsInput;
  readonly validateAccount: (
    account: string,
  ) => Effect.Effect<unknown, UnknownAccountError>;
  readonly searchMailbox: SearchMailbox;
};

const searchConcurrency = 5;

// Per-account deadline for the global fan-out so one stalled server cannot
// withhold healthy accounts' results. Must stay below the socketTimeout in
// imap.ts so this structured failure fires before the socket-level one.
const accountSearchTimeoutSeconds = 30;

const boundAccountSearch = <A>(
  account: string,
  search: Effect.Effect<A, MailError>,
): Effect.Effect<A, MailError> =>
  search.pipe(
    // disconnect lets the timeout win immediately even if the underlying IMAP
    // operation sits in an uninterruptible region; the abandoned connection is
    // reaped by the client-level socketTimeout.
    Effect.disconnect,
    Effect.timeoutFail({
      duration: Duration.seconds(accountSearchTimeoutSeconds),
      onTimeout: () =>
        new AccountSearchTimeoutError({
          account,
          message: `Search for ${account} did not complete within ${accountSearchTimeoutSeconds} seconds. Retry with this account alone or check the server.`,
        }),
    }),
  );

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
    const normalized = messageId.trim();
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
        boundAccountSearch(account, searchMailbox(account, options)).pipe(
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
    const resolvedOptions = yield* resolveAccountSearchOptions({
      account,
      options,
      validateAccount,
    });
    if (account === undefined) {
      return yield* searchAllAccounts(accounts, resolvedOptions, searchMailbox);
    }
    return yield* searchOneAccount(account, resolvedOptions, searchMailbox);
  });
