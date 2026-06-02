import { Buffer } from "buffer";
import {
  getAddress,
  signAuthEntry,
  signTransaction,
} from "@stellar/freighter-api";
import { RoundContract } from "@sub-rosa/sdk";
import { useMemo } from "react";

export const LOGO_SRC = "/sub-rosa-logo.png";
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK =
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID;
export const ESCROW_TOKEN_LABEL = import.meta.env.VITE_ESCROW_TOKEN_LABEL ?? "token";
export const DEFAULT_ROUND_ID = import.meta.env.VITE_ROUND_ID
  ? BigInt(import.meta.env.VITE_ROUND_ID)
  : null;

// Commit window length is LIVE_REVEAL_IN_SECONDS - LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS.
// Keep ~10s buffer between commit close and Drand R so reveals never race the beacon.
export const LIVE_REVEAL_IN_SECONDS = 35;
export const LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS = 10;
export const LIVE_COMMIT_WINDOW_SECONDS =
  LIVE_REVEAL_IN_SECONDS - LIVE_COMMIT_CLOSE_BEFORE_REVEAL_SECONDS;
export const LIVE_REVEAL_WINDOW_AFTER_REVEAL_SECONDS = 90;

export function freighterError(result: { error?: unknown }) {
  if (!result.error) return null;
  return typeof result.error === "string"
    ? result.error
    : JSON.stringify(result.error);
}

export function displayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Contract, #10")) {
    return "Commit window closed. Create a fresh round, then commit before Drand reaches reveal.";
  }
  if (message.includes("got 425") || message.includes("Error response fetching")) {
    return "Drand R is not published yet. Wait for the countdown, then open + reveal.";
  }
  if (message.includes("trustline entry is missing")) {
    return "Wallet is missing the escrow asset trustline. Fund the testnet wallet or use the XLM demo contract.";
  }
  return message;
}

export function toDemoEscrowAmount(value: number): bigint {
  return BigInt(Math.max(1, Math.round(value * 100_000)));
}

export function formatDemoAmount(value: bigint): string {
  return `${(Number(value) / 10_000_000).toFixed(4)} ${ESCROW_TOKEN_LABEL}`;
}

export async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function stellarExpertTxLink(hash: string): string {
  const network = NETWORK.includes("Public") ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

export function useWalletContract(address: string | null) {
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

export async function resolveFreighterAddress(
  access: { address?: string; publicKey?: string },
): Promise<string> {
  const addr = access.address ?? access.publicKey;
  if (addr) return addr;
  const current = await getAddress();
  const currentError = freighterError(current);
  if (currentError) throw new Error(currentError);
  return current.address;
}
