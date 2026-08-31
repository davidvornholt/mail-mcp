import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { StaleUidError } from '../errors/errors';

export const currentUidValidity = (client: ImapFlow): string | null =>
  client.mailbox === false ? null : client.mailbox.uidValidity.toString();

// Callers must hold the folder's mailbox lock while checking and mutating it.
export const requireCurrentUidValidity = (
  client: ImapFlow,
  folder: string,
  uid: number,
  expectedUidValidity?: string,
): Effect.Effect<void, StaleUidError> => {
  if (expectedUidValidity === undefined) {
    return Effect.void;
  }
  const current = currentUidValidity(client);
  return current === expectedUidValidity
    ? Effect.void
    : Effect.fail(
        new StaleUidError({
          folder,
          uid,
          message: `refusing to modify draft uid ${uid}: "${folder}" was reindexed (uidValidity ${expectedUidValidity} → ${current ?? 'unknown'}); re-fetch the draft handle`,
        }),
      );
};
