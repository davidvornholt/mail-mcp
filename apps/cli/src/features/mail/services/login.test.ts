import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { ImapError } from '../errors/errors';
import { storeVerifiedPassword } from './login';

describe('storeVerifiedPassword', () => {
  it('stores the password after successful verification', async () => {
    const events: Array<string> = [];

    await Effect.runPromise(
      storeVerifiedPassword(
        'user@example.com',
        'secret',
        () => Effect.sync(() => events.push('verified')).pipe(Effect.asVoid),
        () => Effect.sync(() => events.push('stored')).pipe(Effect.asVoid),
      ),
    );

    expect(events).toEqual(['verified', 'stored']);
  });

  it('does not store the password when verification fails', async () => {
    let stored = false;
    const program = storeVerifiedPassword(
      'user@example.com',
      'wrong',
      () => Effect.fail(new ImapError({ message: 'authentication failed' })),
      () =>
        Effect.sync(() => {
          stored = true;
        }),
    );

    const result = await Effect.runPromiseExit(program);

    expect(result._tag).toBe('Failure');
    expect(stored).toBeFalse();
  });
});
