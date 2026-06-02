import { Buffer } from "buffer";
import { useEffect, useState } from "react";
import {
  getNetworkDetails,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
import type { BidState, Round } from "@sub-rosa/sdk";
import {
  fetchRoundSignature,
  generateAuditorKeypair,
  generateNonce,
  openBid,
  quicknet,
  roundInSeconds,
  sealBid,
} from "@sub-rosa/tlock";
import type { UseCase } from "../config/useCases";
import type { UseCaseId } from "../config/useCases";
import {
  CONTRACT_ID,
  LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS,
  LIVE_COMMIT_WINDOW_SECONDS,
  LIVE_REVEAL_IN_SECONDS,
  LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS,
  NETWORK,
  displayError,
  formatDemoAmount,
  freighterError,
  resolveFreighterAddress,
  sha256Bytes,
  toDemoEscrowAmount,
  useWalletContract,
} from "../lib/chain";
import { DEMO_TRACE } from "../demo/trace";
import { formatCountdown, useDrandCountdown } from "./useDrandCountdown";
import { useToast } from "../ui/Toast";

export type ActionStatus = "idle" | "working" | "ok" | "error";

export interface LiveRound {
  round: Round;
  bidders: string[];
  bidStates: Record<string, BidState>;
}

export interface CaseSession {
  roundId: bigint | null;
  auditorPublicKey: Uint8Array | null;
  commitValue: bigint | null;
  live: LiveRound | null;
  log: string[];
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

function initialSessions(defaultRoundId: bigint | null): Record<UseCaseId, CaseSession> {
  return {
    dao: emptySession(defaultRoundId),
    grants: emptySession(),
    bounty: emptySession(),
    allocation: emptySession(),
  };
}

export function useRoundSession(active: UseCase, defaultRoundId: bigint | null) {
  const toast = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState("Connect a funded Stellar testnet wallet.");
  const [entryValue, setEntryValue] = useState(active.defaultValue);
  const [sessions, setSessions] = useState<Record<UseCaseId, CaseSession>>(() =>
    initialSessions(defaultRoundId),
  );
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [revealProgress, setRevealProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const contract = useWalletContract(address);
  const session = sessions[active.id];
  const { auditorPublicKey, commitValue, live, log, roundId } = session;
  const canUseContract = Boolean(CONTRACT_ID && contract);
  const targetRound = live ? Number(live.round.reveal_round) : DEMO_TRACE.meta.revealRound;
  const drandGate = useDrandCountdown(targetRound);
  const commitSecondsRemaining = live
    ? Math.max(0, Number(live.round.commit_deadline) - Math.floor(Date.now() / 1000))
    : null;
  const commitClosed = commitSecondsRemaining != null && commitSecondsRemaining <= 0;
  const revealedCount = live
    ? Object.values(live.bidStates).filter((state) => state.revealed_value != null).length
    : 0;

  useEffect(() => {
    setEntryValue(active.defaultValue);
  }, [active.id, active.defaultValue]);

  function updateSession(id: UseCaseId, patch: Partial<CaseSession>) {
    setSessions((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }

  function push(message: string, id = active.id) {
    setSessions((prev) => ({
      ...prev,
      [id]: { ...prev[id], log: [message, ...prev[id].log].slice(0, 8) },
    }));
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
    updateSession(id, {
      live: { round: round.result.unwrap(), bidders: bidders.result.unwrap(), bidStates },
    });
  }

  async function connect() {
    const workingId = toast.push("working", "Connecting Freighter…");
    setStatus("working");
    try {
      const connected = await isConnected();
      if (!connected.isConnected) {
        throw new Error("Freighter extension is not installed or not reachable");
      }
      const access = await requestAccess();
      const error = freighterError(access);
      if (error) throw new Error(error);
      const addr = await resolveFreighterAddress(access);
      setAddress(addr);
      const net = await getNetworkDetails();
      const netMsg =
        net.networkPassphrase === NETWORK
          ? `Connected on ${net.network}.`
          : `Connected — switch Freighter to Testnet (current: ${net.network}).`;
      setWalletStatus(netMsg);
      push("Freighter connected.");
      setStatus("ok");
      toast.dismiss(workingId);
      toast.push("success", "Wallet connected", netMsg);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setWalletStatus(msg);
      setStatus("error");
      toast.dismiss(workingId);
      toast.push("error", "Wallet connection failed", msg);
    }
  }

  async function createRound() {
    if (!CONTRACT_ID) {
      toast.push("error", "Contract not configured", "Set VITE_CONTRACT_ID in apps/web/.env.local");
      return;
    }
    if (!contract || !address) return;
    const id = active.id;
    const workingId = toast.push("working", "Creating sealed round…", "Signing with Freighter");
    setStatus("working");
    try {
      const drand = quicknet();
      const revealRound = await roundInSeconds(drand, LIVE_REVEAL_IN_SECONDS);
      const info = await drand.chain().info();
      const tReveal = Number(info.genesis_time) + Number(info.period) * revealRound;
      const commitDeadline = tReveal - LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
      const revealDeadline = tReveal + LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS;
      const auditor = generateAuditorKeypair();
      const itemRef = await sha256Bytes(`${active.id}:${address}:${Date.now()}`);
      const tx = await contract.create_round({
        operator: address,
        item_ref: Buffer.from(itemRef),
        reveal_round: BigInt(revealRound),
        clearing_rule: { tag: "HighestBid", values: undefined },
        commit_deadline: BigInt(commitDeadline),
        reveal_deadline: BigInt(revealDeadline),
        auditor_pubkey: Buffer.from(auditor.publicKey),
      });
      const sent = await tx.signAndSend();
      const nextRoundId = sent.result.unwrap() as bigint;
      updateSession(id, { roundId: nextRoundId, auditorPublicKey: auditor.publicKey });
      setStatus("ok");
      const msg = `Round #${nextRoundId} · commit in ~${LIVE_COMMIT_WINDOW_SECONDS}s · R=${revealRound}`;
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("success", "Round created on Stellar", msg);
      await refresh(nextRoundId, id);
    } catch (error) {
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Round creation failed", msg);
    }
  }

  async function commitEntry() {
    if (!contract || !address || roundId == null) return;
    const id = active.id;
    const workingId = toast.push("working", "Sealing your entry…", `${active.inputLabel}: ${entryValue}`);
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
      updateSession(id, {
        commitValue: value,
        auditorPublicKey: auditorPublicKey ?? roundAuditorPublicKey,
      });
      setStatus("ok");
      const msg = `${formatDemoAmount(value)} escrow locked · ciphertext on-chain`;
      push(`Committed sealed ${active.inputLabel}: ${entryValue}.`, id);
      toast.dismiss(workingId);
      toast.push("success", "Entry sealed on-chain", msg);
      await refresh(roundId, id);
    } catch (error) {
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Commit failed", msg);
    }
  }

  async function openAndReveal() {
    if (!contract || roundId == null) return;
    const id = active.id;
    if (live && !drandGate.published) {
      toast.push(
        "info",
        "Waiting for Drand R",
        `Reveal opens in ${formatCountdown(drandGate.secondsRemaining)}`,
      );
      return;
    }
    const workingId = toast.push("working", "Opening reveal gate…", "BLS verify + decrypt bids");
    setStatus("working");
    setRevealProgress(null);
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
        toast.push("success", "Drand gate opened", "BLS signature verified on-chain");
        round = (await contract.get_round({ round_id: roundId })).result.unwrap();
      }
      if (round.status.tag !== "Revealing") {
        throw new Error(`Round is ${round.status.tag}, not Revealing.`);
      }
      const bidders = (await contract.get_bidders({ round_id: roundId })).result.unwrap();
      const pending = [];
      for (const bidder of bidders) {
        const state = (await contract.get_bid_state({ round_id: roundId, bidder })).result.unwrap();
        if (state.revealed_value == null) pending.push(bidder);
      }
      let revealed = 0;
      for (let i = 0; i < pending.length; i += 1) {
        const bidder = pending[i];
        setRevealProgress({ current: i + 1, total: pending.length });
        toast.dismiss(workingId);
        const stepId = toast.push(
          "working",
          `Revealing bid ${i + 1} of ${pending.length}`,
          shortAddr(bidder),
        );
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
        toast.dismiss(stepId);
      }
      setRevealProgress(null);
      setStatus("ok");
      const msg = `${revealed} entr${revealed === 1 ? "y" : "ies"} opened permissionlessly`;
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("success", "Reveal complete", msg);
      await refresh(roundId, id);
    } catch (error) {
      setRevealProgress(null);
      const msg = displayError(error);
      setStatus("error");
      push(msg, id);
      toast.dismiss(workingId);
      toast.push("error", "Reveal failed", msg);
    }
  }

  return {
    address,
    walletStatus,
    entryValue,
    setEntryValue,
    session,
    status,
    canUseContract,
    targetRound,
    drandGate,
    commitSecondsRemaining,
    commitClosed,
    revealedCount,
    commitValue,
    roundId,
    live,
    log,
    revealProgress,
    connect,
    createRound,
    commitEntry,
    openAndReveal,
    refresh,
  };
}

function shortAddr(addr: string, len = 6) {
  if (addr.length <= len * 2 + 3) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}
