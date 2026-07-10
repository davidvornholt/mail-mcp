import { describe, expect, it } from 'bun:test';
import {
  ImapError,
  KeyringError,
  MissingPasswordError,
} from '../errors/errors';
import { statusFromError } from './status';

describe('statusFromError', () => {
  it('reports a missing keyring password as no-password with a login hint', () => {
    const status = statusFromError(
      'a@b.com',
      new MissingPasswordError({ account: 'a@b.com', message: 'none' }),
    );
    expect(status.state).toBe('no-password');
    expect(status.ok).toBe(false);
    expect(status.message).toContain('mail login a@b.com');
  });

  it('reports a connection/auth failure as unauthenticated with the cause', () => {
    const status = statusFromError(
      'a@b.com',
      new ImapError({ message: 'Invalid credentials' }),
    );
    expect(status.state).toBe('unauthenticated');
    expect(status.message).toBe('Invalid credentials');
  });

  it('reports other failures as a generic error', () => {
    const status = statusFromError(
      'a@b.com',
      new KeyringError({ message: 'keyring locked' }),
    );
    expect(status.state).toBe('error');
    expect(status.ok).toBe(false);
  });
});
