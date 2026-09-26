import { describe, expect, it } from 'bun:test';
import { defineCommand, flag } from './command-line';
import { type Program, resolve } from './command-program';

const show = defineCommand(
  {
    name: 'show',
    summary: 'Show a message',
    flags: { account: flag.text('email', 'Account') },
  },
  (values) => values,
);
const tag = defineCommand(
  {
    name: 'draft tag',
    summary: 'Tag drafts',
    flags: { uid: flag.integers('n', 'Draft uid') },
  },
  (values) => values,
);
const program: Program<unknown> = {
  name: 'tool',
  summary: 'tool: test program',
  footer: 'Footer text',
  commands: [show, tag],
};

describe('resolve', () => {
  it.each([[[]], [['help']], [['--help']], [['-h']]])(
    'prints the overview for %p',
    (argv) => {
      const resolution = resolve(program, argv);
      expect(resolution).toMatchObject({ _tag: 'Help' });
      expect(resolution._tag === 'Help' && resolution.text).toContain(
        'Footer text',
      );
    },
  );

  it('prints command help for "help <command>" and "<command> --help"', () => {
    const expected = { _tag: 'Help' as const, text: tag.help('tool') };
    expect(resolve(program, ['help', 'draft', 'tag'])).toEqual(expected);
    expect(resolve(program, ['draft', 'tag', '--help'])).toEqual(expected);
  });

  it('prints a group overview for a command prefix', () => {
    const resolution = resolve(program, ['draft']);
    expect(resolution._tag === 'Help' && resolution.text).toContain(
      'draft tag',
    );
    expect(resolution._tag === 'Help' && resolution.text).not.toContain('show');
  });

  it('rejects unknown commands and invalid arguments with usage', () => {
    expect(resolve(program, ['draft', 'send'])).toMatchObject({
      _tag: 'Invalid',
      error: { message: 'unknown command "draft send"; run: tool --help' },
    });
    expect(resolve(program, ['show'])).toMatchObject({
      _tag: 'Invalid',
      error: {
        _tag: 'UsageError',
        message: `tool show: missing --account <email>\n${show.usage('tool')}`,
      },
    });
  });

  it('runs a command with parsed values', () => {
    const uid = 3;
    expect(resolve(program, ['draft', 'tag', '--uid', String(uid)])).toEqual({
      _tag: 'Run',
      value: { uid: [uid] },
    });
  });
});
