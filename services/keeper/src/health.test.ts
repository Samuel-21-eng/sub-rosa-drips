import { test } from "node:test";
import assert from "node:assert/strict";

import { KeeperHealthStore, createHealthServer } from "./health.js";

test("health snapshot tracks ticks and active rounds", () => {
  const store = new KeeperHealthStore();
  store.recordTickStart();
  store.recordRoundCheck(1n, true);
  store.recordRoundCheck(2n, false);
  store.recordAction("checked round 1");
  store.recordError(1n, "failed action");

  const snapshot = store.buildSnapshot();
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.checkedRounds, 2);
  assert.deepEqual(snapshot.activeRounds, ["1"]);
  assert.equal(snapshot.lastAction, "checked round 1");
  assert.equal(snapshot.recentErrors.length, 1);
  assert.equal(snapshot.recentErrors[0].round, "1");
});

test("health server responds on /health and /ready", async () => {
  const store = new KeeperHealthStore();
  const server = createHealthServer(store, 0);
  await server.listen();
  const address = (server as any).server.address();
  assert(address && typeof address.port === "number");
  const port = address.port;

  const fetch = await import("node:http");
  const readBody = (res: import("node:http").IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

  const content = await new Promise<string>((resolve, reject) => {
    const req = fetch.request({ hostname: "127.0.0.1", port, path: "/health", method: "GET" }, async (res) => {
      resolve(await readBody(res));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(JSON.parse(content).ready, true);

  await server.close();
});
