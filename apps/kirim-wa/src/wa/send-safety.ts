export interface SendSafetyConfig {
  minimumIntervalMs: number;
  maxPerMinute: number;
  maxPerHour: number;
  duplicateWindowMs: number;
}

export const DEFAULT_SEND_SAFETY_CONFIG: SendSafetyConfig = {
  minimumIntervalMs: 2_000,
  maxPerMinute: 20,
  maxPerHour: 200,
  duplicateWindowMs: 60_000,
};

interface DeviceSendState {
  active: boolean;
  lastStartedAt: number | null;
  startedAt: number[];
  duplicates: Map<string, number>;
}

export class SendSafetyError extends Error {
  constructor(
    readonly code:
      "send_in_progress" | "minimum_interval" | "minute_limit" | "hour_limit" | "duplicate",
    readonly retryAfterMs: number,
  ) {
    super(sendSafetyMessage(code));
    this.name = "SendSafetyError";
  }
}

/** In-process v0.2 guardrails; state is intentionally isolated per device. */
export class PerDeviceSendSafety {
  private readonly devices = new Map<string, DeviceSendState>();

  constructor(
    private readonly config: SendSafetyConfig = DEFAULT_SEND_SAFETY_CONFIG,
    private readonly now: () => number = Date.now,
  ) {}

  acquire(deviceId: string, recipient: string, message: string): () => void {
    const timestamp = this.now();
    const state = this.devices.get(deviceId) ?? {
      active: false,
      lastStartedAt: null,
      startedAt: [],
      duplicates: new Map<string, number>(),
    };
    this.devices.set(deviceId, state);
    this.prune(state, timestamp);

    if (state.active) throw new SendSafetyError("send_in_progress", 0);
    if (state.lastStartedAt !== null) {
      const remaining = this.config.minimumIntervalMs - (timestamp - state.lastStartedAt);
      if (remaining > 0) throw new SendSafetyError("minimum_interval", remaining);
    }
    const duplicateKey = JSON.stringify([recipient, message]);
    const duplicateAt = state.duplicates.get(duplicateKey);
    if (duplicateAt !== undefined) {
      const remaining = this.config.duplicateWindowMs - (timestamp - duplicateAt);
      if (remaining > 0) throw new SendSafetyError("duplicate", remaining);
    }
    if (
      state.startedAt.filter((startedAt) => timestamp - startedAt < 60_000).length >=
      this.config.maxPerMinute
    ) {
      throw new SendSafetyError("minute_limit", 60_000);
    }
    if (state.startedAt.length >= this.config.maxPerHour) {
      throw new SendSafetyError("hour_limit", 60 * 60_000);
    }

    state.active = true;
    state.lastStartedAt = timestamp;
    state.startedAt.push(timestamp);
    state.duplicates.set(duplicateKey, timestamp);
    return () => {
      state.active = false;
    };
  }

  private prune(state: DeviceSendState, timestamp: number): void {
    state.startedAt = state.startedAt.filter((startedAt) => timestamp - startedAt < 60 * 60_000);
    for (const [key, sentAt] of state.duplicates) {
      if (timestamp - sentAt >= this.config.duplicateWindowMs) state.duplicates.delete(key);
    }
  }
}

function sendSafetyMessage(code: SendSafetyError["code"]): string {
  switch (code) {
    case "send_in_progress":
      return "A send is already in progress for this device";
    case "minimum_interval":
      return "This device must wait before sending another message";
    case "minute_limit":
      return "This device has reached its per-minute send limit";
    case "hour_limit":
      return "This device has reached its per-hour send limit";
    case "duplicate":
      return "An identical message to this recipient was sent recently";
  }
}
