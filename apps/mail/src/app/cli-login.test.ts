import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { Imap } from '../features/mail/services/imap';
import { Secrets } from '../features/mail/services/secrets';
import type { HiddenPromptResult } from '../shared/terminal';
import { loginCommand } from './cli-login';

describe('loginCommand', () => {
  it('stops prompting and does not verify or store after cancellation', async () => {
    const prompts: Array<string> = [];
    const verified: Array<string> = [];
    const stored: Array<string> = [];
    let failureFlagged = false;
    const prompt = (question: string): Effect.Effect<HiddenPromptResult> =>
      Effect.sync(() => {
        prompts.push(question);
        return { _tag: 'cancelled' } as const;
      });
    const imap = {
      verifyCredentials: (email: string, _password: string) =>
        Effect.sync(() => {
          verified.push(email);
        }).pipe(Effect.asVoid),
    } as unknown as Imap;
    const secrets = {
      setPassword: (email: string, _password: string) =>
        Effect.sync(() => {
          stored.push(email);
        }).pipe(Effect.asVoid),
    } as unknown as Secrets;

    await Effect.runPromise(
      loginCommand(
        ['first@example.com', 'second@example.com'],
        Effect.sync(() => {
          failureFlagged = true;
        }),
        prompt,
      ).pipe(
        Effect.provideService(Imap, imap),
        Effect.provideService(Secrets, secrets),
      ),
    );

    expect(prompts).toEqual([
      'Password for first@example.com (input hidden): ',
    ]);
    expect(verified).toEqual([]);
    expect(stored).toEqual([]);
    expect(failureFlagged).toBeTrue();
  });
});
