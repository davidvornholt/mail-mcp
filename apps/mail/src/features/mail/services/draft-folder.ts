import type { FolderInfo } from '../schemas/mail';

const DRAFTS_PATH = /^(?:inbox[./])?drafts$/iu;
const DRAFTS_NAME = /^drafts$/iu;

// Prefer the IMAP \Drafts special-use flag; fall back to a folder named Drafts;
// otherwise default to a top-level "Drafts" so the append still has a target.
export const selectDraftsFolder = (
  folders: ReadonlyArray<FolderInfo>,
): string => {
  const special = folders.find((folder) => folder.specialUse === '\\Drafts');
  if (special !== undefined) {
    return special.path;
  }
  const named = folders.find(
    (folder) => DRAFTS_PATH.test(folder.path) || DRAFTS_NAME.test(folder.name),
  );
  return named?.path ?? 'Drafts';
};
