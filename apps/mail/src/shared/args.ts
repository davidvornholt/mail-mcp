// Access a positional argument, returning `undefined` when the index is out of
// range so callers can distinguish "missing" from "empty".
export const at = (
  list: ReadonlyArray<string>,
  index: number,
): string | undefined =>
  index >= 0 && index < list.length ? list[index] : undefined;

// Minimal `--flag value` parser for the CLI. Returns a map so a missing flag is
// a genuine `undefined` rather than an assumed empty string.
export const parseFlags = (
  argv: ReadonlyArray<string>,
): ReadonlyMap<string, string> => {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = at(argv, index);
    if (token?.startsWith('--')) {
      flags.set(token.slice(2), at(argv, index + 1) ?? '');
      index += 1;
    }
  }
  return flags;
};
