export type KeeperLogFormat = "text" | "json";

export type KeeperEventType =
  | "watch-start"
  | "tick-start"
  | "tick-end"
  | "discover-rounds"
  | "retry"
  | "reveal-open"
  | "reveal"
  | "reveal-skip"
  | "clear"
  | "settle"
  | "void"
  | "error"
  | "watch-stop";

export interface KeeperEvent {
  timestamp: string;
  network: string;
  contract: string;
  event: KeeperEventType;
  round?: string;
  status: string;
  message?: string;
  action?: string;
  error?: {
    name: string;
    message: string;
    code?: string;
  };
  details?: Record<string, unknown>;
}

export type KeeperEventInput = Omit<KeeperEvent, "timestamp" | "network" | "contract">;

export interface KeeperTelemetry {
  emit(event: KeeperEventInput): void;
}

const SENSITIVE_KEY_RE = /secret|xdr|signature/i;
const SECRET_KEYPAIR_RE = /^[SB][A-Z2-7]{55}$/;

function redactValue(key: string | undefined, value: unknown): unknown {
  if (key && SENSITIVE_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (SECRET_KEYPAIR_RE.test(value)) return "[REDACTED]";
    if (/signed\s*xdr/i.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(undefined, item));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = redactValue(childKey, childValue);
    }
    return result;
  }
  return value;
}

function sanitizeEvent(event: KeeperEvent): KeeperEvent {
  return {
    ...event,
    message: event.message ? String(redactValue("message", event.message)) : undefined,
    details: event.details ? (redactValue(undefined, event.details) as Record<string, unknown>) : undefined,
    error: event.error
      ? {
          name: String(redactValue("error.name", event.error.name)),
          message: String(redactValue("error.message", event.error.message)),
          code: event.error.code ? String(redactValue("error.code", event.error.code)) : undefined,
        }
      : undefined,
  };
}

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function serializeEventToJson(event: KeeperEvent): string {
  return JSON.stringify(sanitizeEvent(event), replacer);
}

function formatEventToText(event: KeeperEvent): string {
  const parts = [`${event.timestamp}`, event.event, `status=${event.status}`];
  if (event.round) parts.push(`round=${event.round}`);
  if (event.message) parts.push(event.message);
  if (event.action) parts.push(`action=${event.action}`);
  if (event.error) parts.push(`${event.error.name}: ${event.error.message}`);
  if (event.details) parts.push(JSON.stringify(redactValue(undefined, event.details), replacer));
  return parts.join(" ");
}

export function createKeeperTelemetry(config: {
  format: KeeperLogFormat;
  network: string;
  contract: string;
}): KeeperTelemetry {
  const { format, network, contract } = config;

  return {
    emit(eventInput: KeeperEventInput) {
      const event: KeeperEvent = sanitizeEvent({
        timestamp: new Date().toISOString(),
        network,
        contract,
        ...eventInput,
      });

      if (format === "json") {
        process.stdout.write(serializeEventToJson(event) + "\n");
      } else {
        console.log(formatEventToText(event));
      }
    },
  };
}

export function serializeKeeperEvent(event: KeeperEvent): string {
  return serializeEventToJson(event);
}
