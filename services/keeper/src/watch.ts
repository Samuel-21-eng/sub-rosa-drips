// Watch-mode keeper — standalone entry. For a combined status-API + watch
// process, use `serve.ts` instead.
//
// Env:
//   ROUND_CONTRACT_ID   deployed Round contract id (C…)
//   KEEPER_SECRET       funded signer secret (S…)
//   RPC_URL             Soroban RPC (default testnet)
//   NETWORK_PASSPHRASE
//   WATCH_POLL_MS       poll interval (default 15000)
//   WATCH_ROUND_IDS     optional explicit list: "1,2,5" or "1-10"
//   WATCH_FROM          first round id when auto-discovering (default 1)
//   WATCH_MAX_ROUNDS    max rounds to probe (default 64)

import { Keypair } from "@stellar/stellar-sdk";
import { SubRosaClient } from "@sub-rosa/sdk";
import { quicknet } from "@sub-rosa/tlock";

import { createSettlementGuard } from "./settlement-guard.js";
import { KeeperStore } from "./store.js";
import { runWatchLoop } from "./watch-loop.js";
import {
  discoverRoundIds,
  errorCode,
  errorName,
  parseRoundIdSpec,
  watchRound,
  type WatchTickResult,
} from "./keeper.js";
import { createKeeperTelemetry, type KeeperLogFormat } from "./telemetry.js";
import { KeeperHealthStore, createHealthServer } from "./health.js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

async function main() {
  const pollMs = Number(process.env.WATCH_POLL_MS ?? "15000");
  const contractId = reqEnv("ROUND_CONTRACT_ID");
  const rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const keeperSecret = reqEnv("KEEPER_SECRET");

  const sdk = new SubRosaClient({
    rpcUrl,
    networkPassphrase,
    contractId,
    secretKey: keeperSecret,
  });
  const drand = quicknet();
  const format = (process.env.KEEPER_LOG_FORMAT as KeeperLogFormat) ?? "text";
  const telemetry = createKeeperTelemetry({
    format,
    network: networkPassphrase,
    contract: contractId,
  });
  const healthEnabled = process.env.KEEPER_HEALTH_ENABLED !== "false";
  const healthPort = Number(process.env.KEEPER_HEALTH_PORT ?? "8080");
  const health = new KeeperHealthStore();
  let healthServer: Awaited<ReturnType<typeof createHealthServer>> | undefined;

  const log = (m: string) => {
    if (format === "json") {
      telemetry.emit({
        event: "watch-start",
        status: "info",
        action: "log",
        message: m,
      });
    } else {
      console.log(`· ${m}`);
    }
  };

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\nwatch: SIGINT — finishing current tick then exit");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  const store = new KeeperStore();
  const settlementGuard = createSettlementGuard();

  console.log("Sub Rosa watch-mode keeper");
  console.log("· contract:", contractId);
  console.log("· log format:", format);
  console.log("· poll:    ", pollMs, "ms");
  if (healthEnabled) {
    console.log("· health:  ", `http://127.0.0.1:${healthPort}/health`);
  }
  console.log("· Ctrl+C to stop\n");

<<<<<<< HEAD
  await runWatchLoop({
    sdk,
    drand,
    log,
    pollMs,
    contractId,
    network: networkPassphrase,
    store,
    settlementGuard,
    isStopping: () => stopping,
  });
=======
  if (healthEnabled) {
    healthServer = createHealthServer(health, healthPort);
    await healthServer.listen();
  }

  telemetry.emit({
    event: "watch-start",
    status: "started",
    action: "watch-loop",
    message: "keeper watch started",
  });

  while (!stopping) {
    health.recordTickStart();
    const started = Date.now();
    let roundIds: bigint[];
    try {
      roundIds = await resolveRoundIds(reader);
      telemetry.emit({
        event: "discover-rounds",
        status: "success",
        action: "resolve-rounds",
        message: `discovered ${roundIds.length} round(s)`,
      });
    } catch (e) {
      telemetry.emit({
        event: "error",
        status: "failed",
        action: "discover-rounds",
        message: "failed to list rounds",
        error: {
          name: errorName(e),
          message: String(e instanceof Error ? e.message : JSON.stringify(e)),
          code: errorCode(e),
        },
      });
      console.error("watch: failed to list rounds:", e);
      await sleep(pollMs);
      continue;
    }

    if (roundIds.length === 0) {
      log("no rounds found — waiting");
    }

    for (const roundId of roundIds) {
      if (stopping) break;
      try {
        const tick = await watchRound({ sdk, drand, log, telemetry }, roundId);
        const active =
          tick.finalStatus !== "Settled" && tick.finalStatus !== "Voided";
        const acted =
          tick.void?.voided ||
          tick.keep?.openedReveal ||
          (tick.keep?.revealed.length ?? 0) > 0 ||
          tick.close?.cleared ||
          tick.close?.settled;
        health.recordRoundCheck(roundId, active);
        health.recordAction(`round ${roundId} processed`);
        if (active || acted) {
          if (format === "json") {
            telemetry.emit({
              event: "tick-end",
              status: "info",
              round: roundId.toString(),
              action: "watch-summary",
              message: summarizeTick(tick),
              details: tick,
            });
          } else {
            console.log(
              `[round ${roundId}] ${summarizeTick(tick)}`,
              acted ? JSON.stringify(tick, bigintReplacer) : "",
            );
          }
        }
      } catch (e) {
        health.recordError(roundId, String(e instanceof Error ? e.message : JSON.stringify(e)));
        telemetry.emit({
          event: "error",
          status: "failed",
          round: roundId.toString(),
          action: "watchRound",
          message: "tick failed",
          error: {
            name: errorName(e),
            message: String(e instanceof Error ? e.message : JSON.stringify(e)),
            code: errorCode(e),
          },
        });
        console.error(`[round ${roundId}] tick failed:`, e);
      }
    }

    const elapsed = Date.now() - started;
    const wait = Math.max(0, pollMs - elapsed);
    if (!stopping && wait > 0) await sleep(wait);
  }
>>>>>>> 5bf2bd6 (feat(keeper): add structured events, JSON logging, and localhost health snapshot)

  telemetry.emit({
    event: "watch-stop",
    status: "stopped",
    action: "watch-loop",
    message: "keeper watch stopped",
  });
  console.log("watch: stopped");

  if (healthServer) {
    await healthServer.close();
  }
}

main().catch((err) => {
  console.error("watch keeper failed:", err);
  process.exit(1);
});
