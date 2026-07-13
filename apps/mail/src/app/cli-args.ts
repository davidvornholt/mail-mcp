import type { MessageHandle } from '../features/mail/schemas/mail';

type ParsedMessageHandle =
  | { readonly _tag: 'valid'; readonly handle: MessageHandle | undefined }
  | { readonly _tag: 'invalid'; readonly message: string };

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
