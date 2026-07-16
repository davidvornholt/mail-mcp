import { describe, expect, it } from 'bun:test';

const cliPath = Bun.fileURLToPath(new URL('./cli.ts', import.meta.url));
const fixturePath = Bun.fileURLToPath(
  new URL('../features/mail/services/accounts.fixture.toml', import.meta.url),
);

type CliResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const runCli = (args: ReadonlyArray<string>, config: string): CliResult => {
  const env = { ...Bun.env };
  env.MAIL_ACCOUNTS_CONFIG = config;
  const result = Bun.spawnSync(['bun', cliPath, ...args], { env });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

// Each case cold-starts the CLI as a subprocess, which takes several seconds
// on CI runners — well past bun test's 5s default timeout.
const subprocessTimeoutMs = 30_000;

describe('cli exit codes', () => {
  it(
    'unknown account exits non-zero',
    () => {
      const result = runCli(['folders', 'nobody@example.com'], fixturePath);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown or missing account');
    },
    subprocessTimeoutMs,
  );

  it(
    'missing accounts config exits non-zero',
    () => {
      const result = runCli(['accounts'], '/nonexistent/accounts.toml');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
    },
    subprocessTimeoutMs,
  );

  it(
    'unknown explicit search account exits before connecting',
    () => {
      const result = runCli(
        ['search', '--account', 'nobody@example.com', 'invoice'],
        fixturePath,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown account');
    },
    subprocessTimeoutMs,
  );

  it(
    'folder search without an account exits before connecting',
    () => {
      const result = runCli(
        ['search', '--scope', 'folder', '--folder', 'INBOX', 'invoice'],
        fixturePath,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('requires an account');
    },
    subprocessTimeoutMs,
  );

  it(
    'usage banner exits zero',
    () => {
      const result = runCli([], fixturePath);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('mail — draft-only IMAP helper');
    },
    subprocessTimeoutMs,
  );
});
