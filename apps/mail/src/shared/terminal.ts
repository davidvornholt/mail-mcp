import process from 'node:process';
import { Effect } from 'effect';

const ENTER = new Set(['\n', '\r', '']);
const BACKSPACE = new Set(['', '\b']);
const CTRL_C = '';

// Read a line from the terminal with echo disabled, so a typed password never
// appears on screen, in shell history, or in an agent transcript. Resolves to
// an empty string when there is no TTY or the user aborts with Ctrl-C.
export const promptHidden = (question: string): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    const input = process.stdin;
    if (input.isTTY !== true) {
      resume(Effect.succeed(''));
      return;
    }
    process.stdout.write(question);
    const previousRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const stop = (result: string): void => {
      input.setRawMode(previousRaw);
      input.pause();
      input.removeAllListeners('data');
      process.stdout.write('\n');
      resume(Effect.succeed(result));
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === CTRL_C) {
          stop('');
          return;
        }
        if (ENTER.has(char)) {
          stop(value);
          return;
        }
        value = BACKSPACE.has(char) ? value.slice(0, -1) : value + char;
      }
    };
    input.on('data', onData);
  });
