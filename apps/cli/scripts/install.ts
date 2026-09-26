// Installs the compiled mailbox command and its agent skill for the current
// user. Run through `bun run install:user`, which builds dist/mailbox first.

const home = Bun.env.HOME;
if (home === undefined || home === '') {
  throw new Error('HOME is not set');
}
const binDir = `${home}/.local/bin`;
const skillsDir = `${home}/.agents/skills`;
const appDir = `${import.meta.dir}/..`;

// Install beside the target and rename over it, so a running mailbox is never
// left with a half-written binary.
await Bun.$`mkdir -p ${binDir}`;
await Bun.$`install -m 755 ${appDir}/dist/mailbox ${binDir}/.mailbox.tmp`;
await Bun.$`mv -f ${binDir}/.mailbox.tmp ${binDir}/mailbox`;
await Bun.$`install -D -m 644 ${appDir}/skills/mailbox/SKILL.md ${skillsDir}/mailbox/SKILL.md`;

// ~/.agents/skills may be its own git repository; keep the installed skill out
// of its status.
const gitDir = await Bun.$`git -C ${skillsDir} rev-parse --absolute-git-dir`
  .quiet()
  .nothrow();
if (gitDir.exitCode === 0) {
  const exclude = Bun.file(`${gitDir.text().trim()}/info/exclude`);
  const current = (await exclude.exists()) ? await exclude.text() : '';
  if (!current.split('\n').includes('/mailbox/')) {
    await Bun.write(exclude, `${current.trimEnd()}\n/mailbox/\n`.trimStart());
  }
}

await Bun.write(
  Bun.stdout,
  `Installed ${binDir}/mailbox and ${skillsDir}/mailbox/SKILL.md\n`,
);
