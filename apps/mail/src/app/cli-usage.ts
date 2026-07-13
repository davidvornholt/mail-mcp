export const usage = (
  knownAccounts: string,
): string => `mail — draft-only IMAP helper

Commands:
  mail login <email>                       verify and store password (hidden prompt)
  mail accounts                            list configured accounts
  mail status [email] [--quick]            check auth per account (--quick: keyring only)
  mail folders <email>                     list folders
  mail search <email> <query...>           search (newest first)
  mail read <email> <folder> <uid>         print one message
  mail draft <email> --to <addr> --subject <s> [--cc <addr>] [--reply-folder <folder> --reply-uid <uid>] [--in-reply-to <id>]   body from stdin

Accounts: ${knownAccounts}`;
