import { describe, expect, it } from 'bun:test';
import { accountsFileSchema } from './account';

const validAccount = {
  email: 'a@b.com',
  name: 'A',
  host: 'imap.b.com',
  port: 993,
  secure: true,
  user: 'a@b.com',
};

describe('accountsFileSchema', () => {
  it('parses a valid accounts file', () => {
    const parsed = accountsFileSchema.parse({ accounts: [validAccount] });
    expect(parsed.accounts[0]?.host).toBe('imap.b.com');
  });

  it('rejects an empty accounts list', () => {
    expect(() => accountsFileSchema.parse({ accounts: [] })).toThrow();
  });

  it('rejects duplicate account emails', () => {
    expect(() =>
      accountsFileSchema.parse({ accounts: [validAccount, validAccount] }),
    ).toThrow();
  });

  it('rejects an account missing required fields', () => {
    expect(() =>
      accountsFileSchema.parse({ accounts: [{ email: 'a@b.com' }] }),
    ).toThrow();
  });
});
