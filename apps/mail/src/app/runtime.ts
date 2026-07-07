import { Layer } from 'effect';
import { Imap } from '../features/mail/services/imap';
import { Secrets } from '../features/mail/services/secrets';

// Full application context for the single-shot CLI: the IMAP service plus the
// keyring, so `mail login` can store a password without opening a connection.
export const appLayer = Layer.mergeAll(Secrets.Default, Imap.Default);
