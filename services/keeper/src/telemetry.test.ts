import { test } from "node:test";
import assert from "node:assert/strict";

import { createKeeperTelemetry, serializeKeeperEvent } from "./telemetry.js";

test("telemetry redacts sensitive values and serializes JSON", () => {
  const emitted: string[] = [];
  const telemetry = createKeeperTelemetry({
    format: "json",
    network: "testnet",
    contract: "C123",
  });
  const originalWrite = process.stdout.write;
  try {
    process.stdout.write = (chunk: string | Uint8Array) => {
      emitted.push(String(chunk));
      return true;
    };

    telemetry.emit({
      event: "error",
      status: "failed",
      action: "test",
      message: "sensitive secret info",
      error: {
        name: "TestError",
        message: "signed xdr payload",
        code: "SecretCode",
      },
      details: {
        secretKey: "SB...",
        signedXdr: "somesignedxdr",
        tex: "keep",
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(emitted.length, 1);
  const parsed = JSON.parse(emitted[0]);
  assert.equal(parsed.network, "testnet");
  assert.equal(parsed.contract, "C123");
  assert.equal(parsed.error.message, "[REDACTED]");
  assert.equal(parsed.details.secretKey, "[REDACTED]");
  assert.equal(parsed.details.signedXdr, "[REDACTED]");
  assert.equal(parsed.details.tex, "keep");
});

test("serializeKeeperEvent converts bigint values to strings", () => {
  const event = {
    timestamp: "2026-01-01T00:00:00.000Z",
    network: "testnet",
    contract: "C123",
    event: "watch-start",
    status: "started",
    round: "42",
    message: "started",
    details: { score: 123n },
  };
  const json = serializeKeeperEvent(event);
  const parsed = JSON.parse(json);
  assert.equal(parsed.details.score, "123");
});
