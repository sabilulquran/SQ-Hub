import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import {
  DeviceNotFoundError,
  type DeviceRecord,
  type DeviceRepository,
} from "../store/device-registry.js";
import {
  WhatsAppService,
  WhatsAppSessionResetRequiredError,
  type DeviceState,
  type DeviceStateListener,
  type InboundMessageListener,
  type InboundMessage,
  type InboundReadReceiptKey,
  type OutboundMedia,
  type OutboundMessageReceipt,
  type OutboundReceiptListener,
  type MessageAction,
  type SendOptions,
  type SendTextResult,
  type WhatsAppMetadataEvent,
  type WhatsAppMetadataListener,
  type WhatsAppGroupMetadata,
  type WhatsAppGroupParticipantAction,
  type WhatsAppGroupParticipantUpdate,
  type WhatsAppGroupJoinRequest,
  type WhatsAppCatalogPage,
  type WhatsAppLabelStore,
  type BusinessHours,
  type BusinessProfileUpdate,
  type CatalogProductInput,
  type CatalogProductWrite,
  type WhatsAppBusinessProfile,
  type WhatsAppGroupSetting,
  type WhatsAppHistoryEvent,
  type WhatsAppHistoryListener,
} from "./service.js";

export interface ManagedWhatsAppService {
  getState(): DeviceState;
  hasActiveSocket(): boolean;
  hasStoredCredentials(): boolean;
  connect(): Promise<DeviceState>;
  reconnect(): Promise<DeviceState>;
  logout(): Promise<DeviceState>;
  stop(reason?: string): Promise<DeviceState>;
  sendText(phone: string, message: string, options?: SendOptions): Promise<SendTextResult>;
  sendTextToJid(jid: string, message: string, options?: SendOptions): Promise<SendTextResult>;
  markMessagesRead?(messages: InboundReadReceiptKey[]): Promise<void>;
  sendMedia(phone: string, media: OutboundMedia, options?: SendOptions): Promise<SendTextResult>;
  sendMediaToIndividualJid(
    jid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult>;
  sendMessageAction?(action: MessageAction): Promise<SendTextResult>;
  getProfilePicture?(jid: string): Promise<Buffer | null>;
  requestPairingCode(phone: string): Promise<string>;
  listJoinedGroups(): Promise<WhatsAppGroupMetadata[]>;
  getGroupMetadata(groupJid: string): Promise<WhatsAppGroupMetadata>;
  createGroup?(subject: string, participants: string[]): Promise<WhatsAppGroupMetadata>;
  updateGroupParticipants?(
    groupJid: string,
    participants: string[],
    action: WhatsAppGroupParticipantAction,
  ): Promise<WhatsAppGroupParticipantUpdate[]>;
  updateGroupSubject?(groupJid: string, subject: string): Promise<WhatsAppGroupMetadata>;
  updateGroupDescription?(
    groupJid: string,
    description: string | undefined,
  ): Promise<WhatsAppGroupMetadata>;
  updateGroupSetting?(groupJid: string, setting: WhatsAppGroupSetting): Promise<void>;
  getGroupInviteCode?(groupJid: string): Promise<string | null>;
  revokeGroupInvite?(groupJid: string): Promise<string | null>;
  leaveGroup?(groupJid: string): Promise<void>;
  upsertQuickReply?(waId: string | null, shortcut: string, message: string): Promise<string>;
  resyncQuickReplies?(): Promise<boolean>;
  applyChatLabels?(input: { chatJids: string[]; managed: string[]; wanted: string[] }, store: WhatsAppLabelStore): Promise<string[]>;
  updateBusinessHours?(hours: BusinessHours): Promise<{ verified: boolean | null }>;
  getBusinessProfile?(): Promise<WhatsAppBusinessProfile>;
  updateBusinessProfile?(update: BusinessProfileUpdate): Promise<{ verified: boolean | null; profile: WhatsAppBusinessProfile | null }>;
  updateOwnProfilePicture?(image: Buffer | null): Promise<{ verified: boolean | null }>;
  updateCoverPhoto?(image: Buffer): Promise<{ id: string; verified: boolean | null }>;
  removeCoverPhoto?(id: string | null): Promise<{ id: string }>;
  createCatalogProduct?(input: CatalogProductInput): Promise<CatalogProductWrite>;
  updateCatalogProduct?(productId: string, input: CatalogProductInput): Promise<CatalogProductWrite>;
  deleteCatalogProduct?(productId: string): Promise<{ deleted: number }>;
  listCatalog?(cursor: string | null): Promise<WhatsAppCatalogPage>;
  removeQuickReply?(waId: string): Promise<void>;
  listGroupJoinRequests?(groupJid: string): Promise<WhatsAppGroupJoinRequest[]>;
  updateGroupJoinRequests?(groupJid: string, participants: string[], action: "approve" | "reject"): Promise<WhatsAppGroupParticipantUpdate[]>;
  updateGroupPicture?(groupJid: string, image: Buffer | null): Promise<void>;
  sendGroupText(groupJid: string, message: string, options?: SendOptions): Promise<SendTextResult>;
  sendGroupMedia(
    groupJid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult>;
  requestMessageHistory(input: {
    count: number;
    remoteJid: string;
    whatsappMessageId: string;
    fromMe: boolean;
    timestampMs: number;
  }): Promise<string>;
}

export type WhatsAppServiceFactory = (
  deviceId: string,
  authDirectory: string,
  onStateChange: DeviceStateListener,
  onInboundMessage: InboundMessageListener,
  onOutboundReceipt: OutboundReceiptListener,
  onMetadata: WhatsAppMetadataListener,
  onHistory: WhatsAppHistoryListener,
) => ManagedWhatsAppService;

export type DeviceInboundMessageListener = (
  deviceId: string,
  message: InboundMessage,
) => void | Promise<void>;
export type DeviceOutboundReceiptListener = (
  deviceId: string,
  receipt: OutboundMessageReceipt,
) => void;

export interface RestoreResult {
  restoredDeviceIds: string[];
  skippedCapacityDeviceIds: string[];
  skippedResetRequiredDeviceIds: string[];
}

export interface ManagedDevice {
  device: DeviceRecord;
  liveState: DeviceState;
}

const disconnectedState: DeviceState = {
  status: "disconnected",
  qr: null,
  jid: null,
  name: null,
  connectedAt: null,
  lastDisconnectReason: null,
  lastDisconnectCode: null,
  lastDisconnectedAt: null,
  loggedOut: false,
  requiresReset: false,
  reconnectAttempts: 0,
};

/** Owns every in-process WhatsApp service and optionally enforces an operator safety cap. */
export class DeviceManager {
  private readonly services = new Map<string, ManagedWhatsAppService>();
  private readonly connectionAttempts = new Map<string, Promise<DeviceState>>();
  private readonly reconnectAttempts = new Map<string, Promise<DeviceState>>();
  private readonly capacityReservations = new Set<string>();
  private readonly lifecycleOperations = new Map<string, Promise<unknown>>();
  private readonly legacyAuthDirectory: string;
  private readonly deviceAuthRoot: string;

  constructor(
    private readonly devices: DeviceRepository,
    legacyAuthDirectory: string,
    deviceAuthRoot: string,
    private readonly createService: WhatsAppServiceFactory = (
      _deviceId,
      authDirectory,
      onStateChange,
      onInboundMessage,
      onOutboundReceipt,
      onMetadata,
      onHistory,
    ) =>
      new WhatsAppService(
        authDirectory,
        onStateChange,
        undefined,
        onInboundMessage,
        onOutboundReceipt,
        onMetadata,
        onHistory,
      ),
    private readonly onInboundMessage: DeviceInboundMessageListener = () => undefined,
    private readonly onOutboundReceipt: DeviceOutboundReceiptListener = () => undefined,
    private readonly onMetadata: (deviceId: string, event: WhatsAppMetadataEvent) => void = () =>
      undefined,
    private readonly onHistory: (deviceId: string, event: WhatsAppHistoryEvent) => void = () =>
      undefined,
    private readonly options: { maxActiveDevices?: number; connectStaggerMs?: number } = {},
  ) {
    this.legacyAuthDirectory = resolve(legacyAuthDirectory);
    this.deviceAuthRoot = resolve(deviceAuthRoot);
    if (
      this.deviceAuthRoot === parse(this.deviceAuthRoot).root ||
      this.deviceAuthRoot === resolve(".") ||
      this.deviceAuthRoot === this.legacyAuthDirectory
    ) {
      throw new UnsafeAuthRootError(this.deviceAuthRoot);
    }
  }

  listDevices(): ManagedDevice[] {
    return this.devices.list().map((device) => ({
      device,
      liveState: this.liveStateFor(device),
    }));
  }

  createDevice(name: string): ManagedDevice {
    const device = this.devices.create({ id: randomUUID(), name });
    return { device, liveState: { ...disconnectedState } };
  }

  provisionTenantDevice(
    platformId: string,
    externalTenantId: string,
    name: string,
  ): ManagedDevice & { created: boolean } {
    // KIRIM-IMPL-005 §4.1: the tenant id is the Kirim SQ number code, and it is this worker's
    // device id too, so the auth folder, the database rows and the logs all name the same number.
    const result = this.devices.provisionForTenant({
      id: externalTenantId,
      name,
      platformId,
      externalTenantId,
    });
    return {
      device: result.device,
      liveState: this.liveStateFor(result.device),
      created: result.created,
    };
  }

  getTenantDevice(platformId: string, externalTenantId: string): ManagedDevice {
    const device = this.devices.getRequiredForTenant(platformId, externalTenantId);
    return {
      device,
      liveState: this.liveStateFor(device),
    };
  }

  getDevice(deviceId: string): ManagedDevice {
    return {
      device: this.devices.getRequired(deviceId),
      liveState: this.getDeviceState(deviceId),
    };
  }

  getDeviceState(deviceId: string): DeviceState {
    return this.liveStateFor(this.devices.getRequired(deviceId));
  }

  async connectDevice(deviceId: string): Promise<DeviceState> {
    const device = this.devices.getRequired(deviceId);
    if (device.parked) throw new DeviceParkedError(deviceId);
    if (device.requiresSessionReset) throw new WhatsAppSessionResetRequiredError();
    const service = this.getOrCreateService(deviceId);
    const existingAttempt = this.connectionAttempts.get(deviceId);
    if (existingAttempt) return existingAttempt;
    if (service.hasActiveSocket()) return service.connect();

    this.assertCapacity(deviceId);

    const attempt = service.connect();
    this.connectionAttempts.set(deviceId, attempt);
    try {
      return await attempt;
    } finally {
      this.connectionAttempts.delete(deviceId);
    }
  }

  async reconnectDevice(deviceId: string): Promise<DeviceState> {
    const device = this.devices.getRequired(deviceId);
    if (device.requiresSessionReset) throw new WhatsAppSessionResetRequiredError();
    const existing = this.reconnectAttempts.get(deviceId);
    if (existing) return existing;

    const reconnect = this.withLifecycleLock(deviceId, async () => {
      const service = this.getOrCreateService(deviceId);
      if (!service.hasActiveSocket()) return this.connectDevice(deviceId);
      return service.reconnect();
    });
    this.reconnectAttempts.set(deviceId, reconnect);
    try {
      return await reconnect;
    } finally {
      if (this.reconnectAttempts.get(deviceId) === reconnect) {
        this.reconnectAttempts.delete(deviceId);
      }
    }
  }

  async logoutDevice(deviceId: string): Promise<ManagedDevice> {
    return this.withLifecycleLock(deviceId, async () => {
      const service = this.getOrCreateService(deviceId);
      if (service.hasStoredCredentials() && !service.hasActiveSocket()) {
        await this.connectDevice(deviceId);
      }
      await service.logout();
      await this.clearCredentials(deviceId);
      this.devices.clearIdentity(deviceId);
      this.devices.updateDisconnected(deviceId, disconnectMetadata(service.getState()));
      return this.getDevice(deviceId);
    });
  }

  async resetDevice(deviceId: string): Promise<ManagedDevice> {
    return this.withLifecycleLock(deviceId, async () => {
      this.devices.getRequired(deviceId);
      const service = this.getOrCreateService(deviceId);
      this.assertCapacity(deviceId);
      this.capacityReservations.add(deviceId);
      try {
        await service.stop("session_reset");
        await this.clearCredentials(deviceId);
        this.services.delete(deviceId);
        this.devices.clearIdentity(deviceId);
        await this.connectDevice(deviceId);
        return this.getDevice(deviceId);
      } finally {
        this.capacityReservations.delete(deviceId);
      }
    });
  }

  async deleteDevice(deviceId: string): Promise<void> {
    return this.withLifecycleLock(deviceId, async () => {
      const device = this.devices.getRequired(deviceId);
      const service = this.getOrCreateService(deviceId);
      if (device.requiresSessionReset) {
        await service.stop("device_deleted");
      } else {
        if (service.hasStoredCredentials() && !service.hasActiveSocket()) {
          await this.connectDevice(deviceId);
        }
        if (service.hasActiveSocket()) {
          await service.logout();
        } else {
          await service.stop("device_deleted");
        }
      }
      await this.clearCredentials(deviceId);
      this.services.delete(deviceId);
      this.devices.softDelete(deviceId);
    });
  }

  async sendTextWithDevice(
    deviceId: string,
    phone: string,
    message: string,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    return this.getOrCreateService(deviceId).sendText(phone, message, options);
  }

  async sendTextToJidWithDevice(
    deviceId: string,
    jid: string,
    message: string,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    return this.getOrCreateService(deviceId).sendTextToJid(jid, message, options);
  }

  async sendMessageActionWithDevice(
    deviceId: string,
    action: MessageAction,
  ): Promise<SendTextResult> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.sendMessageAction) {
      throw new Error("Managed WhatsApp service does not support message actions");
    }
    return service.sendMessageAction(action);
  }

  async getProfilePictureWithDevice(deviceId: string, jid: string): Promise<Buffer | null> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.getProfilePicture) {
      throw new Error("Managed WhatsApp service does not support profile pictures");
    }
    return service.getProfilePicture(jid);
  }

  async markMessagesReadWithDevice(
    deviceId: string,
    messages: InboundReadReceiptKey[],
  ): Promise<void> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.markMessagesRead) {
      throw new Error("Managed WhatsApp service does not support read receipts");
    }
    return service.markMessagesRead(messages);
  }

  async sendMediaWithDevice(
    deviceId: string,
    phone: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    return this.getOrCreateService(deviceId).sendMedia(phone, media, options);
  }

  async sendMediaToIndividualJidWithDevice(
    deviceId: string,
    jid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    return this.getOrCreateService(deviceId).sendMediaToIndividualJid(jid, media, options);
  }

  async requestPairingCode(deviceId: string, phone: string): Promise<string> {
    const device = this.devices.getRequired(deviceId);
    if (device.requiresSessionReset) throw new WhatsAppSessionResetRequiredError();
    await this.connectDevice(deviceId);
    return this.getOrCreateService(deviceId).requestPairingCode(phone);
  }

  async listJoinedGroups(deviceId: string): Promise<WhatsAppGroupMetadata[]> {
    this.devices.getRequired(deviceId);
    return this.getOrCreateService(deviceId).listJoinedGroups();
  }

  async getGroupMetadata(deviceId: string, groupJid: string): Promise<WhatsAppGroupMetadata> {
    this.devices.getRequired(deviceId);
    return this.getOrCreateService(deviceId).getGroupMetadata(groupJid);
  }

  async createGroup(
    deviceId: string,
    subject: string,
    participants: string[],
  ): Promise<WhatsAppGroupMetadata> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.createGroup) throw new Error("Managed WhatsApp service does not support group creation");
    return service.createGroup(subject, participants);
  }

  async updateGroupParticipants(
    deviceId: string,
    groupJid: string,
    participants: string[],
    action: WhatsAppGroupParticipantAction,
  ): Promise<WhatsAppGroupParticipantUpdate[]> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateGroupParticipants) {
      throw new Error("Managed WhatsApp service does not support group participant management");
    }
    return service.updateGroupParticipants(groupJid, participants, action);
  }

  async updateGroupSubject(
    deviceId: string,
    groupJid: string,
    subject: string,
  ): Promise<WhatsAppGroupMetadata> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateGroupSubject) {
      throw new Error("Managed WhatsApp service does not support group subject changes");
    }
    return service.updateGroupSubject(groupJid, subject);
  }

  async updateGroupDescription(
    deviceId: string,
    groupJid: string,
    description: string | undefined,
  ): Promise<WhatsAppGroupMetadata> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateGroupDescription) {
      throw new Error("Managed WhatsApp service does not support group description changes");
    }
    return service.updateGroupDescription(groupJid, description);
  }

  async updateGroupSetting(
    deviceId: string,
    groupJid: string,
    setting: WhatsAppGroupSetting,
  ): Promise<void> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateGroupSetting) {
      throw new Error("Managed WhatsApp service does not support group setting changes");
    }
    return service.updateGroupSetting(groupJid, setting);
  }

  async getGroupInviteCode(deviceId: string, groupJid: string): Promise<string | null> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.getGroupInviteCode) {
      throw new Error("Managed WhatsApp service does not support group invite codes");
    }
    return service.getGroupInviteCode(groupJid);
  }

  async revokeGroupInvite(deviceId: string, groupJid: string): Promise<string | null> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.revokeGroupInvite) {
      throw new Error("Managed WhatsApp service does not support group invite revocation");
    }
    return service.revokeGroupInvite(groupJid);
  }

  async listGroupJoinRequests(deviceId: string, groupJid: string): Promise<WhatsAppGroupJoinRequest[]> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.listGroupJoinRequests) throw new Error("Managed WhatsApp service does not support group join requests");
    return service.listGroupJoinRequests(groupJid);
  }

  async updateGroupJoinRequests(
    deviceId: string,
    groupJid: string,
    participants: string[],
    action: "approve" | "reject",
  ): Promise<WhatsAppGroupParticipantUpdate[]> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateGroupJoinRequests) throw new Error("Managed WhatsApp service does not support group join requests");
    return service.updateGroupJoinRequests(groupJid, participants, action);
  }

  async updateGroupPicture(deviceId: string, groupJid: string, image: Buffer | null): Promise<void> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateGroupPicture) throw new Error("Managed WhatsApp service does not support group pictures");
    return service.updateGroupPicture(groupJid, image);
  }

  async listCatalog(deviceId: string, cursor: string | null): Promise<WhatsAppCatalogPage> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.listCatalog) throw new Error("Managed WhatsApp service does not support the catalog");
    return service.listCatalog(cursor);
  }

  async upsertQuickReply(deviceId: string, waId: string | null, shortcut: string, message: string): Promise<string> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.upsertQuickReply) throw new Error("Managed WhatsApp service does not support quick replies");
    return service.upsertQuickReply(waId, shortcut, message);
  }

  async resyncQuickReplies(deviceId: string): Promise<boolean> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.resyncQuickReplies) throw new Error("Managed WhatsApp service does not support quick replies");
    return service.resyncQuickReplies();
  }

  async applyChatLabels(
    deviceId: string,
    input: { chatJids: string[]; managed: string[]; wanted: string[] },
    store: WhatsAppLabelStore,
  ): Promise<string[]> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.applyChatLabels) throw new Error("Managed WhatsApp service does not support labels");
    return service.applyChatLabels(input, store);
  }

  async updateBusinessHours(deviceId: string, hours: BusinessHours): Promise<{ verified: boolean | null }> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.updateBusinessHours) throw new Error("Managed WhatsApp service does not support business hours");
    return service.updateBusinessHours(hours);
  }

  async getBusinessProfile(deviceId: string): Promise<WhatsAppBusinessProfile> {
    return this.business(deviceId, "getBusinessProfile")();
  }

  async updateBusinessProfile(
    deviceId: string,
    update: BusinessProfileUpdate,
  ): Promise<{ verified: boolean | null; profile: WhatsAppBusinessProfile | null }> {
    return this.business(deviceId, "updateBusinessProfile")(update);
  }

  async updateOwnProfilePicture(deviceId: string, image: Buffer | null): Promise<{ verified: boolean | null }> {
    return this.business(deviceId, "updateOwnProfilePicture")(image);
  }

  async updateCoverPhoto(deviceId: string, image: Buffer): Promise<{ id: string; verified: boolean | null }> {
    return this.business(deviceId, "updateCoverPhoto")(image);
  }

  async removeCoverPhoto(deviceId: string, id: string | null): Promise<{ id: string }> {
    return this.business(deviceId, "removeCoverPhoto")(id);
  }

  async createCatalogProduct(deviceId: string, input: CatalogProductInput): Promise<CatalogProductWrite> {
    return this.business(deviceId, "createCatalogProduct")(input);
  }

  async updateCatalogProduct(deviceId: string, productId: string, input: CatalogProductInput): Promise<CatalogProductWrite> {
    return this.business(deviceId, "updateCatalogProduct")(productId, input);
  }

  async deleteCatalogProduct(deviceId: string, productId: string): Promise<{ deleted: number }> {
    return this.business(deviceId, "deleteCatalogProduct")(productId);
  }

  /** A WhatsApp Business profile or catalog operation of the device's service, bound to it. */
  private business<K extends
    | "getBusinessProfile"
    | "updateBusinessProfile"
    | "updateOwnProfilePicture"
    | "updateCoverPhoto"
    | "removeCoverPhoto"
    | "createCatalogProduct"
    | "updateCatalogProduct"
    | "deleteCatalogProduct">(deviceId: string, name: K): NonNullable<ManagedWhatsAppService[K]> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    const operation = service[name];
    if (!operation) throw new Error(`Managed WhatsApp service does not support ${name}`);
    return (operation as (...args: never[]) => unknown).bind(service) as NonNullable<ManagedWhatsAppService[K]>;
  }

  async removeQuickReply(deviceId: string, waId: string): Promise<void> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.removeQuickReply) throw new Error("Managed WhatsApp service does not support quick replies");
    return service.removeQuickReply(waId);
  }

  async leaveGroup(deviceId: string, groupJid: string): Promise<void> {
    this.devices.getRequired(deviceId);
    const service = this.getOrCreateService(deviceId);
    if (!service.leaveGroup) throw new Error("Managed WhatsApp service does not support leaving groups");
    return service.leaveGroup(groupJid);
  }

  async sendGroupTextWithDevice(
    deviceId: string,
    groupJid: string,
    message: string,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    this.devices.getRequired(deviceId);
    return this.getOrCreateService(deviceId).sendGroupText(groupJid, message, options);
  }

  async sendGroupMediaWithDevice(
    deviceId: string,
    groupJid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    this.devices.getRequired(deviceId);
    return this.getOrCreateService(deviceId).sendGroupMedia(groupJid, media, options);
  }

  async requestMessageHistory(
    deviceId: string,
    input: {
      count: number;
      remoteJid: string;
      whatsappMessageId: string;
      fromMe: boolean;
      timestampMs: number;
    },
  ): Promise<string> {
    this.devices.getRequired(deviceId);
    return this.getOrCreateService(deviceId).requestMessageHistory(input);
  }

  /**
   * KIRIM-IMPL-005 §9: stops this number's socket without logging out and without touching its
   * stored credentials, and remembers that it must stay down across restarts. Used when a number
   * is handed back to the other engine: two processes must never hold the same WhatsApp session.
   */
  async parkDevice(deviceId: string): Promise<void> {
    this.devices.getRequired(deviceId);
    this.devices.setParked(deviceId, true);
    const service = this.services.get(deviceId);
    if (service) await service.stop("parked");
  }

  /** Lets a parked number connect again; it does not connect it. */
  unparkDevice(deviceId: string): void {
    this.devices.getRequired(deviceId);
    this.devices.setParked(deviceId, false);
  }

  async restoreIfAuthenticated(): Promise<RestoreResult> {
    const result: RestoreResult = {
      restoredDeviceIds: [],
      skippedCapacityDeviceIds: [],
      skippedResetRequiredDeviceIds: [],
    };

    for (const device of this.devices.list()) {
      // A parked number is one this worker must not hold (KIRIM-IMPL-005 §9); it is not an error.
      if (device.parked) continue;
      if (device.requiresSessionReset) {
        result.skippedResetRequiredDeviceIds.push(device.id);
        continue;
      }
      const service = this.getOrCreateService(device.id);
      if (!service.hasStoredCredentials()) continue;

      try {
        // KIRIM-IMPL-005 §4.4: opened one at a time, with a pause between, so four sockets do not
        // negotiate at once on a 3.8 GB phone.
        if (result.restoredDeviceIds.length > 0 && this.options.connectStaggerMs) {
          await new Promise((done) => setTimeout(done, this.options.connectStaggerMs));
        }
        await this.connectDevice(device.id);
        result.restoredDeviceIds.push(device.id);
      } catch (error) {
        if (error instanceof DeviceCapacityError) {
          result.skippedCapacityDeviceIds.push(device.id);
          continue;
        }
        throw error;
      }
    }

    return result;
  }

  activeSocketCount(): number {
    return this.activeDeviceIds().size;
  }

  maxActiveDevices(): number | undefined {
    return this.options.maxActiveDevices;
  }

  /**
   * KIRIM-IMPL-005 §4.1: one folder per number, named by the Kirim SQ number code itself
   * (`^[a-z][a-z0-9-]{1,30}$`, which is also this worker's device id), not by a hash of an
   * internal id as JalurPesan did. The runbook an operator follows has to name a folder they
   * can see; the pattern is narrow enough to be a safe path segment, and `clearCredentials`
   * still checks that the resolved target sits directly under the auth root.
   */
  authDirectoryFor(deviceId: string): string {
    const device = this.devices.getRequired(deviceId);
    if (device.authStorageSlot === "legacy") return this.legacyAuthDirectory;
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(device.id)) throw new UnsafeAuthDirectoryError(deviceId, device.id);
    return join(this.deviceAuthRoot, device.id);
  }

  private getOrCreateService(deviceId: string): ManagedWhatsAppService {
    this.devices.getRequired(deviceId);
    let service = this.services.get(deviceId);
    if (!service) {
      service = this.createService(
        deviceId,
        this.authDirectoryFor(deviceId),
        (state) => this.persistLiveMetadata(deviceId, state),
        (message) => this.onInboundMessage(deviceId, message),
        (receipt) => this.onOutboundReceipt(deviceId, receipt),
        (event) => this.onMetadata(deviceId, event),
        (event) => this.onHistory(deviceId, event),
      );
      this.services.set(deviceId, service);
    }
    return service;
  }

  private assertCapacity(deviceId: string): void {
    const maxActiveDevices = this.options.maxActiveDevices;
    if (maxActiveDevices === undefined) return;
    const activeDeviceIds = this.activeDeviceIds();
    if (!activeDeviceIds.has(deviceId) && activeDeviceIds.size >= maxActiveDevices) {
      throw new DeviceCapacityError(deviceId, maxActiveDevices);
    }
  }

  private liveStateFor(device: DeviceRecord): DeviceState {
    const liveState = this.services.get(device.id)?.getState();
    if (!liveState) return stateFromDevice(device);
    if (
      liveState.status === "disconnected" &&
      liveState.lastDisconnectedAt === null &&
      device.lastDisconnectedAt !== null
    ) {
      return {
        ...liveState,
        lastDisconnectReason: device.lastDisconnectReason,
        lastDisconnectCode: device.lastDisconnectCode,
        lastDisconnectedAt: device.lastDisconnectedAt,
        loggedOut: device.lastDisconnectReason === "logged_out",
        requiresReset: device.requiresSessionReset,
      };
    }
    return liveState;
  }

  private activeDeviceIds(): Set<string> {
    const active = new Set([...this.connectionAttempts.keys(), ...this.capacityReservations]);
    for (const [deviceId, service] of this.services) {
      if (service.hasActiveSocket() || service.getState().status === "connecting") {
        active.add(deviceId);
      }
    }
    return active;
  }

  private persistLiveMetadata(deviceId: string, state: DeviceState): void {
    try {
      if (state.status === "connected" && state.connectedAt) {
        this.devices.updateConnected(deviceId, {
          whatsappJid: state.jid,
          whatsappPhone: phoneFromJid(state.jid),
          whatsappDisplayName: state.name,
          connectedAt: state.connectedAt,
        });
      } else if (state.lastDisconnectedAt) {
        this.devices.updateDisconnected(deviceId, disconnectMetadata(state));
      }
    } catch (error) {
      if (!(error instanceof DeviceNotFoundError)) throw error;
    }
  }

  private async clearCredentials(deviceId: string): Promise<void> {
    const device = this.devices.getRequired(deviceId);
    const target = resolve(this.authDirectoryFor(deviceId));
    const usesLegacySlot = device.authStorageSlot === "legacy";
    const expectedParent = usesLegacySlot ? dirname(this.legacyAuthDirectory) : this.deviceAuthRoot;

    if (
      target === parse(target).root ||
      target === resolve(".") ||
      dirname(target) !== expectedParent ||
      (usesLegacySlot && target !== this.legacyAuthDirectory)
    ) {
      throw new UnsafeAuthDirectoryError(deviceId, target);
    }

    if (!usesLegacySlot) {
      try {
        const rootStats = await lstat(this.deviceAuthRoot);
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
          throw new UnsafeAuthDirectoryError(deviceId, target);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    let stats;
    try {
      stats = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new UnsafeAuthDirectoryError(deviceId, target);
    }
    await assertNoSymbolicLinks(deviceId, target);
    if (usesLegacySlot) {
      for (const entry of await readdir(target, { withFileTypes: true })) {
        await rm(join(target, entry.name), { recursive: entry.isDirectory(), force: false });
      }
    } else {
      await rm(target, { recursive: true, force: false });
    }
  }

  private async withLifecycleLock<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.lifecycleOperations.get(deviceId);
    const current = (async () => {
      if (existing) {
        try {
          await existing;
        } catch {
        }
      }
      return operation();
    })();
    this.lifecycleOperations.set(deviceId, current);
    try {
      return await current;
    } finally {
      if (this.lifecycleOperations.get(deviceId) === current) {
        this.lifecycleOperations.delete(deviceId);
      }
    }
  }
}

function stateFromDevice(device: DeviceRecord): DeviceState {
  return {
    ...disconnectedState,
    lastDisconnectReason: device.lastDisconnectReason,
    lastDisconnectCode: device.lastDisconnectCode,
    lastDisconnectedAt: device.lastDisconnectedAt,
    loggedOut: device.lastDisconnectReason === "logged_out",
    requiresReset: device.requiresSessionReset,
  };
}

function disconnectMetadata(state: DeviceState) {
  return {
    reason: state.lastDisconnectReason,
    code: state.lastDisconnectCode,
    disconnectedAt: state.lastDisconnectedAt ?? new Date().toISOString(),
    requiresSessionReset: state.requiresReset,
  };
}

function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null;
  return jid.split(":", 1)[0]?.split("@", 1)[0] ?? null;
}

async function assertNoSymbolicLinks(deviceId: string, directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    const stats = await lstat(child);
    if (stats.isSymbolicLink()) throw new UnsafeAuthDirectoryError(deviceId, child);
    if (stats.isDirectory()) await assertNoSymbolicLinks(deviceId, child);
  }
}

export class DeviceCapacityError extends Error {
  constructor(
    readonly deviceId: string,
    readonly maxActiveSockets: number,
  ) {
    super(
      `Cannot activate device ${deviceId}: configured maximum ${maxActiveSockets} active devices reached`,
    );
    this.name = "DeviceCapacityError";
  }
}

export class UnsafeAuthDirectoryError extends Error {
  constructor(
    readonly deviceId: string,
    readonly directory: string,
  ) {
    super(`Refusing to remove unsafe auth directory for device ${deviceId}`);
    this.name = "UnsafeAuthDirectoryError";
  }
}

export class UnsafeAuthRootError extends Error {
  constructor(readonly directory: string) {
    super("WA_DEVICE_AUTH_ROOT must be a dedicated non-root directory");
    this.name = "UnsafeAuthRootError";
  }
}

/** KIRIM-IMPL-005 §9: the number is deliberately held down here, usually because another engine has it. */
export class DeviceParkedError extends Error {
  constructor(readonly deviceId: string) {
    super(`Device is parked: ${deviceId}`);
    this.name = "DeviceParkedError";
  }
}
