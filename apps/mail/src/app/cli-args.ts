import {
  type MessageHandle,
  type SearchOptionsInput,
  type SearchScope,
  searchScopes,
} from '../features/mail/schemas/mail';
import { isSearchScope } from '../features/mail/services/search-options';
import { at, parseFlags } from '../shared/args';

type ParsedMessageHandle =
  | { readonly _tag: 'valid'; readonly handle: MessageHandle | undefined }
  | { readonly _tag: 'invalid'; readonly message: string };

export type ParsedSearchArgs =
  | {
      readonly _tag: 'valid';
      readonly input: Pick<SearchOptionsInput, 'folder' | 'scope' | 'query'>;
    }
  | { readonly _tag: 'invalid'; readonly message: string };

const searchFlagNames = new Set(['folder', 'scope']);

const toSearchScope = (value: string | undefined): SearchScope | undefined =>
  value !== undefined && isSearchScope(value) ? value : undefined;

export const parseSearchArgs = (
  args: ReadonlyArray<string>,
): ParsedSearchArgs => {
  const flags = parseFlags(args);
  const unknownFlag = [...flags.keys()].find(
    (name) => !searchFlagNames.has(name),
  );
  if (unknownFlag !== undefined) {
    return {
      _tag: 'invalid',
      message: `Unknown search flag --${unknownFlag}.`,
    };
  }
  const missingValueFlag = args.find(
    (token, index) =>
      token.startsWith('--') &&
      (at(args, index + 1) === undefined ||
        at(args, index + 1)?.startsWith('--')),
  );
  if (missingValueFlag !== undefined) {
    return {
      _tag: 'invalid',
      message: `${missingValueFlag} requires a value.`,
    };
  }
  const scopeValue = flags.get('scope');
  const scope = toSearchScope(scopeValue);
  if (scopeValue !== undefined && scope === undefined) {
    return {
      _tag: 'invalid',
      message: `--scope must be one of: ${searchScopes.join(', ')}.`,
    };
  }
  const terms = args.filter(
    (token, index) =>
      !(token.startsWith('--') || at(args, index - 1)?.startsWith('--')),
  );
  return {
    _tag: 'valid',
    input: {
      folder: flags.get('folder'),
      scope,
      query: terms.length === 0 ? undefined : terms.join(' '),
    },
  };
};

export const parseMessageHandle = (
  flags: ReadonlyMap<string, string>,
  prefix: string,
): ParsedMessageHandle => {
  const folder = flags.get(`${prefix}-folder`);
  const uidValue = flags.get(`${prefix}-uid`);
  if ((folder === undefined) !== (uidValue === undefined)) {
    return {
      _tag: 'invalid',
      message: `Pass --${prefix}-folder and --${prefix}-uid together.`,
    };
  }
  if (folder === undefined || uidValue === undefined) {
    return { _tag: 'valid', handle: undefined };
  }
  const uid = Number(uidValue);
  return Number.isInteger(uid) && uid > 0
    ? { _tag: 'valid', handle: { folder, uid } }
    : {
        _tag: 'invalid',
        message: `--${prefix}-uid must be a positive integer.`,
      };
};
