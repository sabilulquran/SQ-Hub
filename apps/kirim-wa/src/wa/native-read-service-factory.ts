import makeWASocket, {
  areJidsSameUser,
  downloadMediaMessage,
  isJidGroup,
  useMultiFileAuthState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type { Readable } from "node:stream";
import QRCode from "qrcode";

import type { WhatsAppServiceFactory } from "./device-manager.js";
import {
  CallLogAggregator,
  normalizeMessageUpdateChange,
  normalizeReaction,
  type ProviderChangeEvent,
} from "./message-changes.js";
import {
  isValidIndividualJid,
  normalizeHistoryMessage,
  silentLogger,
  WhatsAppService,
  type HistoryMessage,
  type WhatsAppServiceDependencies,
} from "./service.js";

export interface NativeConversationReadEvent {
  chatJid: string;
  readAt: string;
}

export type NativeConversationReadListener = (
  deviceId: string,
  event: NativeConversationReadEvent,
) => void;

export function normalizeNativeConversationReadUpdate(
  update: { id?: string | null; unreadCount?: number | null },
  readAt: string,
): NativeConversationReadEvent | null {
  if (update.unreadCount !== 0) return null;
  const chatJid = update.id?.trim().toLowerCase();
  if (!chatJid || isJidGroup(chatJid) || !isValidIndividualJid(chatJid)) return null;
  return { chatJid, readAt };
}

export type DeviceSentMessage = Extract<HistoryMessage, { direction: "outbound" }>;

export type DeviceSentMessageListener = (deviceId: string, message: DeviceSentMessage) => void;

export type DeviceProviderChangeListener = (deviceId: string, event: ProviderChangeEvent) => void;

/**
 * An outbound message the account sent itself, live or delivered after reconnecting. Messages sent
 * through JalurPesan arrive here too; the listener tells them apart by WhatsApp id.
 */
export function normalizeDeviceSentMessage(
  message: WAMessage,
  ownJid: string | null,
  fallbackTimestamp: string,
  download: () => Promise<Readable>,
): DeviceSentMessage | null {
  if (message.key.fromMe !== true) return null;
  const normalized = normalizeHistoryMessage(message, ownJid, fallbackTimestamp, download);
  if (!normalized || normalized.direction !== "outbound") return null;
  if (
    normalized.recipientType === "individual" &&
    ownJid &&
    areJidsSameUser(normalized.chatJid, ownJid)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Keeps the ordinary WhatsAppService lifecycle intact while observing Baileys'
 * chat-level app-state updates and own outbound messages from other WhatsApp
 * companions/native clients.
 */
export function createNativeReadAwareWhatsAppServiceFactory(
  onConversationRead: NativeConversationReadListener,
  onDeviceSentMessage?: DeviceSentMessageListener,
  onProviderChange?: DeviceProviderChangeListener,
  /** Whether a device stores its pairing-time history sync; evaluated each time its socket starts. */
  storeBootstrapHistory?: (deviceId: string) => boolean,
): WhatsAppServiceFactory {
  return (
    deviceId,
    authDirectory,
    onStateChange,
    onInboundMessage,
    onOutboundReceipt,
    onMetadata,
    onHistory,
  ) => {
    const now = () => new Date().toISOString();
    const dependencies: WhatsAppServiceDependencies = {
      createSocket: ((options: Parameters<typeof makeWASocket>[0]) => {
        const socket = makeWASocket(options);
        socket.ev.on("chats.update", (updates) => {
          const readAt = now();
          for (const update of updates) {
            const event = normalizeNativeConversationReadUpdate(update, readAt);
            if (!event) continue;
            try {
              onConversationRead(deviceId, event);
            } catch {
              // Read synchronization is auxiliary and must never break the socket event loop.
            }
          }
        });
        if (onDeviceSentMessage) {
          socket.ev.on("messages.upsert", ({ messages, type }) => {
            if (type !== "notify" && type !== "append") return;
            for (const message of messages) {
              try {
                const sent = normalizeDeviceSentMessage(
                  message,
                  socket.user?.id ?? null,
                  now(),
                  () =>
                    downloadMediaMessage(
                      message,
                      "stream",
                      {},
                      { reuploadRequest: socket.updateMediaMessage, logger: silentLogger as never },
                    ),
                );
                if (sent) onDeviceSentMessage(deviceId, sent);
              } catch {
                // Linked-device history is auxiliary and must never break the socket event loop.
              }
            }
          });
        }
        if (onProviderChange)
          attachProviderChangeListeners(socket, deviceId, now, onProviderChange);
        return socket;
      }) as typeof makeWASocket,
      loadAuthState: useMultiFileAuthState,
      qrToDataUrl: QRCode.toDataURL,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now,
      downloadMedia: downloadMediaMessage,
      ...(storeBootstrapHistory
        ? { storeBootstrapHistory: () => storeBootstrapHistory(deviceId) }
        : {}),
    };

    return new WhatsAppService(
      authDirectory,
      onStateChange,
      dependencies,
      onInboundMessage,
      onOutboundReceipt,
      onMetadata,
      onHistory,
    );
  };
}

/**
 * Edits, revokes, reactions, and calls. Calls are only observed: nothing here (or anywhere in
 * JalurPesan) calls `rejectCall`, so a call keeps ringing on the number's phone as usual.
 */
export function attachProviderChangeListeners(
  socket: Pick<ReturnType<typeof makeWASocket>, "ev" | "user"> & {
    ws?: { on(event: string, listener: (node: unknown) => void): unknown };
  },
  deviceId: string,
  now: () => string,
  onProviderChange: DeviceProviderChangeListener,
): CallLogAggregator {
  const emit = (event: ProviderChangeEvent) => {
    try {
      onProviderChange(deviceId, event);
    } catch {
      // Change events are auxiliary and must never break the socket event loop.
    }
  };
  const calls = new CallLogAggregator(
    (call) => emit(call),
    undefined,
    () => socket.user?.id ?? null,
  );
  socket.ev.on("messages.update", (updates) => {
    for (const update of updates) {
      try {
        const change = normalizeMessageUpdateChange(update, socket.user?.id ?? null, now());
        if (change) emit(change);
      } catch {
        // See above.
      }
    }
  });
  socket.ev.on("messages.reaction", (reactions) => {
    for (const reaction of reactions) {
      try {
        const change = normalizeReaction(reaction, socket.user?.id ?? null, now());
        if (change) emit(change);
      } catch {
        // See above.
      }
    }
  });
  socket.ev.on("call", (events) => {
    for (const event of events) {
      try {
        calls.observe(event);
      } catch {
        // See above.
      }
    }
  });
  socket.ws?.on("CB:call", (node) => {
    try {
      const stanza = node as { content?: unknown };
      const child = Array.isArray(stanza.content)
        ? (stanza.content[0] as { tag?: string; attrs?: Record<string, string> } | undefined)
        : undefined;
      calls.noteRawStanza(child?.attrs?.["call-id"], child?.tag, child?.attrs?.reason);
    } catch {
      // See above.
    }
  });
  socket.ev.on("connection.update", ({ connection }) => {
    if (connection === "close") calls.clear();
  });
  return calls;
}
