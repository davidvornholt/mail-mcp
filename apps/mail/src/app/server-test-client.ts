// biome-ignore-all lint/correctness/noUnresolvedImports: Biome does not follow the MCP SDK's package.json exports map; tsc and Bun resolve these test imports correctly.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

export const serverPath = Bun.fileURLToPath(
  new URL('./server.ts', import.meta.url),
);
const fixturePath = Bun.fileURLToPath(
  new URL('../features/mail/services/accounts.fixture.toml', import.meta.url),
);

let transport: StdioClientTransport | undefined;

export const connectClient = async (): Promise<Client> => {
  const env = getDefaultEnvironment();
  env.MAIL_ACCOUNTS_CONFIG = fixturePath;
  transport = new StdioClientTransport({
    command: 'bun',
    args: [serverPath],
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mail-mcp-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
};

export const closeClient = async (): Promise<void> => {
  await transport?.close();
  transport = undefined;
};
