import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AgentActivity, KeeperPanel, X402Logs } from "../components/AgentPanels";
import { AttackDemo } from "../components/AttackDemo";
import { AuditorView } from "../components/AuditorView";
import { DrandCountdownChip } from "../components/DrandCountdownChip";
import { LifecycleView } from "../components/LifecycleView";
import { MainnetProofCard } from "../components/MainnetProofCard";
import { MandateCapLab } from "../components/MandateCapLab";
import { ObserverView } from "../components/ObserverView";
import { SettlementRail } from "../components/SettlementRail";
import type { UseCase, UseCaseId } from "../config/useCases";
import { USE_CASES } from "../config/useCases";
import { DEMO_TRACE } from "../demo/trace";
import {
  CONTRACT_ID,
  DEFAULT_ROUND_ID,
  LIVE_COMMIT_WINDOW_SECONDS,
  formatDemoAmount,
  toDemoEscrowAmount,
} from "../lib/chain";
import { formatCountdown, useDrandCountdown } from "../hooks/useDrandCountdown";
import { useRoundSession, type ActionStatus } from "../hooks/useRoundSession";
import { shortAddr } from "../lib/format";
import { LOGO_SRC } from "../lib/chain";
import { ConfettiBurst } from "../ui/Confetti";
import { CountUp } from "../ui/CountUp";

type DemoMode = "live" | "evidence";

function FlowSteps({
  address,
  roundId,
  committed,
  revealed,
  working,
}: {
  address: string | null;
  roundId: bigint | null;
  committed: boolean;
  revealed: boolean;
  working: boolean;
}) {
  const steps = [
    { label: "Wallet", detail: address ? shortAddr(address, 6) : "connect", done: Boolean(address) },
    { label: "Round", detail: roundId == null ? "create" : `#${roundId}`, done: roundId != null },
    { label: "Seal", detail: committed ? "on-chain" : "commit", done: committed },
    { label: "Reveal", detail: revealed ? "opened" : "after R", done: revealed },
  ];
  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <section className={`flow-steps ${working ? "working" : ""}`}>
      {steps.map((step, index) => {
        const state = step.done ? "done" : index === activeIndex ? "active" : "idle";
        return (
          <motion.div
            key={step.label}
            className={`flow-step ${state}`}
            layout
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>{step.done ? "" : index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          </motion.div>
        );
      })}
    </section>
  );
}

function PhaseGuide(props: {
  address: string | null;
  canUseContract: boolean;
  roundId: bigint | null;
  committed: boolean;
  revealedCount: number;
  commitSecondsRemaining: number | null;
  commitClosed: boolean;
  drandGate: ReturnType<typeof useDrandCountdown>;
  status: ActionStatus;
  entryValue: number;
  inputLabel: string;
  onEntryChange: (v: number) => void;
  connect: () => void;
  createRound: () => void;
  commitEntry: () => void;
  openAndReveal: () => void;
}) {
  const {
    address,
    canUseContract,
    roundId,
    committed,
    revealedCount,
    commitSecondsRemaining,
    commitClosed,
    drandGate,
    status,
    entryValue,
    inputLabel,
    onEntryChange,
    connect,
    createRound,
    commitEntry,
    openAndReveal,
  } = props;

  const working = status === "working";
  const commitSeconds = commitSecondsRemaining ?? 0;
  const commitPercent =
    commitSecondsRemaining == null
      ? 0
      : Math.max(0, Math.min(100, (commitSeconds / LIVE_COMMIT_WINDOW_SECONDS) * 100));

  let tone = "idle";
  let eyebrow = "Next step";
  let title = "Connect Freighter";
  let detail = "Use a funded Stellar testnet wallet to run a sealed round end-to-end.";
  let timerLabel = "Status";
  let timerValue = "ready";
  let ctaLabel = "Connect wallet";
  let cta = connect;
  let ctaDisabled = working;
  let showInput = false;

  if (address && !canUseContract) {
    tone = "danger";
    eyebrow = "Setup";
    title = "Contract not configured";
    detail = "Set VITE_CONTRACT_ID in apps/web/.env.local and restart the dev server.";
    timerValue = "env";
    ctaLabel = "Missing env";
    ctaDisabled = true;
  } else if (address && roundId == null) {
    tone = "ready";
    eyebrow = "Step 1 · sealed round";
    title = "Create a round";
    detail = `We'll open a ${LIVE_COMMIT_WINDOW_SECONDS}-second commit window, then wait for Drand R to publish.`;
    timerValue = `~${LIVE_COMMIT_WINDOW_SECONDS}s window`;
    ctaLabel = "Create round";
    cta = createRound;
  } else if (roundId != null && !committed && !commitClosed) {
    tone = commitSeconds <= 8 ? "danger" : "urgent";
    eyebrow = "Step 2 · commit";
    title = "Seal your entry";
    detail = "Enter your value and commit before the window closes. The bid is encrypted to Drand R.";
    timerLabel = "Time left";
    timerValue = formatCountdown(commitSeconds);
    ctaLabel = `Seal entry`;
    cta = commitEntry;
    showInput = true;
  } else if (roundId != null && !committed && commitClosed) {
    tone = "danger";
    eyebrow = "Missed";
    title = "Commit window closed";
    detail = `Create a new round and seal within ${LIVE_COMMIT_WINDOW_SECONDS} seconds.`;
    timerValue = "closed";
    ctaLabel = "New round";
    cta = createRound;
  } else if (committed && revealedCount > 0) {
    tone = "complete";
    eyebrow = "Done · revealed";
    title = "Round revealed";
    detail = `${revealedCount} bid(s) opened on-chain. The contract cleared deterministically.`;
    timerValue = String(revealedCount);
    ctaLabel = "Round complete";
    ctaDisabled = true;
  } else if (committed && !drandGate.published) {
    tone = "wait";
    eyebrow = "Sealed · waiting for R";
    title = "Wait for Drand R";
    detail = "Your bid is on-chain and undecryptable. Reveal unlocks the moment R publishes.";
    timerLabel = "Reveal in";
    timerValue = drandGate.loading ? "…" : formatCountdown(drandGate.secondsRemaining);
    ctaLabel = "Waiting for R";
    ctaDisabled = true;
  } else if (committed && drandGate.published) {
    tone = "ready";
    eyebrow = "Step 3 · reveal";
    title = "Open the gate";
    detail = "Drand R is live. Anyone can submit the BLS signature and reveal every bid at once.";
    timerValue = "live";
    ctaLabel = "Open + reveal";
    cta = openAndReveal;
  }

  if (working) {
    ctaDisabled = true;
    ctaLabel = "Signing…";
  }

  return (
    <section
      className={`phase-guide ${tone} ${working ? "working" : ""}`}
      style={{ "--commit-progress": `${commitPercent}%` } as CSSProperties}
      aria-live="polite"
    >
      <div className="phase-copy">
        <span>{eyebrow}</span>
        <AnimatePresence mode="wait">
          <motion.strong
            key={title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {title}
          </motion.strong>
        </AnimatePresence>
        <p>{detail}</p>

        {showInput ? (
          <motion.div
            className="phase-input"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <label htmlFor="entry-value">{inputLabel}</label>
            <div className="value-control">
              <input
                id="entry-range"
                type="range"
                min="1"
                max="150"
                value={entryValue}
                onChange={(e) => onEntryChange(Number(e.target.value || 1))}
              />
              <input
                id="entry-value"
                type="number"
                min="1"
                value={entryValue}
                onChange={(e) => onEntryChange(Number(e.target.value || 1))}
              />
            </div>
            <small>Escrow: {formatDemoAmount(toDemoEscrowAmount(entryValue))}</small>
          </motion.div>
        ) : null}
      </div>

      <div className="phase-aside">
        <div className="phase-meter">
          <small>{timerLabel}</small>
          <AnimatePresence mode="wait">
            <motion.b
              key={timerValue}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {timerValue}
            </motion.b>
          </AnimatePresence>
          <i aria-hidden="true" />
        </div>
        <button
          type="button"
          className="phase-cta primary-action large"
          onClick={cta}
          disabled={ctaDisabled}
        >
          {working ? <span className="spinner" aria-hidden="true" /> : null}
          {ctaLabel}
        </button>
      </div>
    </section>
  );
}

function FeedbackPanel({
  status,
  latest,
  roundId,
  commitValue,
}: {
  status: ActionStatus;
  latest: string | null;
  roundId: bigint | null;
  commitValue: bigint | null;
}) {
  const headline =
    status === "working"
      ? "Sending…"
      : status === "ok"
        ? "Updated"
        : status === "error"
          ? "Check wallet / retry"
          : "Ready";

  const escrowLabel = commitValue == null ? "—" : formatDemoAmount(commitValue);

  return (
    <motion.section
      className={`feedback-panel ${status}`}
      layout
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <span>Status</span>
      <AnimatePresence mode="wait">
        <motion.strong
          key={headline}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {headline}
        </motion.strong>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.p
          key={latest ?? "ready"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {latest ?? "Each transaction shows up here with full context — wallet, round, seal, reveal."}
        </motion.p>
      </AnimatePresence>
      <div className="receipt-grid">
        <div>
          <small>round</small>
          <b>{roundId == null ? "—" : `#${roundId}`}</b>
        </div>
        <div>
          <small>sealed escrow</small>
          <b>{escrowLabel}</b>
        </div>
      </div>
    </motion.section>
  );
}

function LivePanel({ active, onCelebrate }: { active: UseCase; onCelebrate: () => void }) {
  const session = useRoundSession(active, DEFAULT_ROUND_ID);
  const {
    address,
    walletStatus,
    entryValue,
    setEntryValue,
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
  } = session;

  // Celebrate when revealedCount transitions to >0 for the first time
  const lastRevealedRef = useRef(0);
  useEffect(() => {
    if (revealedCount > 0 && lastRevealedRef.current === 0) {
      onCelebrate();
    }
    lastRevealedRef.current = revealedCount;
  }, [revealedCount, onCelebrate]);

  return (
    <>
      <section className="case-hero">
        <div>
          <p className="eyebrow">Live round</p>
          <h1>{active.title}</h1>
          <p className="lede">{active.oneLine}</p>
        </div>
        <div className="round-box">
          <span>round</span>
          <strong>{roundId == null ? "—" : `#${roundId}`}</strong>
          <small>{CONTRACT_ID ? shortAddr(CONTRACT_ID, 6) : "set VITE_CONTRACT_ID"}</small>
        </div>
      </section>

      <section className={`wallet-bar ${address ? "connected" : ""}`}>
        <div>
          <span>Wallet</span>
          <strong>{address ? shortAddr(address, 6) : "Not connected"}</strong>
          <p>{walletStatus}</p>
        </div>
        <button type="button" className="primary-action" onClick={() => void connect()}>
          {address ? "Reconnect" : "Connect Freighter"}
        </button>
      </section>

      <FlowSteps
        address={address}
        roundId={roundId}
        committed={Boolean(commitValue)}
        revealed={revealedCount > 0}
        working={status === "working"}
      />

      <PhaseGuide
        address={address}
        canUseContract={canUseContract}
        roundId={roundId}
        committed={Boolean(commitValue)}
        revealedCount={revealedCount}
        commitSecondsRemaining={commitSecondsRemaining}
        commitClosed={commitClosed}
        drandGate={drandGate}
        status={status}
        entryValue={entryValue}
        inputLabel={active.inputLabel}
        onEntryChange={setEntryValue}
        connect={() => void connect()}
        createRound={() => void createRound()}
        commitEntry={() => void commitEntry()}
        openAndReveal={() => void openAndReveal()}
      />

      {revealProgress ? (
        <motion.p
          className="reveal-hint"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          Revealing {revealProgress.current} / {revealProgress.total}…
        </motion.p>
      ) : null}

      <div className="proof-layout">
        <ComparisonMini useCase={active} committed={Boolean(commitValue)} />
        <FeedbackPanel
          status={status}
          latest={log[0] ?? null}
          roundId={roundId}
          commitValue={commitValue}
        />
      </div>

      <section className="live-state">
        <div>
          <span>Status</span>
          <strong>{live?.round.status.tag ?? "—"}</strong>
        </div>
        <div>
          <span>Round R</span>
          <strong>
            <CountUp value={targetRound} />
          </strong>
        </div>
        <div>
          <span>Revealed</span>
          <strong>
            <CountUp value={revealedCount} />
          </strong>
        </div>
        <div>
          <button
            type="button"
            className="ghost-action"
            onClick={() => void refresh()}
            disabled={!roundId}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className={`tx-log ${status}`}>
        <span>Activity log</span>
        <AnimatePresence initial={false}>
          {log.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Connect → create round → seal → wait for Drand → reveal.
            </motion.p>
          ) : (
            log.map((line, i) => (
              <motion.p
                key={`${line}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {line}
              </motion.p>
            ))
          )}
        </AnimatePresence>
      </section>
    </>
  );
}

function ComparisonMini({ useCase, committed }: { useCase: UseCase; committed: boolean }) {
  return (
    <div className="comparison-grid">
      <article className="comparison-card leaky">
        <span>Without sealing</span>
        <h3>Visible early</h3>
        <p>{useCase.traditional}</p>
      </article>
      <article className="comparison-card sealed">
        <span>Sub Rosa</span>
        <h3>{committed ? "Sealed on-chain" : "Hidden until R"}</h3>
        <p>{useCase.subrosa}</p>
      </article>
    </div>
  );
}

function EvidencePanel() {
  return (
    <div className="evidence-stack">
      <p className="evidence-intro">
        Recorded testnet proof from <code>pnpm agents:e2e</code>. Scroll for lifecycle, attack
        demo, agents, and auditor tools.
      </p>
      <MainnetProofCard />
      <LifecycleView trace={DEMO_TRACE} />
      <AttackDemo />
      <SettlementRail trace={DEMO_TRACE} />
      <AgentActivity trace={DEMO_TRACE} />
      <X402Logs trace={DEMO_TRACE} />
      <KeeperPanel trace={DEMO_TRACE} />
      <ObserverView trace={DEMO_TRACE} live={null} />
      <AuditorView trace={DEMO_TRACE} />
      <MandateCapLab />
    </div>
  );
}

export function DemoPage({
  active,
  setActive,
  goHome,
}: {
  active: UseCase;
  setActive: (id: UseCaseId) => void;
  goHome: () => void;
}) {
  const [mode, setMode] = useState<DemoMode>("live");
  const [confettiTick, setConfettiTick] = useState(0);
  const targetRound = DEMO_TRACE.meta.revealRound;

  return (
    <main className="app-page">
      <ConfettiBurst fire={confettiTick} />
      <section className="app-shell">
        <aside className="case-nav">
          <button type="button" className="brand-link" onClick={goHome}>
            <img src={LOGO_SRC} alt="" />
            <span>Sub Rosa</span>
          </button>

          <div className="mode-switch" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "live"}
              className={mode === "live" ? "active" : ""}
              onClick={() => setMode("live")}
            >
              {mode === "live" ? <motion.span layoutId="mode-pill" className="mode-pill" /> : null}
              Live round
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "evidence"}
              className={mode === "evidence" ? "active" : ""}
              onClick={() => setMode("evidence")}
            >
              {mode === "evidence" ? (
                <motion.span layoutId="mode-pill" className="mode-pill" />
              ) : null}
              Evidence
            </button>
          </div>

          {mode === "live" ? (
            <>
              <div className="case-nav-section-label">Cases</div>
              {USE_CASES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`case-link ${active.id === item.id ? "active" : ""}`}
                  onClick={() => setActive(item.id)}
                >
                  <span aria-hidden="true" />
                  {item.nav}
                </button>
              ))}
            </>
          ) : null}

          <div className="case-nav-footer">
            <DrandCountdownChip targetRound={targetRound} />
          </div>
        </aside>

        <AnimatePresence mode="wait">
          <motion.section
            key={`${mode}-${active.id}`}
            className="case-workspace"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            {mode === "live" ? (
              <LivePanel active={active} onCelebrate={() => setConfettiTick((t) => t + 1)} />
            ) : (
              <EvidencePanel />
            )}
          </motion.section>
        </AnimatePresence>
      </section>
    </main>
  );
}
