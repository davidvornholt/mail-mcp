import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { resolveSearchOptions } from './search-options';

const base = { limit: 20, query: 'invoice' } as const;

describe('resolveSearchOptions', () => {
  it('defaults to global search when neither scope nor folder is supplied', async () => {
    await expect(
      Effect.runPromise(resolveSearchOptions(base)),
    ).resolves.toEqual({
      ...base,
      scope: 'all',
    });
  });

  it('accepts an explicit subtree search', async () => {
    await expect(
      Effect.runPromise(
        resolveSearchOptions({
          ...base,
          scope: 'subtree',
          folder: 'Projects',
        }),
      ),
    ).resolves.toEqual({
      ...base,
      scope: 'subtree',
      folder: 'Projects',
    });
  });

  it('accepts an explicit exact-folder search', async () => {
    await expect(
      Effect.runPromise(
        resolveSearchOptions({ ...base, scope: 'folder', folder: 'INBOX' }),
      ),
    ).resolves.toEqual({
      ...base,
      scope: 'folder',
      folder: 'INBOX',
    });
  });

  it('rejects a folder combined with global scope', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        resolveSearchOptions({ ...base, scope: 'all', folder: 'INBOX' }),
      ),
    );
    expect(error._tag).toBe('SearchInputError');
  });

  it('rejects a folder without an explicit folder-based scope', async () => {
    const error = await Effect.runPromise(
      Effect.flip(resolveSearchOptions({ ...base, folder: 'INBOX' })),
    );
    expect(error._tag).toBe('SearchInputError');
  });

  it('rejects a folder-based scope without a folder', async () => {
    const error = await Effect.runPromise(
      Effect.flip(resolveSearchOptions({ ...base, scope: 'subtree' })),
    );
    expect(error._tag).toBe('SearchInputError');
  });
});
