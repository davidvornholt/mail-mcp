import { Effect } from 'effect';
import { lifecycleHit } from './imap-client.fixture';
import type { MailboxSearchHit } from './imap-search';

const ignoreUsableRead = (_read: number): void => undefined;

export class TransitionClient {
  readonly result: ReadonlyArray<MailboxSearchHit> = [lifecycleHit];
  closeCalls = 0;
  usableReads = 0;
  onUsableRead = ignoreUsableRead;
  #usable = true;

  get usable(): boolean {
    this.usableReads += 1;
    this.onUsableRead(this.usableReads);
    return this.#usable;
  }

  set usable(value: boolean) {
    this.#usable = value;
  }

  close = (): void => {
    this.closeCalls += 1;
    this.#usable = false;
  };

  logout = (): Promise<void> => {
    this.close();
    return Promise.resolve();
  };
}

export const transitionCandidate = (
  client: TransitionClient,
  activate: Effect.Effect<void>,
) => Effect.succeed({ client, activate });
