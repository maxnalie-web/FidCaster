import { useState, useCallback, useEffect, useRef } from "react";
import { QRCode } from "@farcaster/auth-kit";
import { useWallet } from "@/hooks/useWallet";
import { randomSigner, type LocalSigner } from "@/lib/wallet";
import { fetchProfile, type FarcasterProfile } from "@/lib/farcaster-api";
import {
  Loader2, CheckCircle2, AlertTriangle, ArrowLeft,
  Smartphone, QrCode, ExternalLink, ShieldCheck,
} from "lucide-react";

const POLL_MS = 2000;

type Phase =
  | "idle"
  | "creating"        // generating key + signing + calling Warpcast
  | "awaiting"        // showing QR, polling Warpcast until the user approves
  | "finishing"       // approved · fetching profile + logging in
  | "done"
  | { error: string };

export function FarcasterSignIn({ onBack, onDone }: { onBack: () => void; onDone?: () => void }) {
  const { loginWithFarcaster } = useWallet();
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const [phase, setPhase] = useState<Phase>("idle");
  const [deeplinkUrl, setDeeplinkUrl] = useState<string | null>(null);
  const [profile, setProfile] = useState<FarcasterProfile | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signerRef = useRef<LocalSigner | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const start = useCallback(async () => {
    stopPoll();
    setDeeplinkUrl(null);
    setProfile(null);
    setPhase("creating");

    // Generate a fresh Ed25519 posting key in the browser. The private key never
    // leaves the device · only the public key is sent to Warpcast for registration.
    const localSigner = randomSigner();
    signerRef.current = localSigner;

    try {
      // The app's own custody account signs the key request server-side
      // (see /api/farcaster/signer-request in server/index.ts) - it must
      // never be done in the browser, since that would mean shipping
      // FidCaster's own account mnemonic in the client bundle.
      const res = await fetch("/api/farcaster/signer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: localSigner.publicKeyHex }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.error ?? `Sign-in request failed (${res.status})`));
      }

      const skr = await res.json() as { token?: string; deeplinkUrl?: string };
      if (!skr.token || !skr.deeplinkUrl) throw new Error("Farcaster returned no deeplink · try again.");

      const token = skr.token;
      setDeeplinkUrl(skr.deeplinkUrl);
      setPhase("awaiting");

      // Poll our own server (which polls Farcaster) until the user approves
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/farcaster/signer-request?token=${encodeURIComponent(token)}`);
          if (!r.ok) return;
          const status = await r.json() as { state?: string; userFid?: number | null };
          if (status.state === "completed" && status.userFid) {
            stopPoll();
            setPhase("finishing");
            let prof: FarcasterProfile | null = null;
            try { prof = await fetchProfile(BigInt(status.userFid)); } catch { /* fall back to minimal */ }
            setProfile(prof);
            await loginWithFarcaster(status.userFid, prof, signerRef.current);
            setPhase("done");
            onDone?.();
          }
        } catch { /* keep polling */ }
      }, POLL_MS);
    } catch (e) {
      setPhase({ error: e instanceof Error ? e.message : "Failed to start sign-in." });
    }
  }, [loginWithFarcaster, stopPoll]);

  function cancel() {
    stopPoll();
    setDeeplinkUrl(null);
    setProfile(null);
    signerRef.current = null;
    setPhase("idle");
  }

  const showError = typeof phase === "object" && "error" in phase;
  const errorMsg = showError ? (phase as { error: string }).error : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}
        >
          <img src="/fidcaster-logo-v2.png" alt="" className="w-6 h-6 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
        <div>
          <h2 className="text-foreground font-bold text-base">Sign In With Farcaster</h2>
          <p className="text-xs text-muted-foreground">Full read &amp; write access · no seed phrase needed</p>
        </div>
      </div>

      {/* IDLE */}
      {phase === "idle" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-violet-500/20 bg-violet-500/5 text-xs text-muted-foreground leading-relaxed">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-violet-400" />
            <span>
              Scan one QR code with Farcaster and approve · that single approval signs you in
              and grants posting access (cast, like, follow). No seed phrase required.
            </span>
          </div>
          <button onClick={start} className="lp-cta-btn w-full">
            <span className="flex items-center justify-center gap-2">
              <QrCode className="w-4 h-4" />Sign In With Farcaster
            </span>
          </button>
        </div>
      )}

      {/* CREATING */}
      {phase === "creating" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
          <p className="text-muted-foreground text-sm">Preparing sign-in…</p>
        </div>
      )}

      {/* AWAITING · scan + approve in Warpcast */}
      {phase === "awaiting" && deeplinkUrl && (
        <div className="space-y-4">
          <p className="text-xs text-center px-2 text-muted-foreground">
            Scan with <strong className="text-foreground">Farcaster</strong> · then approve
            <span className="text-foreground"> Cast as you</span> &amp;
            <span className="text-foreground"> Read</span> to finish.
          </p>

          {!isMobile && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-2xl bg-muted/40 border border-border">
                <QRCode uri={deeplinkUrl} size={196} />
              </div>
            </div>
          )}

          <a href={deeplinkUrl} target="_blank" rel="noopener noreferrer"
            className="lp-cta-btn w-full block text-center" style={{ textDecoration: "none" }}>
            <span className="flex items-center justify-center gap-2">
              <Smartphone className="w-4 h-4" />
              {isMobile ? "Open in Farcaster to approve" : "Open link on mobile"}
              <ExternalLink className="w-3.5 h-3.5" />
            </span>
          </a>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
            Waiting for approval in Farcaster…
          </div>
          <button
            onClick={cancel}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* FINISHING */}
      {phase === "finishing" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
          <p className="text-sm text-muted-foreground">Approved! Signing you in…</p>
        </div>
      )}

      {/* DONE */}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-xl text-sm text-emerald-600 dark:text-emerald-300 leading-relaxed border border-emerald-500/25 bg-emerald-500/10">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            Signed in with full read &amp; write access!
          </div>
          {profile?.username && (
            <p className="text-xs text-center text-muted-foreground">
              Welcome, <strong className="text-foreground">@{profile.username}</strong>
            </p>
          )}
        </div>
      )}

      {/* ERROR */}
      {showError && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-xl text-sm text-red-600 dark:text-red-300 leading-relaxed border border-red-500/25 bg-red-500/10">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            {errorMsg}
          </div>
          <button onClick={start} className="lp-cta-btn w-full">Try Again</button>
        </div>
      )}
    </div>
  );
}
