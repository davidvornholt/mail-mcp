import { Data } from 'effect';

export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly message: string;
}> {}

export class UnknownAccountError extends Data.TaggedError(
  'UnknownAccountError',
)<{
  readonly email: string;
  readonly message: string;
}> {}

export class MissingPasswordError extends Data.TaggedError(
  'MissingPasswordError',
)<{
  readonly account: string;
  readonly message: string;
}> {}

export class KeyringError extends Data.TaggedError('KeyringError')<{
  readonly message: string;
}> {}

export class ImapError extends Data.TaggedError('ImapError')<{
  readonly message: string;
}> {}

export class SearchInputError extends Data.TaggedError('SearchInputError')<{
  readonly message: string;
}> {}

export class FolderNotFoundError extends Data.TaggedError(
  'FolderNotFoundError',
)<{
  readonly folder: string;
  readonly message: string;
}> {}

export class MessageNotFoundError extends Data.TaggedError(
  'MessageNotFoundError',
)<{
  readonly folder: string;
  readonly uid: number;
  readonly message: string;
}> {}

export class AttachmentNotFoundError extends Data.TaggedError(
  'AttachmentNotFoundError',
)<{
  readonly folder: string;
  readonly uid: number;
  readonly part: string;
  readonly message: string;
}> {}

export class AttachmentTooLargeError extends Data.TaggedError(
  'AttachmentTooLargeError',
)<{
  readonly folder: string;
  readonly uid: number;
  readonly part: string;
  readonly size: number;
  readonly limit: number;
  readonly message: string;
}> {}

export class DraftError extends Data.TaggedError('DraftError')<{
  readonly message: string;
}> {}

export class StaleUidError extends Data.TaggedError('StaleUidError')<{
  readonly folder: string;
  readonly uid: number;
  readonly message: string;
}> {}

export type MailError =
  | ConfigError
  | UnknownAccountError
  | MissingPasswordError
  | KeyringError
  | ImapError
  | SearchInputError
  | FolderNotFoundError
  | MessageNotFoundError
  | AttachmentNotFoundError
  | AttachmentTooLargeError
  | DraftError
  | StaleUidError;
