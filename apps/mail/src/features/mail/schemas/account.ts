// Account inventory, discovered from Thunderbird's prefs.js. No secrets here —
// passwords live in the OS keyring (see services/secrets.ts). Thunderbird
// socketType 3 maps to implicit TLS on port 993, so `secure` is always true.

export type Account = {
  readonly email: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
};

export const keyringService = 'mail-mcp';

export const accounts: ReadonlyArray<Account> = [
  {
    email: 'user1@example.com',
    name: 'DV',
    host: 'imap.example.net',
    port: 993,
    secure: true,
    user: 'user1@example.com',
  },
  {
    email: 'user2@example.com',
    name: 'David Vornholt',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    user: 'user2@example.com',
  },
  {
    email: 'user3@example.com',
    name: 'David Vornholt',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    user: 'user3@example.com',
  },
  {
    email: 'user4@example.com',
    name: 'ProsaBridge Admin',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    user: 'user4@example.com',
  },
  {
    email: 'user5@example.com',
    name: 'ProsaBridge',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    user: 'user5@example.com',
  },
];

export const accountEmails: ReadonlyArray<string> = accounts.map(
  (account) => account.email,
);

export const findAccount = (email: string): Account | undefined =>
  accounts.find((account) => account.email === email);
