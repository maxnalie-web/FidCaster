import { useState, useCallback, useEffect, useRef } from "react";
import { QRCode } from "@farcaster/auth-kit";
import { useWallet } from "@/hooks/useWallet";
import { randomSigner, type LocalSigner } from "@/lib/wallet";
import { fetchProfile, type FarcasterProfile } from "@/lib/farcaster-api";
import { mnemonicToAccount } from "viem/accounts";
import {
  Loader2, CheckCircle2, AlertTriangle, ArrowLeft,
  Smartphone, QrCode, ExternalLink, ShieldCheck,
} from "lucide-react";

// ── Warpcast signed-key-request constants (mirrors server/index.ts) ───────────
const WARPCAST_API = "https://api.warpcast.com";
const SIGNED_KEY_REQUEST_VALIDATOR = "0x00000000fc700472606ed4fa22623acf62c60553" as `0x${string}`;
const SIGNED_KEY_REQUEST_DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR,
} as const;
const SIGNED_KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// App credentials baked in at build time via vite.config.ts define block
const APP_FID_RAW = import.meta.env.VITE_APP_FID ?? "";
const APP_MNEMONIC = import.meta.env.VITE_APP_MNEMONIC ?? "";

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
    // leaves the device — only the public key is sent to Warpcast for registration.
    const localSigner = randomSigner();
    signerRef.current = localSigner;

    try {
      const appFid = Number(APP_FID_RAW);
      if (!appFid || !APP_MNEMONIC) {
        throw new Error("SIWF is not configured: VITE_APP_FID / VITE_APP_MNEMONIC missing from build.");
      }

      // Derive the app's custody account and sign the key request locally
      const account = mnemonicToAccount(APP_MNEMONIC.trim());
      const deadline = Math.floor(Date.now() / 1000) + 86_400; // 24 h

      const signature = await account.signTypedData({
        domain: SIGNED_KEY_REQUEST_DOMAIN,
        types: SIGNED_KEY_REQUEST_TYPES,
        primaryType: "SignedKeyRequest",
        message: {
          requestFid: BigInt(appFid),
          key: localSigner.publicKeyHex as `0x${string}`,
          deadline: BigInt(deadline),
        },
      });

      // POST the signed key request directly to Warpcast — no server hop needed
      const res = await fetch(`${WARPCAST_API}/v2/signed-key-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: localSigner.publicKeyHex,
          requestFid: appFid,
          signature,
          deadline,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.message ?? body.error ?? `Warpcast request failed (${res.status})`));
      }

      const data = await res.json() as { result?: { signedKeyRequest?: { token?: string; deeplinkUrl?: string } } };
      const skr = data.result?.signedKeyRequest;
      if (!skr?.token || !skr.deeplinkUrl) throw new Error("Warpcast returned no deeplink — try again.");

      const token = skr.token;
      setDeeplinkUrl(skr.deeplinkUrl);
      setPhase("awaiting");

      // Poll Warpcast directly until the user approves in their Farcaster app
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${WARPCAST_API}/v2/signed-key-request?token=${encodeURIComponent(token)}`);
          if (!r.ok) return;
          const d = await r.json() as { result?: { signedKeyRequest?: { state?: string; userFid?: number } } };
          const status = d.result?.signedKeyRequest;
          if (status?.state === "completed" && status.userFid) {
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
        <button onClick={onBack} className="transition-colors p-1" style={{ color: "rgba(255,255,255,0.4)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
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
          <h2 className="text-white font-bold text-base">Sign In With Farcaster</h2>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>Full read &amp; write access · no seed phrase needed</p>
        </div>
      </div>

      {/* IDLE */}
      {phase === "idle" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 rounded-xl text-xs leading-relaxed"
            style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.18)", color: "rgba(255,255,255,0.55)" }}>
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
          <p className="text-white/40 text-sm">Preparing sign-in…</p>
        </div>
      )}

      {/* AWAITING · scan + approve in Warpcast */}
      {phase === "awaiting" && deeplinkUrl && (
        <div className="space-y-4">
          <p className="text-xs text-center px-2" style={{ color: "rgba(255,255,255,0.5)" }}>
            Scan with <strong className="text-white">Farcaster</strong> · then approve
            <span className="text-white"> Cast as you</span> &amp;
            <span className="text-white"> Read</span> to finish.
          </p>

          {!isMobile && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
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

          <div className="flex items-center justify-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
            Waiting for approval in Farcaster…
          </div>
          <button onClick={cancel} className="w-full text-xs transition-colors"
            style={{ color: "rgba(255,255,255,0.35)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}>Cancel</button>
        </div>
      )}

      {/* FINISHING */}
      {phase === "finishing" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Approved! Signing you in…</p>
        </div>
      )}

      {/* DONE */}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-xl text-sm text-emerald-300 leading-relaxed"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            Signed in with full read &amp; write access!
          </div>
          {profile?.username && (
            <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.45)" }}>
              Welcome, <strong className="text-white">@{profile.username}</strong>
            </p>
          )}
        </div>
      )}

      {/* ERROR */}
      {showError && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-xl text-sm text-red-300 leading-relaxed"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            {errorMsg}
          </div>
          <button onClick={start} className="lp-cta-btn w-full">Try Again</button>
        </div>
      )}
    </div>
  );
}
