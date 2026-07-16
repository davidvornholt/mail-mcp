import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { ListResponse } from 'imapflow';
import { selectSearchFolders } from './search-folders';

const folder = (
  path: string,
  options: {
    readonly delimiter?: string;
    readonly flags?: ReadonlyArray<string>;
    readonly listed?: boolean;
    readonly specialUse?: string;
  } = {},
): ListResponse => {
  const delimiter = options.delimiter ?? '/';
  const parts = path.split(delimiter);
  const name = parts.at(-1) ?? path;
  const parent = parts.slice(0, -1);
  return {
    path,
    pathAsListed: path,
    name,
    delimiter,
    parent,
    parentPath: parent.join(delimiter),
    flags: new Set(options.flags ?? []),
    specialUse: options.specialUse,
    listed: options.listed ?? true,
    subscribed: true,
  };
};

describe('selectSearchFolders', () => {
  it('uses a selectable all-mail folder for all-mail scope', async () => {
    const folders = [
      folder('INBOX', { specialUse: '\\Inbox' }),
      folder('All Mail', { specialUse: '\\All' }),
      folder('Archive', { specialUse: '\\Archive' }),
    ];
    await expect(
      Effect.runPromise(selectSearchFolders(folders, { scope: 'all' })),
    ).resolves.toEqual(['All Mail']);
  });

  it('falls back to user folders and excludes special-use roots and descendants', async () => {
    const folders = [
      folder('All Mail', { specialUse: '\\All', flags: ['\\Noselect'] }),
      folder('INBOX', { specialUse: '\\Inbox' }),
      folder('Sent', { specialUse: '\\Sent' }),
      folder('Archive', { specialUse: '\\Archive' }),
      folder('Projects'),
      folder('Drafts', { specialUse: '\\Drafts' }),
      folder('Drafts/Templates'),
      folder('Junk', { specialUse: '\\Junk' }),
      folder('Trash', { specialUse: '\\Trash' }),
      folder('Flagged', { specialUse: '\\Flagged' }),
      folder('Unavailable', { flags: ['\\NonExistent'] }),
    ];
    await expect(
      Effect.runPromise(selectSearchFolders(folders, { scope: 'all' })),
    ).resolves.toEqual(['INBOX', 'Sent', 'Archive', 'Projects']);
  });

  it('selects the requested folder and all selectable descendants only', async () => {
    const folders = [
      folder('Projects'),
      folder('Projects/Alpha'),
      folder('Projects/Alpha/Done'),
      folder('Projects/Container', { flags: ['\\Noselect'] }),
      folder('Projects/Container/Leaf'),
      folder('Projects-Old'),
    ];
    await expect(
      Effect.runPromise(
        selectSearchFolders(folders, {
          scope: 'subtree',
          folder: 'Projects',
        }),
      ),
    ).resolves.toEqual([
      'Projects',
      'Projects/Alpha',
      'Projects/Alpha/Done',
      'Projects/Container/Leaf',
    ]);
  });

  it('matches INBOX case-insensitively while preserving the canonical path', async () => {
    const folders = [folder('INBOX'), folder('INBOX/Filed')];
    await expect(
      Effect.runPromise(
        selectSearchFolders(folders, {
          scope: 'subtree',
          folder: 'inbox',
        }),
      ),
    ).resolves.toEqual(['INBOX', 'INBOX/Filed']);
  });

  it('fails before searching when a subtree root does not exist', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        selectSearchFolders([folder('INBOX')], {
          scope: 'subtree',
          folder: 'Missing',
        }),
      ),
    );
    expect(error._tag).toBe('FolderNotFoundError');
  });
});
