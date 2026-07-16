import { Effect } from 'effect';
import type { ListResponse } from 'imapflow';
import { FolderNotFoundError } from '../errors/errors';
import type { SearchLocation } from '../schemas/mail';

const excludedAllMailSpecialUse = new Set([
  '\\Drafts',
  '\\Flagged',
  '\\Junk',
  '\\Trash',
]);

const isSelectable = (folder: ListResponse): boolean =>
  folder.listed &&
  !folder.flags.has('\\Noselect') &&
  !folder.flags.has('\\NonExistent');

const samePath = (left: string, right: string): boolean =>
  left === right ||
  (left.toUpperCase() === 'INBOX' && right.toUpperCase() === 'INBOX');

const isSameOrDescendant = (
  folder: ListResponse,
  root: ListResponse,
): boolean => {
  const folderSegments = [...folder.parent, folder.name];
  const rootSegments = [...root.parent, root.name];
  return (
    folderSegments.length >= rootSegments.length &&
    rootSegments.every((segment, index) =>
      index === 0
        ? samePath(folderSegments[index] ?? '', segment)
        : folderSegments[index] === segment,
    )
  );
};

const allMailFolders = (
  folders: ReadonlyArray<ListResponse>,
): ReadonlyArray<string> => {
  const allFolder = folders.find(
    (folder) => folder.specialUse === '\\All' && isSelectable(folder),
  );
  if (allFolder !== undefined) {
    return [allFolder.path];
  }
  const excludedRoots = folders.filter((folder) =>
    excludedAllMailSpecialUse.has(folder.specialUse ?? ''),
  );
  return folders
    .filter(
      (folder) =>
        isSelectable(folder) &&
        !excludedRoots.some((root) => isSameOrDescendant(folder, root)),
    )
    .map((folder) => folder.path);
};

const subtreeFolders = (
  folders: ReadonlyArray<ListResponse>,
  requestedPath: string,
): Effect.Effect<ReadonlyArray<string>, FolderNotFoundError> => {
  const root = folders.find((folder) => samePath(folder.path, requestedPath));
  if (root === undefined) {
    return Effect.fail(
      new FolderNotFoundError({
        folder: requestedPath,
        message: `Folder "${requestedPath}" was not found.`,
      }),
    );
  }
  return Effect.succeed(
    folders
      .filter(
        (folder) => isSelectable(folder) && isSameOrDescendant(folder, root),
      )
      .map((folder) => folder.path),
  );
};

export const selectSearchFolders = (
  folders: ReadonlyArray<ListResponse>,
  location: Exclude<SearchLocation, { readonly scope: 'folder' }>,
): Effect.Effect<ReadonlyArray<string>, FolderNotFoundError> =>
  location.scope === 'all'
    ? Effect.succeed(allMailFolders(folders))
    : subtreeFolders(folders, location.folder);
