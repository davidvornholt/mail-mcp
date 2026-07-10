import { z } from 'zod';

// Keyring service namespace for stored IMAP passwords. This is a fixed app
// constant, not per-user config — the passwords themselves live in the OS
// keyring (see services/secrets.ts), keyed by account email.
export const keyringService = 'mail-mcp';

const maxPort = 65_535;

// Shape of one non-secret account entry. The values live in `accounts.toml`
// (git-ignored) and are loaded and validated by MailConfig at runtime.
export const accountSchema = z.object({
  email: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(maxPort),
  secure: z.boolean(),
  user: z.string(),
});

export type Account = z.infer<typeof accountSchema>;

// A config file must declare at least one account under `[[accounts]]`, and
// emails must be unique — `getAccount` resolves by email, so a duplicate would
// silently shadow the later entry.
export const accountsFileSchema = z.object({
  accounts: z
    .array(accountSchema)
    .min(1)
    .refine(
      (accounts) =>
        new Set(accounts.map((account) => account.email)).size ===
        accounts.length,
      { message: 'account emails must be unique' },
    ),
});
