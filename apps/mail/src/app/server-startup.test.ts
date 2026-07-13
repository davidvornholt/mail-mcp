import { expect, it } from 'bun:test';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serverPath } from './server-test-client';

const missingConfigPath = Bun.fileURLToPath(
  new URL('./accounts.missing.toml', import.meta.url),
);
const subprocessTimeoutMs = 30_000;

it('keeps configuration failures off the MCP stdout channel', async () => {
  expect(await Bun.file(missingConfigPath).exists()).toBe(false);
  const env = getDefaultEnvironment();
  env.MAIL_ACCOUNTS_CONFIG = missingConfigPath;
  const result = Bun.spawnSync(['bun', serverPath], {
    env,
    timeout: subprocessTimeoutMs,
  });

  expect(result.exitedDueToTimeout).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout.toString()).toBe('');
  expect(result.stderr.toString()).toContain('Could not read account config');
});
