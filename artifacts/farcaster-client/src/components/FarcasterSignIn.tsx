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
  | "creating"        // generating key + asking Warpcast for a deeplink
  | "awaiting"        // showing QR, polling until the user approves in Warpcast
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
    // leaves the device · only the public key is sent to be registered.
    const localSigner = randomSigner();
    signerRef.current = localSigner;

    try {
      const res = await fetch("/api/farcaster/signer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: localSigner.publicKeyHex }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Request failed (${res.status})`);
      }
      const data = await res.json() as { token: string; deeplinkUrl: string };
      setDeeplinkUrl(data.deeplinkUrl);
      setPhase("awaiting");

      // Poll Warpcast until the user approves. On completion we get their FID.
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/farcaster/signer-request?token=${encodeURIComponent(data.token)}`);
          if (!r.ok) return;
          const d = await r.json() as { state: string; userFid: number | null };
          if (d.state === "completed" && d.userFid) {
            stopPoll();
            setPhase("finishing");
            let prof: FarcasterProfile | null = null;
            try { prof = await fetchProfile(BigInt(d.userFid)); } catch { /* fall back to minimal */ }
            setProfile(prof);
            await loginWithFarcaster(d.userFid, prof, signerRef.current);
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
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors p-1">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}
        >
          <img src="/fidcaster-logo.png" alt="" className="w-6 h-6 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
        <div>
          <h2 className="text-foreground font-bold text-base">Sign In With Farcaster</h2>
          <p className="text-muted-foreground text-xs">Full read &amp; write access · no seed phrase needed</p>
        </div>
      </div>

      {/* IDLE */}
      {phase === "idle" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 rounded-xl text-xs text-muted-foreground leading-relaxed bg-accent/10 border border-accent/20">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
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
          <p className="text-white/40 text-sm">Preparing sign-in…</p>
        </div>
      )}

      {/* AWAITING · single step: scan + approve in Warpcast */}
      {phase === "awaiting" && deeplinkUrl && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground text-center px-2">
            Scan with <strong className="text-foreground">Farcaster</strong> · then approve
            <span className="text-foreground"> Cast as you</span> &amp;
            <span className="text-foreground"> Read</span> to finish.
          </p>

          {!isMobile && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-2xl bg-muted/80 border border-border">
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

          <div className="flex items-center justify-center gap-2 text-muted-foreground/70 text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            Waiting for approval in Farcaster…
          </div>
          <button onClick={cancel} className="w-full text-muted-foreground hover:text-foreground text-xs transition-colors">Cancel</button>
        </div>
      )}

      {/* FINISHING */}
      {phase === "finishing" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
          <p className="text-muted-foreground text-sm">Approved! Signing you in…</p>
        </div>
      )}

      {/* DONE */}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-xl text-sm text-destructive-foreground bg-destructive/10 border border-destructive/20">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-destructive" />
            Signed in with full read &amp; write access!
          </div>
          {profile?.username && (
            <p className="text-xs text-muted-foreground text-center">
              Welcome, <strong className="text-foreground">@{profile.username}</strong>
            </p>
          )}
        </div>
      )}

      {/* ERROR */}
      {showError && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-xl text-sm text-destructive-foreground leading-relaxed bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
            {errorMsg}
          </div>
          <button onClick={start} className="lp-cta-btn w-full">Try Again</button>
        </div>
      )}
    </div>
  );
}
