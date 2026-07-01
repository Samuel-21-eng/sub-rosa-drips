import http from "node:http";

export interface KeeperHealthSnapshot {
  startedAt: string;
  lastTickAt?: string;
  checkedRounds: number;
  activeRounds: string[];
  lastAction?: string;
  recentErrors: Array<{ timestamp: string; round?: string; message: string }>;
  ready: boolean;
}

export class KeeperHealthStore {
  private startedAt = new Date().toISOString();
  private lastTickAt?: string;
  private checkedRounds = 0;
  private activeRounds: Set<bigint> = new Set();
  private lastAction?: string;
  private recentErrors: Array<{ timestamp: string; round?: string; message: string }> = [];

  public recordTickStart() {
    this.lastTickAt = new Date().toISOString();
  }

  public recordRoundCheck(round: bigint, active: boolean) {
    this.checkedRounds += 1;
    if (active) {
      this.activeRounds.add(round);
    } else {
      this.activeRounds.delete(round);
    }
  }

  public recordAction(action: string) {
    this.lastAction = action;
  }

  public recordError(round: bigint | undefined, message: string) {
    this.recentErrors.unshift({ timestamp: new Date().toISOString(), round: round?.toString(), message });
    if (this.recentErrors.length > 10) this.recentErrors.pop();
  }

  public buildSnapshot(): KeeperHealthSnapshot {
    return {
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      checkedRounds: this.checkedRounds,
      activeRounds: [...this.activeRounds.values()]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((value) => value.toString()),
      lastAction: this.lastAction,
      recentErrors: [...this.recentErrors],
      ready: true,
    };
  }
}

export function createHealthServer(snapshot: KeeperHealthStore, port: number) {
  const server = http.createServer((req, res) => {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      return res.end("Bad request");
    }
    if (req.url === "/health" || req.url === "/ready") {
      const body = JSON.stringify(snapshot.buildSnapshot(), null, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(body);
    }
    res.statusCode = 404;
    res.end("Not found");
  });

  return {
    server,
    async listen() {
      return new Promise<void>((resolve, reject) => {
        server.listen(port, "127.0.0.1", (err?: Error) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },
  };
}
