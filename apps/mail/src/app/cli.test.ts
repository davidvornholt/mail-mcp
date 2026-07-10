import { describe, expect, it } from 'bun:test';

const cliPath = new URL('./cli.ts', import.meta.url).pathname;
const fixturePath = new URL(
  '../features/mail/services/accounts.fixture.toml',
  import.meta.url,
).pathname;

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

describe('cli exit codes', () => {
  it('unknown account exits non-zero', () => {
    const result = runCli(['folders', 'nobody@example.com'], fixturePath);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown or missing account');
  });

  it('missing accounts config exits non-zero', () => {
    const result = runCli(['accounts'], '/nonexistent/accounts.toml');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error:');
  });

  it('usage banner exits zero', () => {
    const result = runCli([], fixturePath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('mail — draft-only IMAP helper');
  });
});
