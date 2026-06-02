import { useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { RoundContract } from "@sub-rosa/sdk";
import {
  fetchRoundSignature,
  generateAuditorKeypair,
  generateNonce,
  openBid,
  quicknet,
  roundInSeconds,
  sealBid,
} from "@sub-rosa/tlock";
import type { BidState, Round } from "@sub-rosa/sdk";
import { DrandCountdownChip } from "./components/DrandCountdownChip";
import { DEMO_TRACE } from "./demo/trace";
import { shortAddr } from "./lib/format";

const LOGO_SRC = "/sub-rosa-logo.png";
const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK =
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID;
const ESCROW_TOKEN_LABEL = import.meta.env.VITE_ESCROW_TOKEN_LABEL ?? "token";
const DEFAULT_ROUND_ID = import.meta.env.VITE_ROUND_ID
  ? BigInt(import.meta.env.VITE_ROUND_ID)
  : null;

type Page = "landing" | "app";
type UseCaseId = "dao" | "grants" | "bounty" | "allocation";
type ActionStatus = "idle" | "working" | "ok" | "error";

interface UseCase {
  id: UseCaseId;
  nav: string;
  title: string;
  oneLine: string;
  inputLabel: string;
  defaultValue: number;
  traditional: string;
  subrosa: string;
  examples: Array<{ name: string; value: number }>;
}

interface LiveRound {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
}

interface CaseSession {
  roundId: bigint | null;
  auditorPublicKey: Uint8Array | null;
  commitValue: bigint | null;
  live: LiveRound | null;
  log: string[];
}

const USE_CASES: UseCase[] = [
  {
    id: "dao",
    nav: "DAO Vote",
    title: "Join a sealed DAO vote as the last voter.",
    oneLine: "Votes stay hidden until Drand R, then anyone can open the full result.",
    inputLabel: "your vote weight",
    defaultValue: 72,
    traditional: "Late voters see momentum and can pile onto the visible winner.",
    subrosa: "Your vote is sealed on-chain; the DAO only sees the final opened set.",
    examples: [
      { name: "Member A", value: 61 },
      { name: "Member B", value: 70 },
      { name: "Member C", value: 66 },
    ],
  },
  {
    id: "grants",
    nav: "Grant Scores",
    title: "Score a grant without leaking the jury board.",
    oneLine: "A final judge cannot be influenced by seeing everyone else's score.",
    inputLabel: "your score",
    defaultValue: 87,
    traditional: "The leaderboard leaks early and scoring becomes political.",
    subrosa: "Every judge commits sealed; the keeper opens all scores together.",
    examples: [
      { name: "Judge A", value: 82 },
      { name: "Judge B", value: 91 },
      { name: "Judge C", value: 76 },
    ],
  },
  {
    id: "bounty",
    nav: "Bounty Track",
    title: "Submit a bounty evaluation without tipping the meta.",
    oneLine: "Hackathon teams cannot infer the winning range before close.",
    inputLabel: "your evaluation",
    defaultValue: 94,
    traditional: "Visible evaluations let teams optimize for leaked judging patterns.",
    subrosa: "Submissions and evaluations stay private until the reveal round.",
    examples: [
      { name: "Reviewer 1", value: 89 },
      { name: "Reviewer 2", value: 92 },
      { name: "Reviewer 3", value: 84 },
    ],
  },
  {
    id: "allocation",
    nav: "Token Allocation",
    title: "Enter an allocation round before demand is visible.",
    oneLine: "Early visibility cannot distort participation or pricing.",
    inputLabel: "your allocation signal",
    defaultValue: 120,
    traditional: "Participants see demand forming and change behavior before close.",
    subrosa: "Demand is sealed until R; clearing uses one public reveal set.",
    examples: [
      { name: "Cohort A", value: 104 },
      { name: "Cohort B", value: 133 },
      { name: "Cohort C", value: 118 },
    ],
  },
];

function routeFromHash(): { page: Page; useCase: UseCaseId } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash || hash === "landing") return { page: "landing", useCase: "bounty" };
  const [, maybeCase] = hash.split("/");
  const useCase = USE_CASES.some((item) => item.id === maybeCase)
    ? (maybeCase as UseCaseId)
    : "dao";
  return { page: "app", useCase };
}

function emptySession(roundId: bigint | null = null): CaseSession {
  return {
    roundId,
    auditorPublicKey: null,
    commitValue: null,
    live: null,
    log: [],
  };
}

function initialSessions(): Record<UseCaseId, CaseSession> {
  return {
    dao: emptySession(DEFAULT_ROUND_ID),
    grants: emptySession(),
    bounty: emptySession(),
    allocation: emptySession(),
  };
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function toDemoEscrowAmount(value: number): bigint {
  // Keep the live test affordable: displayed value 100 => 1.00 token unit.
  return BigInt(Math.max(1, Math.round(value * 100_000)));
}

function formatDemoAmount(value: bigint): string {
  return `${(Number(value) / 10_000_000).toFixed(4)} ${ESCROW_TOKEN_LABEL}`;
}

function freighterError(result: { error?: unknown }) {
  if (!result.error) return null;
  return typeof result.error === "string"
    ? result.error
    : JSON.stringify(result.error);
}

function useWalletContract(address: string | null) {
  return useMemo(() => {
    if (!address || !CONTRACT_ID) return null;
    return new RoundContract({
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK,
      rpcUrl: RPC_URL,
      publicKey: address,
      signTransaction: async (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        const signed = await signTransaction(xdr, {
          networkPassphrase: opts?.networkPassphrase ?? NETWORK,
          address: opts?.address ?? address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        return {
          signedTxXdr: signed.signedTxXdr,
          signerAddress: signed.signerAddress,
        };
      },
      signAuthEntry: async (entryXdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
        const signed = await signAuthEntry(entryXdr, {
          networkPassphrase: opts?.networkPassphrase ?? NETWORK,
          address: opts?.address ?? address,
        });
        const error = freighterError(signed);
        if (error) throw new Error(error);
        if (!signed.signedAuthEntry) throw new Error("Freighter returned no signed auth entry");
        return {
          signedAuthEntry: signed.signedAuthEntry,
          signerAddress: signed.signerAddress,
        };
      },
    });
  }, [address]);
}

function Landing({ enterApp }: { enterApp: () => void }) {
  return (
    <main className="landing-page">
      <section className="landing-hero">
        <div>
          <p className="eyebrow">Main + Privacy / Build on Stellar</p>
          <h1>
            <span>Sealed rounds.</span>
            <span>Real wallets.</span>
            <span>Fair reveals.</span>
          </h1>
          <p className="lede">
            Sub Rosa is a Stellar app for private coordination: voters, judges,
            bidders, and allocators commit now; Drand opens everyone together.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-action" onClick={enterApp}>
              Open app
            </button>
            <a className="secondary-action" href="https://github.com/karagozemin/Sub-Rosa" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>
        <div className="hero-orbit">
          <div className="orbit-ring r1" />
          <div className="orbit-ring r2" />
          <img src={LOGO_SRC} alt="Sub Rosa" />
          <div className="proof-pill p1">Drand R {DEMO_TRACE.meta.revealRound.toLocaleString()}</div>
          <div className="proof-pill p2">{shortAddr(DEMO_TRACE.meta.contractId, 5)}</div>
        </div>
      </section>

      <section className="landing-cases">
        {USE_CASES.map((item) => (
          <article key={item.id}>
            <span>{item.nav}</span>
            <strong>{item.oneLine}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}

function WalletBar({
  address,
  connect,
  status,
}: {
  address: string | null;
  connect: () => void;
  status: string;
}) {
  return (
    <section className="wallet-bar">
      <div>
        <span>Wallet</span>
        <strong>{address ? shortAddr(address, 6) : "Freighter not connected"}</strong>
        <p>{status}</p>
      </div>
      <button type="button" className="primary-action" onClick={connect}>
        {address ? "Reconnect" : "Connect Freighter"}
      </button>
    </section>
  );
}

function PublicVsSealed({ useCase, committed }: { useCase: UseCase; committed: boolean }) {
  return (
    <div className="comparison-grid">
      <article className="comparison-card leaky">
        <span>traditional</span>
        <h3>Visible before close</h3>
        <p>{useCase.traditional}</p>
        <div className="mini-board">
          {useCase.examples.map((entry) => (
            <div key={entry.name}>
              <span>{entry.name}</span>
              <strong>{entry.value}</strong>
            </div>
          ))}
          <div className="you">
            <span>You arrive last</span>
            <strong>can see all</strong>
          </div>
        </div>
      </article>
      <article className="comparison-card sealed">
        <span>Sub Rosa</span>
        <h3>Hidden until Drand R</h3>
        <p>{useCase.subrosa}</p>
        <div className="mini-board">
          {useCase.examples.map((entry) => (
            <div key={entry.name}>
              <span>{entry.name}</span>
              <strong>sealed</strong>
            </div>
          ))}
          <div className="you">
            <span>You</span>
            <strong>{committed ? "sealed on-chain" : "ready to seal"}</strong>
          </div>
        </div>
      </article>
    </div>
  );
}

function LiveState({ live }: { live: LiveRound | null }) {
  if (!live) return null;
  return (
    <section className="live-state">
      <div>
        <span>Status</span>
        <strong>{live.round.status.tag}</strong>
      </div>
      <div>
        <span>Round R</span>
        <strong>{Number(live.round.reveal_round).toLocaleString()}</strong>
      </div>
      <div>
        <span>Bidders</span>
        <strong>{live.bidders.length}</strong>
      </div>
      <div>
        <span>Revealed</span>
        <strong>{Object.values(live.bidStates).filter((s) => s.revealed_value != null).length}</strong>
      </div>
    </section>
  );
}

function AppPage({
  active,
  setActive,
  goHome,
}: {
  active: UseCase;
  setActive: (id: UseCaseId) => void;
  goHome: () => void;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState("Connect a funded Stellar testnet wallet.");
  const [entryValue, setEntryValue] = useState(active.defaultValue);
  const [sessions, setSessions] = useState<Record<UseCaseId, CaseSession>>(initialSessions);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const contract = useWalletContract(address);
  const session = sessions[active.id];
  const { auditorPublicKey, commitValue, live, log, roundId } = session;
  const canUseContract = Boolean(CONTRACT_ID && contract);

  useEffect(() => {
    setEntryValue(active.defaultValue);
  }, [active.id, active.defaultValue]);

  function updateSession(id: UseCaseId, patch: Partial<CaseSession>) {
    setSessions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch,
      },
    }));
  }

  function push(message: string, id = active.id) {
    setSessions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        log: [message, ...prev[id].log].slice(0, 7),
      },
    }));
  }

  async function connect() {
    try {
      const connected = await isConnected();
      if (!connected.isConnected) throw new Error("Freighter extension is not installed or not reachable");
      const access = await requestAccess();
      const error = freighterError(access);
      if (error) throw new Error(error);
      const addr = "address" in access ? access.address : (access as { publicKey?: string }).publicKey;
      if (!addr) {
        const current = await getAddress();
        const currentError = freighterError(current);
        if (currentError) throw new Error(currentError);
        setAddress(current.address);
      } else {
        setAddress(addr);
      }
      const net = await getNetworkDetails();
      setWalletStatus(
        net.networkPassphrase === NETWORK
          ? `Connected on ${net.network}.`
          : `Connected, but switch Freighter to Testnet. Current: ${net.network}.`,
      );
      push("Freighter connected.");
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function refresh(targetRoundId = roundId, id = active.id) {
    if (!contract || targetRoundId == null) return;
    const round = await contract.get_round({ round_id: targetRoundId });
    const bidders = await contract.get_bidders({ round_id: targetRoundId });
    const bidStates: Record<string, BidState> = {};
    for (const bidder of bidders.result.unwrap()) {
      const state = await contract.get_bid_state({ round_id: targetRoundId, bidder });
      bidStates[bidder] = state.result.unwrap();
    }
    updateSession(id, { live: { round: round.result.unwrap(), bidders: bidders.result.unwrap(), bidStates } });
  }

  async function createRound() {
    if (!CONTRACT_ID) {
      push("Missing VITE_CONTRACT_ID. Restart the dev server after setting apps/web/.env.local.");
      return;
    }
    if (!contract || !address) return;
    const id = active.id;
    setStatus("working");
    try {
      const drand = quicknet();
      const revealRound = await roundInSeconds(drand, 45);
      const now = Math.floor(Date.now() / 1000);
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${active.id}:${address}:${Date.now()}`);
      const tx = await contract.create_round({
        operator: address,
        item_ref: Buffer.from(itemRef),
        reveal_round: BigInt(revealRound),
        clearing_rule: { tag: "HighestBid", values: undefined },
        commit_deadline: BigInt(now + 25),
        reveal_deadline: BigInt(now + 150),
        auditor_pubkey: Buffer.from(auditor.publicKey),
      });
      const sent = await tx.signAndSend();
      const nextRoundId = sent.result.unwrap() as bigint;
      updateSession(id, { roundId: nextRoundId, auditorPublicKey: auditor.publicKey });
      setStatus("ok");
      push(`Created ${active.nav} round #${nextRoundId} for Drand R=${revealRound}.`, id);
      await refresh(nextRoundId, id);
    } catch (error) {
      setStatus("error");
      push(error instanceof Error ? error.message : String(error), id);
    }
  }

  async function commitEntry() {
    if (!contract || !address || roundId == null) return;
    const id = active.id;
    setStatus("working");
    try {
      const roundTx = await contract.get_round({ round_id: roundId });
      const round = roundTx.result.unwrap();
      const roundAuditorPublicKey = new Uint8Array(round.auditor_pubkey);
      const value = toDemoEscrowAmount(entryValue);
      const drand = quicknet();
      const sealed = await sealBid({
        value,
        nonce: generateNonce(),
        round: Number(round.reveal_round),
        client: drand,
        identity: new TextEncoder().encode(`${active.nav}:${address}`),
        auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey,
      });
      const tx = await contract.commit({
        round_id: roundId,
        bidder: address,
        commitment: Buffer.from(sealed.commitment),
        ciphertext: Buffer.from(sealed.ciphertext),
        escrow: value,
        auditor_blob: Buffer.from(sealed.auditorBlob),
      });
      await tx.signAndSend();
      updateSession(id, { commitValue: value, auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey });
      setStatus("ok");
      push(`Committed sealed ${active.inputLabel}: ${entryValue} (${formatDemoAmount(value)} escrow).`, id);
      await refresh(roundId, id);
    } catch (error) {
      setStatus("error");
      push(error instanceof Error ? error.message : String(error), id);
    }
  }

  async function openAndReveal() {
    if (!contract || roundId == null) return;
    const id = active.id;
    setStatus("working");
    try {
      const drand = quicknet();
      const roundTx = await contract.get_round({ round_id: roundId });
      let round = roundTx.result.unwrap();
      if (round.status.tag === "Open") {
        const signature = await fetchRoundSignature(drand, Number(round.reveal_round));
        const openTx = await contract.open_reveal({
          round_id: roundId,
          drand_signature: Buffer.from(signature),
        });
        await openTx.signAndSend();
        push(`Opened reveal with Drand R=${Number(round.reveal_round).toLocaleString()}.`, id);
        round = (await contract.get_round({ round_id: roundId })).result.unwrap();
      }
      if (round.status.tag !== "Revealing") throw new Error(`Round is ${round.status.tag}, not Revealing.`);
      const bidders = (await contract.get_bidders({ round_id: roundId })).result.unwrap();
      let revealed = 0;
      for (const bidder of bidders) {
        const state = (await contract.get_bid_state({ round_id: roundId, bidder })).result.unwrap();
        if (state.revealed_value != null) continue;
        const seal = (await contract.get_seal({ round_id: roundId, bidder })).result;
        if (!seal) continue;
        const opened = await openBid(new Uint8Array(seal.ciphertext), drand);
        const revealTx = await contract.reveal({
          round_id: roundId,
          bidder,
          value: opened.value,
          nonce: Buffer.from(opened.nonce),
        });
        await revealTx.signAndSend();
        revealed += 1;
      }
      setStatus("ok");
      push(`Revealed ${revealed} sealed entr${revealed === 1 ? "y" : "ies"} permissionlessly.`, id);
      await refresh(roundId, id);
    } catch (error) {
      setStatus("error");
      push(error instanceof Error ? error.message : String(error), id);
    }
  }

  return (
    <main className="app-page">
      <section className="app-shell">
        <aside className="case-nav">
          <button type="button" className="brand-link" onClick={goHome}>
            <img src={LOGO_SRC} alt="" />
            <span>Sub Rosa</span>
          </button>
          {USE_CASES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={active.id === item.id ? "active" : ""}
              onClick={() => setActive(item.id)}
            >
              {item.nav}
            </button>
          ))}
          <DrandCountdownChip targetRound={live ? Number(live.round.reveal_round) : DEMO_TRACE.meta.revealRound} />
        </aside>

        <section key={active.id} className="case-workspace">
          <WalletBar address={address} connect={connect} status={walletStatus} />
          <div className="case-hero">
            <div>
              <p className="eyebrow">Live use case</p>
              <h1>{active.title}</h1>
              <p className="lede">{active.oneLine}</p>
            </div>
            <div className="round-box">
              <span>active round</span>
              <strong>{roundId == null ? "none" : `#${roundId}`}</strong>
              <small>{CONTRACT_ID ? shortAddr(CONTRACT_ID, 5) : "Set VITE_CONTRACT_ID"}</small>
            </div>
          </div>

          <PublicVsSealed useCase={active} committed={Boolean(commitValue)} />

          <section className="real-actions">
            <div className="action-input">
              <label htmlFor="entry-value">{active.inputLabel}</label>
              <input
                id="entry-value"
                type="number"
                min="1"
                value={entryValue}
                onChange={(event) => setEntryValue(Number(event.target.value || active.defaultValue))}
              />
              <small>Live escrow for this demo: {formatDemoAmount(toDemoEscrowAmount(entryValue))}</small>
            </div>
            <div className="action-buttons">
              <button type="button" className="secondary-action" onClick={createRound} disabled={!address || !canUseContract || status === "working"}>
                1. Create live round
              </button>
              <button type="button" className="primary-action" onClick={commitEntry} disabled={!address || !canUseContract || roundId == null || status === "working"}>
                2. Commit sealed entry
              </button>
              <button type="button" className="secondary-action" onClick={openAndReveal} disabled={!address || !canUseContract || roundId == null || status === "working"}>
                3. Open + reveal after R
              </button>
              <button type="button" className="ghost-action" onClick={() => refresh()} disabled={!address || !canUseContract || roundId == null}>
                Refresh state
              </button>
            </div>
          </section>

          <LiveState live={live} />

          <section className={`tx-log ${status}`}>
            <span>transaction log</span>
            {log.length === 0 ? (
              <p>Connect Freighter, create a round, commit your sealed entry, then wait for Drand R.</p>
            ) : (
              log.map((item) => <p key={item}>{item}</p>)
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const active = USE_CASES.find((item) => item.id === route.useCase) ?? USE_CASES[0];

  function enter(useCase: UseCaseId = route.useCase) {
    window.location.hash = `/app/${useCase}`;
    setRoute({ page: "app", useCase });
  }

  function setActive(id: UseCaseId) {
    window.location.hash = `/app/${id}`;
    setRoute({ page: "app", useCase: id });
  }

  function goHome() {
    window.location.hash = "/landing";
    setRoute({ page: "landing", useCase: route.useCase });
  }

  return route.page === "landing" ? (
    <Landing enterApp={() => enter("dao")} />
  ) : (
    <AppPage active={active} setActive={setActive} goHome={goHome} />
  );
}
