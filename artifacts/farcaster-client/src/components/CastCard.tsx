import { useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Heart, Repeat2, MessageCircle, User, ExternalLink, Loader2, X, ChevronLeft, ChevronRight, Trash2, MoreHorizontal, Check, Copy, Quote, Globe, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { useLocation } from "wouter";
import { hubReact, hubDeleteCast, neynarAction } from "@/lib/hub-submit";
import { useIsPro, ProBadge } from "@/components/ProBadge";
import { hasPowerBadge, getCastReactions, type NeynarCast, type NeynarUser, type NeynarEmbed } from "@/lib/neynar";
import { PowerBadgeIcon } from "@/components/PowerBadgeIcon";
import { CastComposer } from "@/components/CastComposer";
import { translateText, getPreferredLang } from "@/lib/translate";
import { ShareButton } from "@/components/ShareButton";
import { setRecentProfile } from "@/lib/recent-profile-cache";
import { toast } from "sonner";
import { hapticTap } from "@/lib/haptics";

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  return `${time} · ${date}`;
}

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i;
const IMAGE_DOMAINS = [
  "imagedelivery.net", "media.warpcast.com", "i.imgur.com", "imgur.com",
  "i.redd.it", "cdn.discordapp.com", "pbs.twimg.com", "0x0.st", "files.catbox.moe",
];

/** Brand "F" mark used in place of the heart on casts that mention Fidcaster ·
 * outline-only unliked, filled (via currentColor, toggled purple by the
 * parent button's className) once liked — same on/off pattern as the heart. */
function FMark({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M6 4 H18 V8 H10 V11 H16 V15 H10 V20 H6 Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

function isVideoEmbed(e: NeynarEmbed): boolean {
  const url = e.url ?? "";
  if (!url) return false;
  if (VIDEO_EXT_RE.test(url)) return true;
  const ct = e.metadata?.content_type ?? "";
  return ct.startsWith("video/");
}

function isImageEmbed(e: NeynarEmbed): boolean {
  const url = e.url ?? "";
  if (!url) return false;
  if (isVideoEmbed(e)) return false;
  if (IMAGE_EXT_RE.test(url)) return true;
  const ct = e.metadata?.content_type ?? "";
  if (ct.startsWith("image/")) return true;
  if (IMAGE_DOMAINS.some((d) => url.includes(d))) {
    if (!url.match(/\.(html?|php|aspx?)(\?|$)/i)) return true;
  }
  return false;
}

function formatCount(n: number): string {
  if (n === 0) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCountFull(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Matches @mentions and http(s) URLs so we can linkify cast bodies.
const MENTION_URL_RE = /(\bhttps?:\/\/[^\s<]+|@[a-zA-Z0-9_][a-zA-Z0-9_.-]*)/g;

/** Renders cast text with clickable @mentions (→ profile) and URLs.
 *  `onOpen` (if given) fires when the body text itself is clicked · used to open
 *  the cast's thread. Mention/URL clicks stop propagation so they don't trigger it. */
function CastBody({
  cast,
  navigate,
  className,
  onOpen,
}: {
  cast: NeynarCast;
  navigate: (p: string) => void;
  className?: string;
  onOpen?: () => void;
}) {
  const text = cast.text ?? "";
  const fidByName = new Map<string, number>();
  for (const u of cast.mentioned_profiles ?? []) {
    if (u.username) fidByName.set(u.username.toLowerCase(), u.fid);
  }

  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  MENTION_URL_RE.lastIndex = 0;
  while ((m = MENTION_URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("@")) {
      const name = tok.slice(1).replace(/[.]+$/, "");
      const fid = fidByName.get(name.toLowerCase());
      parts.push(
        <button
          key={`m${i}`}
          onClick={(e) => { e.stopPropagation(); if (fid) navigate(`/profile/${fid}`); }}
          className="text-primary hover:underline font-medium"
        >
          @{name}
        </button>
      );
    } else {
      parts.push(
        <a
          key={`u${i}`}
          href={tok}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary hover:underline break-all"
        >
          {tok.replace(/^https?:\/\//, "").slice(0, 40)}{tok.length > 47 ? "…" : ""}
        </a>
      );
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <p
      className={cn(className, onOpen && "cursor-pointer")}
      onClick={onOpen ? (e) => {
        // Ignore clicks that landed on a mention/link inside the text.
        if ((e.target as HTMLElement).closest("a,button")) return;
        onOpen();
      } : undefined}
    >
      {parts}
    </p>
  );
}

function QuoteCastPreview({ quotedCast, onClick }: { quotedCast: NeynarCast; onClick: () => void }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="cursor-pointer rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-4 h-4 rounded-full overflow-hidden bg-muted shrink-0">
          {quotedCast.author?.pfp_url
            ? <img src={quotedCast.author.pfp_url} alt="" className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <User className="w-2.5 h-2.5 text-muted-foreground" />
          }
        </div>
        <span className="text-[11px] font-semibold text-foreground truncate">{quotedCast.author?.username ? `@${quotedCast.author.username}` : quotedCast.author?.display_name || "Unknown"}</span>
        {quotedCast.author?.username && quotedCast.author?.display_name && (
          <span className="text-[11px] text-muted-foreground truncate shrink-0">{quotedCast.author.display_name}</span>
        )}
      </div>
      {quotedCast.text ? (
        <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">{quotedCast.text}</p>
      ) : (
        (() => {
          const firstUrl = quotedCast.embeds?.find(e => e.url)?.url;
          return firstUrl ? <p className="text-[11px] text-primary/70 truncate">{firstUrl}</p> : null;
        })()
      )}
    </div>
  );
}

type Props = {
  cast: NeynarCast;
  viewerFid: number;
  onViewProfile?: (user: NeynarUser) => void;
  compact?: boolean;
  expanded?: boolean;
};

export function CastCard({ cast, viewerFid, onViewProfile, compact, expanded }: Props) {
  const { fid, localSigner, signerUuid, signerApproved, autoSignerLoading, signerError, neynarKey } = useWallet();
  const [, navigate] = useLocation();
  const [liked, setLiked] = useState(cast.viewer_context?.liked ?? false);
  const [recasted, setRecasted] = useState(cast.viewer_context?.recasted ?? false);
  const [showRecastMenu, setShowRecastMenu] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const recastMenuRef = useRef<HTMLDivElement>(null);
  const [likeCount, setLikeCount] = useState(cast.reactions.likes_count);
  const [recastCount, setRecastCount] = useState(cast.reactions.recasts_count);
  const [likeLoading, setLikeLoading] = useState(false);
  const [recastLoading, setRecastLoading] = useState(false);
  const likeReqIdRef = useRef(0);
  const recastReqIdRef = useRef(0);
  const [likeError, setLikeError] = useState(false);
  const [recastError, setRecastError] = useState(false);
  const [deleted, setDeleted] = useState(() => {
    try {
      const raw = localStorage.getItem("fc_deleted_casts");
      const list: { hash: string; ts: number }[] = raw ? JSON.parse(raw) : [];
      return list.some((e) => e.hash === cast.hash);
    } catch { return false; }
  });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Tracks where a touch/click gesture started (position + page scrollY) so
  // openThread() can tell a real tap apart from a scroll/drag that merely
  // ends over this card. A plain onClick alone isn't reliable here — some
  // WebViews (seen on the native Android build) fire a click even when the
  // touch moved a fair distance as part of a scroll, especially on a
  // "touch to stop momentum scrolling" gesture · which made every reply in a
  // scrolling list feel like a hair-trigger into its own thread.
  const gestureStartRef = useRef<{ x: number; y: number; scrollY: number } | null>(null);
  // In-place translation: when set, the cast body is REPLACED by the translated
  // text (device-locale language); tapping the header globe again restores it.
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  async function handleTranslate(e: React.MouseEvent) {
    e.stopPropagation();
    if (translation) { setTranslation(null); return; } // toggle back to original
    if (!cast.text || translating) return;
    setTranslating(true);
    try {
      setTranslation(await translateText(cast.text, getPreferredLang()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  }
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number } | null>(null);
  const [reactionsModal, setReactionsModal] = useState<{ type: "likes" | "recasts"; users: NeynarUser[]; loading: boolean } | null>(null);

  const canWrite = signerApproved && (Boolean(localSigner) || Boolean(signerUuid)) && Boolean(fid);
  const isOwnCast = viewerFid > 0 && cast.author.fid === viewerFid;
  const authorIsPro = useIsPro(cast.author.fid);

  useEffect(() => {
    if (!showMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showMenu]);

  useEffect(() => {
    if (!showRecastMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (recastMenuRef.current && !recastMenuRef.current.contains(e.target as Node)) setShowRecastMenu(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showRecastMenu]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") setLightbox((lb) => lb && lb.idx < lb.urls.length - 1 ? { ...lb, idx: lb.idx + 1 } : lb);
      if (e.key === "ArrowLeft") setLightbox((lb) => lb && lb.idx > 0 ? { ...lb, idx: lb.idx - 1 } : lb);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  function signerTooltip(): string {
    if (autoSignerLoading) return "Registering your signer on-chain…";
    if (signerError) return "Signer setup failed · open Wallet to retry";
    if (!signerApproved) return "Open Wallet to set up your signer";
    return "";
  }

  async function openReactions(type: "likes" | "recasts", e: React.MouseEvent) {
    e.stopPropagation();
    setReactionsModal({ type, users: [], loading: true });
    try {
      const data = await getCastReactions(cast.hash, type, neynarKey);
      setReactionsModal({ type, users: data.reactions.map((r) => r.user), loading: false });
    } catch {
      setReactionsModal((prev) => prev ? { ...prev, loading: false } : null);
    }
  }

  function goToProfile(user: NeynarUser) {
    // Seed the recent-profile cache so ProfilePage can render this user
    // instantly (avatar/name/bio/counts) instead of starting blank, since we
    // already have the full profile object right here.
    setRecentProfile(user);
    if (onViewProfile) onViewProfile(user);
    else navigate(`/profile/${user.fid}`);
  }

  function trackGestureStart(e: React.PointerEvent) {
    gestureStartRef.current = { x: e.clientX, y: e.clientY, scrollY: window.scrollY };
  }

  function openThread(e: React.MouseEvent) {
    if (expanded) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) return;
    // Ignore this "click" if the gesture that produced it actually moved —
    // either the finger travelled a real distance, or the page scrolled
    // between touch-down and touch-up (e.g. a "touch to stop scrolling" tap).
    // Without this, scrolling through a reply list on the native app felt
    // hair-trigger: any touch that grazed a card while the list was moving
    // opened that reply's own thread.
    const start = gestureStartRef.current;
    gestureStartRef.current = null;
    if (start) {
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      const scrollDelta = Math.abs(window.scrollY - start.scrollY);
      if (dx > 8 || dy > 8 || scrollDelta > 4) return;
    }
    // Always open THIS cast's own thread · so clicking a comment opens the
    // comment itself (its replies + mentions), not the parent it replied to.
    navigate(`/cast/${cast.hash}`);
  }

  function copyHash() {
    navigator.clipboard.writeText(cast.hash).then(() => toast.success("Cast hash copied"));
    setShowMenu(false);
  }

  /** Downloads the lightbox image. Falls back to opening it in a new tab (so the
   *  user can long-press/right-click "Save image") if the host doesn't send
   *  CORS headers permitting fetch() to read the bytes. */
  async function saveImage(url: string) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = url.split("/").pop()?.split("?")[0] || "image.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("Image saved");
    } catch {
      window.open(url, "_blank", "noreferrer");
    }
  }

  function openExternal() {
    const url = `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`;
    window.open(url, "_blank", "noreferrer");
    setShowMenu(false);
  }

  async function handleLike() {
    if (!fid) return;
    if (!canWrite) {
      toast.error(autoSignerLoading ? "Signer is still being set up…" : "Signer not registered · go to Profile → Settings → Signer.");
      return;
    }
    const wasLiked = liked;
    const reqId = ++likeReqIdRef.current;
    hapticTap();
    setLiked(!wasLiked); setLikeCount((c) => c + (wasLiked ? -1 : 1));
    setLikeLoading(true); setLikeError(false);
    try {
      if (localSigner) {
        await hubReact(Number(fid), localSigner, cast.hash, cast.author.fid, "like", { remove: wasLiked, neynarKey });
      } else if (signerUuid) {
        await neynarAction(signerUuid, { type: wasLiked ? "unlike" : "like", castHash: cast.hash });
      }
    } catch (e) {
      if (likeReqIdRef.current !== reqId) return;
      setLiked(wasLiked); setLikeCount((c) => c + (wasLiked ? 1 : -1)); setLikeError(true);
      const msg = e instanceof Error ? e.message : "Like failed";
      toast.error(msg.includes("SIGNER_NOT_REGISTERED") ? "Signer not registered · go to Profile → Settings → Signer." : msg.slice(0, 120));
      setTimeout(() => setLikeError(false), 2000);
    } finally { if (likeReqIdRef.current === reqId) setLikeLoading(false); }
  }

  async function handleRecast() {
    if (!fid) return;
    if (!canWrite) {
      toast.error(autoSignerLoading ? "Signer is still being set up…" : "Signer not registered · go to Profile → Settings → Signer.");
      return;
    }
    const wasRecasted = recasted;
    const reqId = ++recastReqIdRef.current;
    hapticTap();
    setRecasted(!wasRecasted); setRecastCount((c) => c + (wasRecasted ? -1 : 1));
    setRecastLoading(true); setRecastError(false);
    try {
      if (localSigner) {
        await hubReact(Number(fid), localSigner, cast.hash, cast.author.fid, "recast", { remove: wasRecasted, neynarKey });
      } else if (signerUuid) {
        await neynarAction(signerUuid, { type: wasRecasted ? "unrecast" : "recast", castHash: cast.hash });
      }
    } catch (e) {
      if (recastReqIdRef.current !== reqId) return;
      setRecasted(wasRecasted); setRecastCount((c) => c + (wasRecasted ? 1 : -1)); setRecastError(true);
      const msg = e instanceof Error ? e.message : "Recast failed";
      toast.error(msg.includes("SIGNER_NOT_REGISTERED") ? "Signer not registered." : msg.slice(0, 120));
      setTimeout(() => setRecastError(false), 2000);
    } finally { if (recastReqIdRef.current === reqId) setRecastLoading(false); }
  }

  async function handleDelete() {
    if (!fid || deleteLoading) return;
    if (!signerApproved || (!localSigner && !signerUuid)) {
      toast.error("Signer not active · wait for signer approval or reconnect with your recovery phrase.");
      return;
    }
    setShowMenu(false); setDeleteLoading(true);
    try {
      if (localSigner) {
        await hubDeleteCast(Number(fid), localSigner, cast.hash);
      } else if (signerUuid) {
        await neynarAction(signerUuid, { type: "delete-cast", castHash: cast.hash });
      }
      setDeleted(true);
      try {
        const raw = localStorage.getItem("fc_deleted_casts");
        const list: { hash: string; ts: number }[] = raw ? JSON.parse(raw) : [];
        const pruned = list.filter((e) => Date.now() - e.ts < 86_400_000);
        pruned.push({ hash: cast.hash, ts: Date.now() });
        localStorage.setItem("fc_deleted_casts", JSON.stringify(pruned));
      } catch { /* storage full or private mode */ }
      toast.success("Cast removed");
    } catch (e) {
      toast.error((e instanceof Error ? e.message : "Delete failed").slice(0, 120));
    } finally { setDeleteLoading(false); }
  }

  if (deleted) return null;

  const imageEmbeds = cast.embeds.filter(isImageEmbed);
  const imageUrls = imageEmbeds.flatMap((e) => (e.url ? [e.url] : []));
  const videoEmbeds = cast.embeds.filter(isVideoEmbed);
  const linkEmbeds = cast.embeds.filter((e) => e.url && !isImageEmbed(e) && !isVideoEmbed(e) && !e.url.endsWith(".m3u8"));
  const castEmbeds = cast.embeds.filter((e) => !!e.cast);
  const noWriteTitle = !canWrite ? signerTooltip() : undefined;
  const mentionsFidcaster = /fidcaster/i.test(cast.text ?? "");

  const replyCount = cast.replies.count;
  const viewCount = (cast as NeynarCast & { reactions?: { views_count?: number } }).reactions?.views_count;

  if (expanded) {
    return (
      <>
        <div className="px-4 pt-4 pb-0">
          {/* Author row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); goToProfile(cast.author); }}>
                <div className="w-11 h-11 rounded-full overflow-hidden bg-muted flex items-center justify-center hover:opacity-90 transition-opacity">
                  {cast.author.pfp_url ? (
                    <img src={cast.author.pfp_url} alt={cast.author.display_name} className="w-full h-full object-cover" loading="eager"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <User className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </button>
              <button onClick={(e) => { e.stopPropagation(); goToProfile(cast.author); }} className="text-left hover:opacity-80 transition-opacity">
                <p className="font-bold text-[0.9375rem] text-foreground leading-tight flex items-center gap-1">
                  <span className="truncate">@{cast.author.username}</span>
                  {authorIsPro && <ProBadge size={15} />}
                </p>
                <div className="flex items-center gap-1 flex-wrap">
                  <p className="text-[0.8125rem] text-muted-foreground truncate">{cast.author.display_name || cast.author.username}</p>
                  {hasPowerBadge(cast.author) && (
                    <span title="Purple badge" className="shrink-0 inline-flex">
                      <PowerBadgeIcon size={15} />
                    </span>
                  )}
                  {cast.channel && (
                    <>
                      <span className="text-muted-foreground/60 text-[0.8125rem]">in</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); navigate(`/channel/${cast.channel!.id}`); }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/60 hover:bg-muted transition-colors"
                      >
                        <span className="w-3.5 h-3.5 rounded-full overflow-hidden bg-primary/10 shrink-0">
                          {cast.channel.image_url && <img src={cast.channel.image_url} alt="" className="w-full h-full object-cover" />}
                        </span>
                        <span className="text-[0.8125rem] font-medium text-foreground/80">{cast.channel.name}</span>
                      </span>
                    </>
                  )}
                </div>
              </button>
            </div>
            {/* Translate + more menu · grouped together so the parent row's
                justify-between treats them as ONE item on the right, not two
                separate items with the gap split evenly across the whole row. */}
            <div className="flex items-center gap-0.5 shrink-0">
            {cast.text && (
              <button
                onClick={handleTranslate}
                title={translation ? "Show original" : "Translate"}
                className={cn(
                  "p-2 rounded-full transition-colors shrink-0",
                  translation ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {translating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" strokeWidth={1.75} />}
              </button>
            )}
            <div className="relative shrink-0" ref={menuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
                className="p-2 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-2xl shadow-2xl z-50 min-w-[180px] py-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <button onClick={copyHash} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors">
                    <Copy className="w-4 h-4 text-muted-foreground" /> Copy hash
                  </button>
                  {isOwnCast && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button onClick={handleDelete} disabled={deleteLoading} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-destructive hover:bg-destructive/8 transition-colors disabled:opacity-50">
                        {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Delete cast
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Cast text · swapped in place with the translation when active */}
          {cast.text && (
            translation ? (
              <div className="mb-3" onClick={(e) => e.stopPropagation()}>
                <p dir="auto" className="text-[1.0625rem] text-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {translation}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Translated ·{" "}
                  <button onClick={handleTranslate} className="text-primary font-semibold hover:underline">Show original</button>
                </p>
              </div>
            ) : (
              <CastBody cast={cast} navigate={navigate}
                onOpen={expanded ? undefined : () => navigate(`/cast/${cast.hash}`)}
                className="text-[1.0625rem] text-foreground leading-relaxed whitespace-pre-wrap break-words mb-3" />
            )
          )}

          {/* Images */}
          {imageEmbeds.length > 0 && (
            <div className={cn("mb-3 grid gap-0.5 rounded-2xl overflow-hidden", imageEmbeds.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {imageEmbeds.slice(0, 4).map((e, i) => (
                <div key={i} className="overflow-hidden bg-muted cursor-zoom-in" style={{ maxHeight: 350 }}
                  onClick={() => { if (e.url) setLightbox({ urls: imageUrls, idx: i }); }}>
                  <img src={e.url} alt="" className="w-full h-full object-cover hover:opacity-95 transition-opacity" loading="lazy"
                    onError={(el) => { const p = (el.target as HTMLImageElement).parentElement; if (p) p.style.display = "none"; }} />
                </div>
              ))}
            </div>
          )}

          {/* Videos */}
          {videoEmbeds.length > 0 && (
            <div className="mb-3 rounded-2xl overflow-hidden bg-black">
              {videoEmbeds.slice(0, 1).map((e, i) => (
                <video key={i} src={e.url} controls playsInline className="w-full max-h-[420px]" style={{ maxHeight: 420 }} />
              ))}
            </div>
          )}

          {/* Link embeds */}
          {linkEmbeds.length > 0 && (
            <div className="mb-3">
              {linkEmbeds.slice(0, 1).map((e, i) => (
                <a key={i} href={e.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary/80 hover:text-primary hover:underline truncate max-w-full">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{e.url}</span>
                </a>
              ))}
            </div>
          )}

          {/* Quote casts (embedded cast previews) */}
          {castEmbeds.length > 0 && (
            <div className="mb-3">
              {castEmbeds.slice(0, 1).map((e, i) => (
                e.cast && <QuoteCastPreview key={i} quotedCast={e.cast} onClick={() => navigate(`/cast/${e.cast!.hash}`)} />
              ))}
            </div>
          )}

          {/* Timestamp */}
          <div className="py-3 border-t border-border/60">
            <span className="text-[0.8125rem] text-muted-foreground">{formatTimestamp(cast.timestamp)}</span>
          </div>

          {/* Stats row */}
          {(recastCount > 0 || likeCount > 0 || replyCount > 0) && (
            <div className="flex items-center gap-4 py-3 border-t border-border/60 flex-wrap">
              {recastCount > 0 && (
                <button
                  onClick={(e) => openReactions("recasts", e)}
                  className="text-[0.9375rem] text-foreground hover:underline"
                >
                  <span className="font-bold">{formatCountFull(recastCount)}</span>
                  <span className="text-muted-foreground ml-1">{recastCount === 1 ? "recast" : "recasts"}</span>
                </button>
              )}
              {replyCount > 0 && (
                <span className="text-[0.9375rem] text-foreground">
                  <span className="font-bold">{formatCountFull(replyCount)}</span>
                  <span className="text-muted-foreground ml-1">{replyCount === 1 ? "reply" : "replies"}</span>
                </span>
              )}
              {likeCount > 0 && (
                <button
                  onClick={(e) => openReactions("likes", e)}
                  className="text-[0.9375rem] text-foreground hover:underline"
                >
                  <span className="font-bold">{formatCountFull(likeCount)}</span>
                  <span className="text-muted-foreground ml-1">{likeCount === 1 ? "like" : "likes"}</span>
                </button>
              )}
              {viewCount && viewCount > 0 && (
                <span className="text-[0.9375rem] text-foreground">
                  <span className="font-bold">{formatCountFull(viewCount)}</span>
                  <span className="text-muted-foreground ml-1">views</span>
                </span>
              )}
            </div>
          )}

          {/* Reactions bar */}
          <div className="flex items-center gap-1 py-1 border-t border-border/60 -mx-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => { e.stopPropagation(); if (!canWrite) { toast.error(autoSignerLoading ? "Signer is still being set up…" : "Signer not registered · go to Profile → Settings → Signer."); return; } setShowReplyComposer(true); }}
              className="flex items-center gap-1 px-2.5 py-2.5 rounded-full text-muted-foreground hover:text-[hsl(210,100%,50%)] hover:bg-[hsl(210,100%,50%)]/10 transition-colors"
              title="Reply"
            >
              <MessageCircle className="w-5 h-5" />
            </button>
            <div className="relative" ref={recastMenuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); if (!canWrite) { toast.error(autoSignerLoading ? "Signer is still being set up…" : "Signer not registered · go to Profile → Settings → Signer."); return; } setShowRecastMenu((v) => !v); }}
                title={noWriteTitle}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-2.5 rounded-full transition-colors",
                  recastError ? "text-destructive"
                    : recasted ? "text-[hsl(145,63%,42%)] bg-[hsl(145,63%,42%)]/10"
                    : "text-muted-foreground hover:text-[hsl(145,63%,42%)] hover:bg-[hsl(145,63%,42%)]/10"
                )}
              >
                <Repeat2 className="w-5 h-5" />
              </button>
              {showRecastMenu && (
                <div className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-xl shadow-2xl z-50 min-w-[140px] py-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { setShowRecastMenu(false); handleRecast(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <Repeat2 className="w-4 h-4 text-[hsl(145,63%,42%)]" />
                    {recasted ? "Undo Recast" : "Recast"}
                  </button>
                  <button
                    onClick={() => { setShowRecastMenu(false); setShowQuoteComposer(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <Quote className="w-4 h-4 text-primary" />
                    Quote Cast
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleLike}
              disabled={!canWrite}
              title={noWriteTitle}
              className={cn(
                "flex items-center gap-1 px-2.5 py-2.5 rounded-full transition-colors",
                likeError ? "text-destructive"
                  : liked
                    ? mentionsFidcaster ? "text-primary bg-primary/10" : "text-rose-500 bg-rose-500/10"
                    : mentionsFidcaster ? "text-muted-foreground hover:text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10",
                !canWrite && "opacity-40 cursor-default"
              )}
            >
              {mentionsFidcaster
                ? <FMark className="w-5 h-5" filled={liked} />
                : <Heart className={cn("w-5 h-5", liked && "fill-current")} />}
            </button>
            {/* ml-auto pushes Share to the far right, aligning it under the "..."
                menu at the top of the card instead of sitting inline after Like. */}
            <ShareButton cast={cast} menuDirection="up" iconSize={20} wrapperClassName="ml-auto" iconClassName="flex items-center gap-1 px-2.5 py-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" />
          </div>
        </div>

        {lightbox && createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92 backdrop-blur-md" onClick={() => setLightbox(null)}>
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" title="Save image"
                onClick={(e) => { e.stopPropagation(); saveImage(lightbox.urls[lightbox.idx]); }}>
                <Download className="w-5 h-5" />
              </button>
              <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={() => setLightbox(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {lightbox.urls.length > 1 && (
              <>
                <button className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30"
                  disabled={lightbox.idx === 0}
                  onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb ? { ...lb, idx: lb.idx - 1 } : lb); }}>
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30"
                  disabled={lightbox.idx === lightbox.urls.length - 1}
                  onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb ? { ...lb, idx: lb.idx + 1 } : lb); }}>
                  <ChevronRight className="w-6 h-6" />
                </button>
              </>
            )}
            <img src={lightbox.urls[lightbox.idx]} alt="" className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
            {lightbox.urls.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                {lightbox.urls.map((_, i) => (
                  <button key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${i === lightbox.idx ? "bg-white scale-125" : "bg-white/40"}`}
                    onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb ? { ...lb, idx: i } : lb); }} />
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          "group border-b border-border hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors duration-150 cursor-pointer px-4 py-3"
        )}
        onPointerDown={trackGestureStart}
        onClick={openThread}
      >
        <div className="flex-1 min-w-0">
            {/* Author row */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Avatar inline with name */}
                <button className="shrink-0" onClick={(e) => { e.stopPropagation(); goToProfile(cast.author); }}>
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-muted flex items-center justify-center hover:opacity-90 transition-opacity">
                    {cast.author.pfp_url ? (
                      <img src={cast.author.pfp_url} alt={cast.author.display_name} className="w-full h-full object-cover" loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <User className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-1 min-w-0 flex-wrap">
                <button
                  onClick={(e) => { e.stopPropagation(); goToProfile(cast.author); }}
                  className="font-semibold text-[0.9375rem] text-foreground hover:underline truncate"
                >
                  @{cast.author.username}
                </button>
                {authorIsPro && <ProBadge size={14} />}
                <span className="text-[0.875rem] text-muted-foreground truncate hidden sm:inline">{cast.author.display_name || cast.author.username}</span>
                {hasPowerBadge(cast.author) && (
                  <span title="Purple badge" className="shrink-0 inline-flex">
                    <PowerBadgeIcon size={15} />
                  </span>
                )}
                {cast.channel && (
                  <>
                    <span className="text-muted-foreground/60 text-[0.8125rem] shrink-0">in</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/channel/${cast.channel!.id}`); }}
                      className="flex items-center gap-1 shrink-0 min-w-0 px-1.5 py-0.5 rounded-full bg-muted/60 hover:bg-muted transition-colors"
                    >
                      <span className="w-3.5 h-3.5 rounded-full overflow-hidden bg-primary/10 shrink-0">
                        {cast.channel.image_url && <img src={cast.channel.image_url} alt="" className="w-full h-full object-cover" />}
                      </span>
                      <span className="text-[0.8125rem] font-medium text-foreground/80 truncate max-w-[100px]">{cast.channel.name}</span>
                    </button>
                  </>
                )}
                <span className="text-muted-foreground/50 text-sm shrink-0">·</span>
                <span className="text-[0.875rem] text-muted-foreground shrink-0">{timeAgo(cast.timestamp)}</span>
                </div>
              </div>

              {/* Translate + more menu · grouped so justify-between doesn't split them apart */}
              <div className="flex items-center gap-0.5 shrink-0 ml-1">
              {cast.text && (
                <button
                  onClick={handleTranslate}
                  title={translation ? "Show original" : "Translate"}
                  className={cn(
                    "p-1.5 rounded-full transition-colors shrink-0",
                    translation ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" strokeWidth={1.75} />}
                </button>
              )}
              <div className="relative shrink-0" ref={menuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
                  className="p-1.5 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showMenu && (
                  <div
                    className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-2xl shadow-2xl z-50 min-w-[180px] py-1 overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={copyHash}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <Copy className="w-4 h-4 text-muted-foreground" />
                      Copy hash
                    </button>
                    {isOwnCast && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <button
                          onClick={handleDelete}
                          disabled={deleteLoading}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-destructive hover:bg-destructive/8 transition-colors disabled:opacity-50"
                        >
                          {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          Delete cast
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              </div>
            </div>

            {/* Body column · indented to align under the avatar+name row above,
                instead of sitting flush at the card's left edge. */}
            <div className="ml-[54px]">
            {/* Cast text · swapped in place with the translation when active */}
            {cast.text && (
              translation ? (
                <div className="mb-2.5" onClick={(e) => e.stopPropagation()}>
                  <p dir="auto" className="text-[0.9375rem] text-foreground leading-snug whitespace-pre-wrap break-words">
                    {translation}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Translated ·{" "}
                    <button onClick={handleTranslate} className="text-primary font-semibold hover:underline">Show original</button>
                  </p>
                </div>
              ) : (
                <CastBody cast={cast} navigate={navigate}
                  onOpen={expanded ? undefined : () => navigate(`/cast/${cast.hash}`)}
                  className="text-[0.9375rem] text-foreground leading-snug whitespace-pre-wrap break-words mb-2.5" />
              )
            )}

            {/* Images */}
            {imageEmbeds.length > 0 && (
              <div className={cn("mb-2.5 grid gap-0.5 rounded-2xl overflow-hidden", imageEmbeds.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {imageEmbeds.slice(0, 4).map((e, i) => (
                  <div key={i} className="overflow-hidden bg-muted cursor-zoom-in" style={{ maxHeight: 300 }}
                    onClick={(ev) => { ev.stopPropagation(); if (e.url) setLightbox({ urls: imageUrls, idx: i }); }}>
                    <img src={e.url} alt="" className="w-full h-full object-cover hover:opacity-95 transition-opacity" loading="lazy"
                      onError={(el) => { const p = (el.target as HTMLImageElement).parentElement; if (p) p.style.display = "none"; }} />
                  </div>
                ))}
              </div>
            )}

            {/* Videos */}
            {videoEmbeds.length > 0 && (
              <div className="mb-2.5 rounded-2xl overflow-hidden bg-black" onClick={(ev) => ev.stopPropagation()}>
                {videoEmbeds.slice(0, 1).map((e, i) => (
                  <video key={i} src={e.url} controls playsInline className="w-full max-h-[360px]" style={{ maxHeight: 360 }} />
                ))}
              </div>
            )}

            {/* Link embeds */}
            {linkEmbeds.length > 0 && (
              <div className="mb-2.5">
                {linkEmbeds.slice(0, 1).map((e, i) => (
                  <a key={i} href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-sm text-primary/80 hover:text-primary hover:underline truncate max-w-full">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{e.url}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Quote casts (embedded cast previews) */}
            {castEmbeds.length > 0 && (
              <div className="mb-2.5">
                {castEmbeds.slice(0, 1).map((e, i) => (
                  e.cast && <QuoteCastPreview key={i} quotedCast={e.cast} onClick={() => navigate(`/cast/${e.cast!.hash}`)} />
                ))}
              </div>
            )}

            {/* Reactions */}
            <div className="flex items-center gap-1 -ml-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => navigate(`/cast/${cast.hash}`)}
                className="flex items-center gap-1 px-1.5 py-1.5 rounded-full text-muted-foreground hover:text-[hsl(210,100%,50%)] hover:bg-[hsl(210,100%,50%)]/10 transition-colors text-sm"
                title="Reply"
              >
                <MessageCircle className="w-[18px] h-[18px]" />
                {cast.replies.count > 0 && <span className="text-[0.8125rem]">{formatCount(cast.replies.count)}</span>}
              </button>

              <div className="relative" ref={recastMenuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); if (!canWrite) { toast.error(autoSignerLoading ? "Signer is still being set up…" : "Signer not registered · go to Profile → Settings → Signer."); return; } setShowRecastMenu((v) => !v); }}
                  title={noWriteTitle}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-1.5 rounded-full transition-colors text-sm",
                    recastError ? "text-destructive"
                      : recasted ? "text-[hsl(145,63%,42%)] bg-[hsl(145,63%,42%)]/10"
                      : "text-muted-foreground hover:text-[hsl(145,63%,42%)] hover:bg-[hsl(145,63%,42%)]/10"
                  )}
                >
                  <Repeat2 className="w-[18px] h-[18px]" />
                  {recastCount > 0 && <span className="text-[0.8125rem]">{formatCount(recastCount)}</span>}
                </button>
                {showRecastMenu && (
                  <div className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-xl shadow-2xl z-50 min-w-[140px] py-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { setShowRecastMenu(false); handleRecast(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <Repeat2 className="w-4 h-4 text-[hsl(145,63%,42%)]" />
                      {recasted ? "Undo Recast" : "Recast"}
                    </button>
                    <button
                      onClick={() => { setShowRecastMenu(false); setShowQuoteComposer(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <Quote className="w-4 h-4 text-primary" />
                      Quote Cast
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleLike}
                disabled={!canWrite}
                title={noWriteTitle}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-1.5 rounded-full transition-colors text-sm",
                  likeError ? "text-destructive"
                    : liked
                      ? mentionsFidcaster ? "text-primary bg-primary/10" : "text-rose-500 bg-rose-500/10"
                      : mentionsFidcaster ? "text-muted-foreground hover:text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10",
                  !canWrite && "opacity-40 cursor-default"
                )}
              >
                {mentionsFidcaster
                  ? <FMark className="w-[18px] h-[18px]" filled={liked} />
                  : <Heart className={cn("w-[18px] h-[18px]", liked && "fill-current")} />}
                {likeCount > 0 && <span className="text-[0.8125rem]">{formatCount(likeCount)}</span>}
              </button>
              {/* ml-auto pushes Share to the far right, aligning it under the "..."
                  menu at the top of the card instead of sitting inline after Like. */}
              <ShareButton cast={cast} menuDirection="up" iconSize={16} wrapperClassName="ml-auto" iconClassName="flex items-center gap-1 px-1.5 py-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors text-sm" />
            </div>
            </div>
          </div>
      </div>

      {showReplyComposer && createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={() => setShowReplyComposer(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm text-foreground">Reply</h2>
              <button onClick={() => setShowReplyComposer(false)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <CastComposer
              replyTo={cast}
              onCanceled={() => setShowReplyComposer(false)}
              onPublished={() => setShowReplyComposer(false)}
            />
          </div>
        </div>,
        document.body
      )}

      {showQuoteComposer && createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={() => setShowQuoteComposer(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-sm text-foreground">Quote Cast</h2>
              <button onClick={() => setShowQuoteComposer(false)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <CastComposer
              quoteCast={cast}
              onCanceled={() => setShowQuoteComposer(false)}
              onPublished={() => setShowQuoteComposer(false)}
            />
          </div>
        </div>,
        document.body
      )}

      {lightbox && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92 backdrop-blur-md" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={() => setLightbox(null)}>
            <X className="w-5 h-5" />
          </button>
          {lightbox.urls.length > 1 && (
            <>
              <button className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30"
                disabled={lightbox.idx === 0}
                onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb ? { ...lb, idx: lb.idx - 1 } : lb); }}>
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-30"
                disabled={lightbox.idx === lightbox.urls.length - 1}
                onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb ? { ...lb, idx: lb.idx + 1 } : lb); }}>
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
          <img src={lightbox.urls[lightbox.idx]} alt="" className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
          {lightbox.urls.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
              {lightbox.urls.map((_, i) => (
                <button key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${i === lightbox.idx ? "bg-white scale-125" : "bg-white/40"}`}
                  onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb ? { ...lb, idx: i } : lb); }} />
              ))}
            </div>
          )}
        </div>,
        document.body
      )}

      {reactionsModal && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
          onClick={() => setReactionsModal(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-sm bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-border shrink-0">
              <h2 className="font-semibold text-sm text-foreground capitalize">
                {reactionsModal.type === "likes" ? "Liked by" : "Recasted by"}
              </h2>
              <button
                onClick={() => setReactionsModal(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 py-1">
              {reactionsModal.loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                </div>
              ) : reactionsModal.users.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">No one yet</p>
              ) : (
                reactionsModal.users.map((u) => (
                  <button
                    key={u.fid}
                    onClick={() => { setReactionsModal(null); navigate(`/profile/${u.fid}`); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors text-left"
                  >
                    {u.pfp_url ? (
                      <img src={u.pfp_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground truncate">@{u.username}</span>
                        {hasPowerBadge(u) && <PowerBadgeIcon size={14} />}
                      </div>
                      <span className="text-xs text-muted-foreground truncate">{u.display_name || u.username}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono shrink-0">{u.follower_count >= 1000 ? `${(u.follower_count / 1000).toFixed(1)}k` : u.follower_count} followers</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
