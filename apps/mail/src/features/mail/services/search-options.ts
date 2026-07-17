import { Effect } from 'effect';
import { SearchInputError, type UnknownAccountError } from '../errors/errors';
import {
  type SearchOptions,
  type SearchOptionsInput,
  type SearchScope,
  searchScopes,
} from '../schemas/mail';

export const isSearchScope = (value: string): value is SearchScope =>
  searchScopes.some((scope) => scope === value);

type ValidationResult<Value, Error> =
  | { readonly _tag: 'valid'; readonly value: Value }
  | { readonly _tag: 'invalid'; readonly error: Error };

type AccountSearchOptionsInput = {
  readonly account: string | undefined;
  readonly options: SearchOptionsInput;
  readonly validateAccount: (
    account: string,
  ) => Effect.Effect<unknown, UnknownAccountError>;
};

const captureValidation = <Value, Error>(
  effect: Effect.Effect<Value, Error>,
): Effect.Effect<ValidationResult<Value, Error>> =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({ _tag: 'invalid' as const, error }),
      onSuccess: (value) => ({ _tag: 'valid' as const, value }),
    }),
  );

const accountRequirementError = (
  account: string | undefined,
  scope: SearchScope | undefined,
): SearchInputError | undefined =>
  account === undefined && scope !== undefined && scope !== 'all'
    ? new SearchInputError({
        message: `Search scope "${scope}" requires an account.`,
      })
    : undefined;

const isDefined = <Value>(value: Value | undefined): value is Value =>
  value !== undefined;

export const resolveSearchOptions = (
  input: SearchOptionsInput,
): Effect.Effect<SearchOptions, SearchInputError> => {
  const { folder, scope: requestedScope, ...criteria } = input;
  const scope = requestedScope ?? 'all';
  if (scope === 'all') {
    return folder === undefined
      ? Effect.succeed({ ...criteria, scope })
      : Effect.fail(
          new SearchInputError({
            message: 'Do not pass folder when search scope is "all".',
          }),
        );
  }
  if (folder === undefined || folder.trim() === '') {
    return Effect.fail(
      new SearchInputError({
        message: `Search scope "${scope}" requires a folder.`,
      }),
    );
  }
  return Effect.succeed({ ...criteria, scope, folder });
};

export const resolveAccountSearchOptions = ({
  account,
  options,
  validateAccount,
}: AccountSearchOptionsInput): Effect.Effect<
  SearchOptions,
  SearchInputError | UnknownAccountError
> =>
  Effect.gen(function* () {
    const optionValidation = yield* captureValidation(
      resolveSearchOptions(options),
    );
    const accountValidation =
      account === undefined
        ? undefined
        : yield* captureValidation(validateAccount(account));
    const requirementError = accountRequirementError(account, options.scope);
    const validationErrors = [
      requirementError,
      accountValidation?._tag === 'invalid'
        ? accountValidation.error
        : undefined,
      optionValidation._tag === 'invalid' ? optionValidation.error : undefined,
    ].filter(isDefined);
    if (validationErrors.length > 1) {
      return yield* Effect.fail(
        new SearchInputError({
          message: `Invalid search input: ${validationErrors
            .map(({ message }) => message)
            .join(' ')}`,
        }),
      );
    }
    if (requirementError !== undefined) {
      return yield* Effect.fail(requirementError);
    }
    if (accountValidation?._tag === 'invalid') {
      return yield* Effect.fail(accountValidation.error);
    }
    if (optionValidation._tag === 'invalid') {
      return yield* Effect.fail(optionValidation.error);
    }
    return optionValidation.value;
  });
