import { Effect } from 'effect';
import { SearchInputError } from '../errors/errors';
import {
  type SearchOptions,
  type SearchOptionsInput,
  type SearchScope,
  searchScopes,
} from '../schemas/mail';

export const isSearchScope = (value: string): value is SearchScope =>
  searchScopes.some((scope) => scope === value);

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
