import { Effect, Layer, ManagedRuntime } from 'effect';
import type { MailError } from '../features/mail/errors/errors';
import { MailConfig } from '../features/mail/services/config';
import { Imap } from '../features/mail/services/imap';
import { Secrets } from '../features/mail/services/secrets';
import { textResult } from './mcp-contract';

type ToolEnv = Imap | Secrets | MailConfig;

// Keep authenticated IMAP clients warm across tool calls; the managed runtime
// closes them when the server is disposed.
export const runtime = ManagedRuntime.make(
  Layer.mergeAll(MailConfig.Default, Secrets.Default, Imap.Default),
);

export const accountEmails = await runtime.runPromise(
  Effect.map(MailConfig, (config) => config.emails),
);
export const accountList = accountEmails.join(', ');

// For tools whose success value is already a complete MCP tool result.
export const runToolResult = <A>(
  program: Effect.Effect<A, MailError, ToolEnv>,
) =>
  runtime.runPromise(
    program.pipe(
      Effect.catchAll((error) =>
        Effect.succeed(textResult(`Error: ${error.message}`, true)),
      ),
    ),
  );

export const runTool = <A>(program: Effect.Effect<A, MailError, ToolEnv>) =>
  runToolResult(
    Effect.map(program, (value) => textResult(JSON.stringify(value, null, 2))),
  );
