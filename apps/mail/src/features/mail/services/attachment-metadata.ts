import type { MessageStructureObject } from 'imapflow';
import type { MessageAttachment } from '../schemas/mail';

const parameter = (
  parameters: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined =>
  Object.entries(parameters ?? {}).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];

const toAttachment = (
  node: MessageStructureObject,
): MessageAttachment | undefined => {
  const { part } = node;
  const disposition = node.disposition?.toLowerCase() ?? null;
  const filename =
    parameter(node.dispositionParameters, 'filename') ??
    parameter(node.parameters, 'name') ??
    null;
  const isMessageBody = ['text/plain', 'text/html', 'text/x-amp-html'].includes(
    node.type.toLowerCase(),
  );
  const isAttachment =
    disposition === 'attachment' ||
    filename !== null ||
    (node.id !== undefined && !isMessageBody);
  if (part === undefined || !isAttachment) {
    return;
  }
  return {
    part,
    filename,
    contentType: node.type,
    size: node.size ?? null,
    disposition,
    contentId: node.id ?? null,
  };
};

export const listAttachments = (
  structure: MessageStructureObject | undefined,
): ReadonlyArray<MessageAttachment> => {
  if (structure === undefined) {
    return [];
  }
  const attachments: Array<MessageAttachment> = [];
  const pending = [structure];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node !== undefined) {
      const attachment = toAttachment(node);
      if (attachment === undefined) {
        pending.push(...[...(node.childNodes ?? [])].reverse());
      } else {
        attachments.push(attachment);
      }
    }
  }
  return attachments;
};

export type LocatedAttachment = {
  readonly attachment: MessageAttachment;
  readonly node: MessageStructureObject;
};

export const findAttachmentNode = (
  structure: MessageStructureObject | undefined,
  part: string,
): LocatedAttachment | undefined => {
  const pending = structure === undefined ? [] : [structure];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.part === part) {
      const attachment = toAttachment(node);
      return attachment === undefined ? undefined : { attachment, node };
    }
    if (node !== undefined) {
      pending.push(...(node.childNodes ?? []));
    }
  }
};

export const bodyStructureSizeIsDecoded = (
  encoding: string | undefined,
): boolean =>
  ['7bit', '8bit', 'binary'].includes(encoding?.toLowerCase() ?? '7bit');
