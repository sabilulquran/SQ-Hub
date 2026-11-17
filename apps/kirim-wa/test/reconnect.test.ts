import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Boom } from "@hapi/boom";
import { DisconnectReason } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";

import {
  MAX_AUTO_RECONNECT_ATTEMPTS,
  WhatsAppService,
  WhatsAppSessionResetRequiredError,
  classifyDisconnect,
  type DeviceState,
  type WhatsAppServiceDependencies,
} from "../src/wa/service.js";

/**
 * Carried over from JalurPesan `server/test/whatsapp-reconnect.test.ts` (KIRIM-IMPL-005 §13).
 * This is the behaviour a number on a phone depends on: an ordinary network drop heals itself,
 * a logout never reconnects behind the owner's back, and a session WhatsApp has rejected stops
 * trying instead of hammering until the number is blocked.
 */

type ConnectionUpdateListener = (update: {
  connection?: "open" | "close" | "connecting";
  lastDisconnect?: { error: Error };
}) => void;

class FakeSocket {
  readonly user = { id: "628123456789@s.whatsapp.net", name: "Test device" };
  private connectionListener: ConnectionUpdateListener = () => undefined;
  readonly ev = {
    on: (event: string, listener: (...args: never[]) => void) => {
      if (event === "connection.update") {
        this.connectionListener = listener as unknown as ConnectionUpdateListener;
      }
    },
  };

  emitOpen(): void {
    this.connectionListener({ connection: "open" });
  }

  emitClose(statusCode: number): void {
    this.connectionListener({ connection: "close", lastDisconnect: { error: new Boom("closed", { statusCode }) } });
  }

  end(): void {}
  async logout(): Promise<void> {}
  async sendMessage(): Promise<{ key: { id: string } }> {
    return { key: { id: "message-1" } };
  }
}

function dependencies(options: {
  sockets: FakeSocket[];
  sleep?: (milliseconds: number) => Promise<void>;
  failAfterFirstSocket?: boolean;
}): WhatsAppServiceDependencies {
  let createCount = 0;
  return {
    createSocket: (() => {
      createCount += 1;
      if (options.failAfterFirstSocket && createCount > 1) throw new Error("start failed");
      const socket = new FakeSocket();
      options.sockets.push(socket);
      return socket;
    }) as WhatsAppServiceDependencies["createSocket"],
    loadAuthState: (async () => ({ state: {}, saveCreds: async () => undefined })) as WhatsAppServiceDependencies["loadAuthState"],
    qrToDataUrl: (async () => "data:image/png;base64,test") as WhatsAppServiceDependencies["qrToDataUrl"],
    sleep: options.sleep ?? (async () => undefined),
    now: () => "2026-11-17T12:00:00.000Z",
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("reconnect", () => {
  it("recovers from an ordinary connection loss and says why, without content", async () => {
    const sockets: FakeSocket[] = [];
    const states: DeviceState[] = [];
    const service = new WhatsAppService(join(tmpdir(), "kirim-wa-reconnect-ordinary"), (state) => states.push(state), dependencies({ sockets }));

    await service.connect();
    sockets[0]!.emitOpen();
    sockets[0]!.emitClose(DisconnectReason.connectionLost);
    await flushAsyncWork();

    expect(sockets).toHaveLength(2);
    expect(service.getState().lastDisconnectReason).toBe("connection_lost");
    expect(service.getState().lastDisconnectCode).toBe(DisconnectReason.connectionLost);
    expect(service.getState().requiresReset).toBe(false);
    expect(service.getState().reconnectAttempts).toBe(1);
    expect(states.some((state) => state.status === "connecting")).toBe(true);
  });

  it("never reconnects after a logout and asks for a reset", async () => {
    const sockets: FakeSocket[] = [];
    const service = new WhatsAppService(join(tmpdir(), "kirim-wa-reconnect-logged-out"), undefined, dependencies({ sockets }));

    await service.connect();
    sockets[0]!.emitClose(DisconnectReason.loggedOut);
    await flushAsyncWork();

    expect(sockets).toHaveLength(1);
    expect(service.getState()).toEqual({
      status: "disconnected",
      qr: null,
      jid: null,
      name: null,
      connectedAt: null,
      lastDisconnectReason: "logged_out",
      lastDisconnectCode: DisconnectReason.loggedOut,
      lastDisconnectedAt: "2026-11-17T12:00:00.000Z",
      loggedOut: true,
      requiresReset: true,
      reconnectAttempts: 0,
    });
  });

  it("stops retrying a session WhatsApp rejected, until it is reset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kirim-wa-reconnect-stale-"));
    const sockets: FakeSocket[] = [];
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "creds.json"), "{}", "utf8");
      const service = new WhatsAppService(directory, undefined, dependencies({ sockets }));

      await service.connect();
      sockets[0]!.emitClose(DisconnectReason.badSession);
      await flushAsyncWork();

      expect(sockets).toHaveLength(1);
      expect(service.getState().lastDisconnectReason).toBe("bad_session");
      expect(service.getState().requiresReset).toBe(true);
      await expect(service.connect()).rejects.toBeInstanceOf(WhatsAppSessionResetRequiredError);
      await expect(service.reconnect()).rejects.toBeInstanceOf(WhatsAppSessionResetRequiredError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("makes one reconnect out of duplicate close events and gives up after the bounded attempts", async () => {
    const sockets: FakeSocket[] = [];
    let releaseDelay: (() => void) | undefined;
    let sleepCalls = 0;
    const sleep = () => {
      sleepCalls += 1;
      return new Promise<void>((resolve) => {
        releaseDelay = resolve;
      });
    };
    const service = new WhatsAppService(join(tmpdir(), "kirim-wa-reconnect-duplicate"), undefined, dependencies({ sockets, sleep }));

    await service.connect();
    sockets[0]!.emitClose(DisconnectReason.connectionClosed);
    sockets[0]!.emitClose(DisconnectReason.connectionClosed);
    expect(sleepCalls).toBe(1);
    releaseDelay!();
    await flushAsyncWork();
    expect(sockets).toHaveLength(2);

    const failingSockets: FakeSocket[] = [];
    const failing = new WhatsAppService(
      join(tmpdir(), "kirim-wa-reconnect-bounded"),
      undefined,
      dependencies({ sockets: failingSockets, failAfterFirstSocket: true }),
    );
    await failing.connect();
    failingSockets[0]!.emitClose(DisconnectReason.connectionLost);
    await flushAsyncWork();

    expect(failing.getState().status).toBe("disconnected");
    expect(failing.getState().reconnectAttempts).toBe(MAX_AUTO_RECONNECT_ATTEMPTS);
    expect(failingSockets).toHaveLength(1);
  });

  it("tells a session that must be re-paired from one that may simply be retried", () => {
    expect(classifyDisconnect(DisconnectReason.loggedOut).requiresReset).toBe(true);
    expect(classifyDisconnect(DisconnectReason.badSession).requiresReset).toBe(true);
    expect(classifyDisconnect(DisconnectReason.connectionLost).autoReconnect).toBe(true);
    expect(classifyDisconnect(DisconnectReason.restartRequired).autoReconnect).toBe(true);
  });
});
