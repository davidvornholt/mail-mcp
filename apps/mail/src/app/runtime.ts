import { Layer } from 'effect';
import { MailConfig } from '../features/mail/services/config';
import { Imap } from '../features/mail/services/imap';
import { Secrets } from '../features/mail/services/secrets';

// Full application context for the single-shot CLI: account config, the keyring,
// and the IMAP service. MailConfig is listed explicitly so the CLI can read the
// account list for its banner even though Imap already depends on it.
export const appLayer = Layer.mergeAll(
  MailConfig.Default,
  Secrets.Default,
  Imap.Default,
);
