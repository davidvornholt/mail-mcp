import { describe, expect, it } from 'bun:test';
import { accountEmails, accounts, findAccount } from './account';

describe('accounts', () => {
  it('exposes at least one account', () => {
    expect(accounts.length).toBeGreaterThan(0);
  });

  it('has unique email addresses', () => {
    expect(new Set(accountEmails).size).toBe(accountEmails.length);
  });

  it('resolves a known account and rejects an unknown one', () => {
    expect(findAccount('user1@example.com')?.host).toBe('imap.example.net');
    expect(findAccount('nobody@example.com')).toBeUndefined();
  });
});
