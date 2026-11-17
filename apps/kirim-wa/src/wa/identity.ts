/**
 * Provider-neutral conversation identity. Raw provider JIDs remain on messages;
 * this key is only the durable grouping key used by the conversation console.
 */
export type ConversationKind = "individual" | "group";
export type ConversationDirection = "inbound" | "outbound";

export interface ConversationIdentityInput {
  direction?: ConversationDirection;
  recipientType: ConversationKind | null;
  chatJid?: string | null;
  peerJidAlt?: string | null;
  senderJid?: string | null;
  recipientJid?: string | null;
  recipient?: string | null;
}

export function conversationKeyFor(input: ConversationIdentityInput): string {
  if (input.recipientType === "group") {
    const groupJid = firstNonEmpty(input.chatJid, input.recipientJid, input.recipient);
    return `group:${normalizeJid(groupJid)}`;
  }

  const candidates =
    input.direction === "inbound"
      ? inboundPeerCandidates(input)
      : [
          // Baileys v7 can expose one peer as a LID and the same peer as a PN
          // in remoteJidAlt. Outbound history continues to derive its peer
          // from the requested recipient as before.
          input.peerJidAlt,
          input.chatJid,
          input.senderJid,
          input.recipientJid,
          input.recipient,
        ];
  const phone = candidates.map(phoneFromIdentity).find((value): value is string => value !== null);
  if (phone) return `individual:pn:${phone}`;

  const lid = candidates.map(lidFromJid).find((value): value is string => value !== null);
  if (lid) return `individual:lid:${lid}`;

  return `individual:jid:${normalizeJid(firstNonEmpty(...candidates))}`;
}

/**
 * Inbound individual records deliberately set recipientJid to the local
 * device identity. It is an addressing fact, never a conversation peer.
 */
function inboundPeerCandidates(input: ConversationIdentityInput): Array<string | null | undefined> {
  return [input.peerJidAlt, input.chatJid, input.senderJid].filter(
    (candidate) => !sameIndividualIdentity(candidate, input.recipientJid),
  );
}

/** Returns whether a durable individual key represents one of these identities. */
export function conversationKeyResolvesToIdentity(
  key: string,
  ...identities: Array<string | null | undefined>
): boolean {
  const peer = canonicalPeerFromConversationKey(key).jid;
  return peer ? identities.some((identity) => sameIndividualIdentity(peer, identity)) : false;
}

export function conversationKindFromKey(key: string): ConversationKind | null {
  if (key.startsWith("individual:")) return "individual";
  if (key.startsWith("group:")) return "group";
  return null;
}

export function canonicalPeerFromConversationKey(key: string): {
  jid: string | null;
  phone: string | null;
} {
  if (key.startsWith("individual:pn:")) {
    const phone = key.slice("individual:pn:".length);
    return { phone, jid: `${phone}@s.whatsapp.net` };
  }
  if (key.startsWith("individual:lid:")) {
    const lid = key.slice("individual:lid:".length);
    return { phone: null, jid: `${lid}@lid` };
  }
  if (key.startsWith("individual:jid:")) {
    return { phone: null, jid: key.slice("individual:jid:".length) || null };
  }
  if (key.startsWith("group:")) return { phone: null, jid: key.slice("group:".length) || null };
  return { phone: null, jid: null };
}

export function phoneFromIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (/^\d{5,20}$/.test(normalized)) return normalized;
  const match = /^(\d{5,20})(?::\d+)?@(?:s\.whatsapp\.net|c\.us|hosted)$/.exec(normalized);
  return match?.[1] ?? null;
}

export function lidFromJid(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  const match = normalized ? /^([^@:\s]+)(?::\d+)?@(?:lid|hosted\.lid)$/.exec(normalized) : null;
  return match?.[1] ?? null;
}

/** Canonical provider address for a verified PN mapping; never derives PN from a LID. */
export function canonicalPnJid(value: string | null | undefined): string | null {
  const phone = phoneFromIdentity(value);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

/** Canonical provider address for a concrete LID. */
export function canonicalLidJid(value: string | null | undefined): string | null {
  const lid = lidFromJid(value);
  return lid ? `${lid}@lid` : null;
}

/** Supported direct individual addresses in Baileys v7: PN or concrete LID JIDs only. */
export function isSupportedIndividualJid(value: string): boolean {
  return canonicalPnJid(value) !== null || canonicalLidJid(value) !== null;
}

function sameIndividualIdentity(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftPhone = phoneFromIdentity(left);
  const rightPhone = phoneFromIdentity(right);
  if (leftPhone && rightPhone) return leftPhone === rightPhone;

  const leftLid = lidFromJid(left);
  const rightLid = lidFromJid(right);
  if (leftLid && rightLid) return leftLid === rightLid;

  const normalizedLeft = left?.trim().toLowerCase();
  const normalizedRight = right?.trim().toLowerCase();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return (
    values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ??
    "unknown"
  );
}

function normalizeJid(value: string): string {
  return value.trim().toLowerCase() || "unknown";
}
