import { Effect } from 'effect';
import type { ImapFlow } from 'imapflow';
import { ImapError } from '../errors/errors';

export const lockMailbox = (client: ImapFlow, folder: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => client.getMailboxLock(folder),
      catch: (cause) =>
        new ImapError({
          message: `lock ${folder} failed: ${String(cause)}`,
        }),
    }),
    (lock) =>
      Effect.sync(() => {
        lock.release();
      }),
  );
