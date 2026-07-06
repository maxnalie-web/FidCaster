import { useState, useRef, useEffect } from "react";
import { Loader2, X, ImagePlus, Upload, Hash, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { hubPublishCast, neynarAction } from "@/lib/hub-submit";
import type { NeynarCast } from "@/lib/neynar";
import { getFollowedChannels, type FollowedChannel } from "@/lib/channel-follows";
import { getLocalDraft, saveDraft, clearDraft, syncDraftFromServer } from "@/lib/cast-drafts";

const MAX_CHARS = 640;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

type Media = { url: string; kind: "image" | "video" };

const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;
function mediaFromUrl(url: string): Media {
  return { url, kind: VIDEO_URL_RE.test(url) ? "video" : "image" };
}

/** Read a file as a raw base64 data URL · works for ANY file, never decode-fails. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Try to downscale + recompress via canvas (smaller upload, strips EXIF).
 * Falls back to the raw file bytes if the browser can't decode the image
 * (e.g. HEIC from iPhone) so upload never hard-fails on a valid image.
 */
async function fileToUploadPayload(file: File): Promise<{ base64: string; mime: string }> {
  // Already small enough and a web-safe format → skip canvas, send as-is.
  const rawDataUrl = await readAsDataUrl(file);
  const rawBase64 = rawDataUrl.split(",")[1] ?? "";

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const maxDim = 1280;
          let { width, height } = img;
          if (!width || !height) throw new Error("zero dimensions");
          if (width > maxDim || height > maxDim) {
            if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
            else { width = Math.round(width * maxDim / height); height = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no 2d context");
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(objUrl);
          const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
          resolve(canvas.toDataURL(mime, 0.85));
        } catch (err) { URL.revokeObjectURL(objUrl); reject(err); }
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("decode failed")); };
      img.src = objUrl;
    });
    return { base64: dataUrl.split(",")[1], mime: dataUrl.split(";")[0].split(":")[1] };
  } catch {
    // Canvas path failed · send the original bytes untouched.
    return { base64: rawBase64, mime: file.type || "image/jpeg" };
  }
}

/** Direct browser → catbox.moe upload — free, no API key, scales independently
 * of our own server (critical for video, which can run tens of MB per file). */
async function uploadToCatbox(file: File): Promise<string> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", file);
  const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !text.startsWith("http")) throw new Error(text || "Upload failed");
  return text;
}

async function uploadViaServer(base64: string, mime: string): Promise<string> {
  const res = await fetch("/api/farcaster/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, type: mime }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? "Upload failed");
  }
  const data = await res.json() as { url: string };
  return data.url;
}

async function uploadMedia(file: File, isVideo: boolean): Promise<string> {
  try {
    return await uploadToCatbox(file);
  } catch { /* fall through to a same-origin proxy below */ }

  if (isVideo) {
    // Videos are too large for a comfortable base64/JSON round trip · catbox
    // direct upload is the only path, so surface a clear retry message.
    throw new Error("Video upload failed, check your connection and try again.");
  }

  const { base64, mime } = await fileToUploadPayload(file);
  const clientId = (import.meta.env.VITE_IMGUR_CLIENT_ID ?? "") as string;
  if (clientId) {
    try {
      const form = new FormData();
      form.append("image", base64);
      form.append("type", "base64");
      const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: `Client-ID ${clientId}` },
        body: form,
      });
      if (res.ok) {
        const data = await res.json() as { data: { link: string } };
        return data.data.link;
      }
    } catch { /* fall through to server proxy */ }
  }

  return uploadViaServer(base64, mime);
}

type Props = {
  replyTo?: NeynarCast;
  quoteCast?: NeynarCast;
  onCanceled?: () => void;
  onPublished: (cast: NeynarCast) => void;
  placeholder?: string;
  /** Pre-select a channel to cast into (e.g. opened from a channel page). */
  defaultChannel?: FollowedChannel;
};

export function CastComposer({ replyTo, quoteCast, onCanceled, onPublished, placeholder, defaultChannel }: Props) {
  const { fid, localSigner, signerUuid, signerApproved, neynarKey, profile, autoSignerLoading, authMethod } = useWallet();
  const followedChannels = fid ? getFollowedChannels(Number(fid)) : [];

  // Drafts only apply to a plain new cast — replies/quotes are short-lived and
  // tied to whatever cast is open right now, not worth persisting.
  const isDraftable = !replyTo && !quoteCast;
  const localDraft = isDraftable && fid ? getLocalDraft(Number(fid)) : null;

  const [text, setText] = useState(localDraft?.text ?? "");
  const [channel, setChannel] = useState<FollowedChannel | null>(
    defaultChannel ?? (localDraft?.channelId ? followedChannels.find((c) => c.id === localDraft.channelId) ?? null : null),
  );
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const quoteUrl = quoteCast
    ? `https://farcaster.xyz/${quoteCast.author.username}/${quoteCast.hash.slice(0, 10)}`
    : "";
  const [embedUrl] = useState(quoteUrl);
  const [media, setMedia] = useState<Media[]>((localDraft?.embeds ?? []).map(mediaFromUrl));
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea as content grows (max 240px then scroll)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 240);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > 240 ? "auto" : "hidden";
  }, [text]);

  // Pull the server copy of the draft on mount — this is what actually
  // survives logout/reinstall (local storage alone would not), so a draft
  // started before those may still show up here.
  useEffect(() => {
    if (!isDraftable || !fid) return;
    let cancelled = false;
    void syncDraftFromServer(Number(fid)).then((draft) => {
      if (cancelled || !draft) return;
      setText((cur) => (cur ? cur : draft.text));
      setMedia((cur) => (cur.length > 0 ? cur : draft.embeds.map(mediaFromUrl)));
      if (draft.channelId && !channel) {
        const match = followedChannels.find((c) => c.id === draft.channelId);
        if (match) setChannel(match);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraftable, fid]);

  // Debounced autosave — keeps the draft current as the user types/attaches
  // media, without hammering the server on every keystroke.
  useEffect(() => {
    if (!isDraftable || !fid) return;
    if (!text.trim() && media.length === 0) return;
    const t = setTimeout(() => {
      saveDraft(Number(fid), { text, embeds: media.map((m) => m.url), channelId: channel?.id ?? null });
    }, 800);
    return () => clearTimeout(t);
  }, [isDraftable, fid, text, media, channel]);

  const canCast = signerApproved && (Boolean(localSigner) || Boolean(signerUuid)) && Boolean(fid);
  const charCount = text.length;
  const remaining = MAX_CHARS - charCount;
  const canSubmit = text.trim().length > 0 && remaining >= 0 && canCast && !submitting && !uploading;

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);

    // Track additions locally within this batch · setMedia is async, so
    // reading `media` mid-loop would let a single multi-select batch blow
    // past the 4-photo/1-video cap.
    let pending = [...media];

    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) { setError("Please select an image or video file."); break; }

      const hasVideo = pending.some((m) => m.kind === "video");
      const imageCount = pending.filter((m) => m.kind === "image").length;
      if (isVideo && pending.length > 0) { setError("A cast can include either up to 4 photos or 1 video, not both."); break; }
      if (isImage && hasVideo) { setError("Remove the video before adding photos."); break; }
      if (isImage && imageCount >= MAX_IMAGES) { setError(`Up to ${MAX_IMAGES} photos per cast.`); break; }
      if (isVideo && file.size > MAX_VIDEO_BYTES) { setError("Video must be smaller than 50 MB."); continue; }
      if (isImage && file.size > MAX_IMAGE_BYTES) { setError("Image must be smaller than 10 MB."); continue; }

      setUploading(true);
      try {
        const url = await uploadMedia(file, isVideo);
        const entry: Media = { url, kind: isVideo ? "video" : "image" };
        pending = [...pending, entry];
        setMedia(pending);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeMedia(url: string) {
    setMedia((prev) => prev.filter((m) => m.url !== url));
  }

  async function handleSubmit() {
    if (!canSubmit || !fid) return;
    setSubmitting(true);
    setError(null);
    try {
      const allEmbeds = [
        ...media.map((m) => m.url),
        ...(embedUrl.trim() ? [embedUrl.trim()] : []),
      ];
      const parentUrl = !replyTo && channel?.url ? channel.url : undefined;
      if (localSigner) {
        await hubPublishCast(Number(fid), localSigner, text.trim(), {
          embeds: allEmbeds.length > 0 ? allEmbeds : undefined,
          parentHash: replyTo?.hash,
          parentFid: replyTo?.author.fid,
          parentUrl,
          neynarKey,
        });
      } else if (signerUuid) {
        await neynarAction(signerUuid, {
          type: "cast",
          text: text.trim(),
          embeds: allEmbeds.length > 0 ? allEmbeds : undefined,
          parentHash: replyTo?.hash,
          parentUrl,
        });
      } else {
        throw new Error("Signer not ready");
      }
      // Optimistic update · create a synthetic cast for immediate UI feedback
      const fake: NeynarCast = {
        hash: `0xlocal${Date.now().toString(16)}`,
        author: {
          fid: Number(fid),
          username: profile?.username ?? "",
          display_name: profile?.displayName ?? "",
          pfp_url: profile?.pfpUrl ?? "",
          follower_count: profile?.followerCount ?? 0,
          following_count: profile?.followingCount ?? 0,
        },
        text: text.trim(),
        timestamp: new Date().toISOString(),
        embeds: allEmbeds.map((url) => ({ url })),
        reactions: { likes_count: 0, recasts_count: 0, likes: [], recasts: [] },
        replies: { count: 0 },
      };
      setText("");
      setMedia([]);
      if (isDraftable && fid) clearDraft(Number(fid));
      onPublished(fake);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to publish cast");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (!canCast) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center border-b border-border/40">
        {autoSignerLoading
          ? "Registering your signer on Optimism…"
          : "Signer setup required · check the Signer tab in Settings."}
      </div>
    );
  }

  const hasVideo = media.some((m) => m.kind === "video");
  const imageCount = media.filter((m) => m.kind === "image").length;
  const mediaFull = hasVideo || imageCount >= MAX_IMAGES;

  return (
    <div className="border-b border-border/40 px-5 py-4 bg-gradient-to-b from-primary/[0.03] to-transparent">
      {replyTo && (
        <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-muted/30 border border-border/40">
          <div className="text-xs text-muted-foreground truncate">
            Replying to <span className="text-primary font-medium">@{replyTo.author.username}</span>
            {replyTo.text && (
              <span className="ml-1 opacity-70">{replyTo.text.slice(0, 60)}{replyTo.text.length > 60 && "..."}</span>
            )}
          </div>
          {onCanceled && (
            <button onClick={onCanceled} className="shrink-0 ml-2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center ring-2 ring-primary/15">
          {profile?.pfpUrl ? (
            <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-bold text-primary">
              {profile?.displayName?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? (quoteCast ? "Add your thoughts…" : replyTo ? "Write your reply…" : "Share a cast…")}
            className="w-full bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/50 resize-none outline-none leading-relaxed min-h-[96px]"
            style={{ overflowY: "hidden" }}
          />

          {quoteCast && (
            <div className="mt-2 p-2.5 rounded-xl border border-border/60 bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-4 h-4 rounded-full overflow-hidden bg-muted shrink-0">
                  {quoteCast.author.pfp_url && <img src={quoteCast.author.pfp_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground">@{quoteCast.author.username}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{quoteCast.text}</p>
            </div>
          )}

          {media.length > 0 && (
            <div className={cn("mt-2.5 grid gap-2", media.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {media.map((m) => (
                <div key={m.url} className="relative rounded-2xl overflow-hidden bg-muted/20 border border-border/40 flex items-center justify-center shadow-sm" style={{ maxHeight: 320 }}>
                  {m.kind === "video" ? (
                    <div className="relative w-full">
                      <video src={m.url} className="w-full max-h-[320px] object-contain" muted playsInline />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                        <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <img src={m.url} alt="" className="max-w-full max-h-[320px] object-contain" />
                  )}
                  <button
                    onClick={() => removeMedia(m.url)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
        </div>
      </div>

      {/* Toolbar · full width, aligned to left edge */}
      <div className="flex items-center justify-between mt-3.5">
        <div className="flex items-center gap-1.5">
          {!replyTo && followedChannels.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowChannelPicker((v) => !v)}
                title={channel ? `Casting in ${channel.name}` : "Choose a channel"}
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  channel ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                )}
              >
                {channel?.image_url ? (
                  <div className="w-4 h-4 rounded-full overflow-hidden bg-primary/10 shrink-0">
                    <img src={channel.image_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <Hash className="w-4 h-4" />
                )}
              </button>
              {showChannelPicker && (
                <div className="absolute bottom-full mb-1 left-0 z-20 bg-popover border border-border rounded-xl shadow-xl overflow-hidden min-w-[200px] py-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {channel ? `Casting in ${channel.name}` : "Cast to your main feed"}
                  </div>
                  <div className="border-t border-border" />
                  <button
                    onClick={() => { setChannel(null); setShowChannelPicker(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    None · your main feed
                  </button>
                  <div className="my-1 border-t border-border" />
                  {followedChannels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setChannel(c); setShowChannelPicker(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                    >
                      <div className="w-4 h-4 rounded-md overflow-hidden bg-primary/10 shrink-0">
                        {c.image_url && <img src={c.image_url} alt="" className="w-full h-full object-cover" />}
                      </div>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || mediaFull}
            title="Add photo or video · up to 4 photos or 1 video"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
          </button>
          {uploading && (
            <span className="text-[10px] text-muted-foreground ml-1 flex items-center gap-1">
              <Upload className="w-3 h-3 animate-bounce" />
              Uploading…
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className={cn(
            "text-xs tabular-nums",
            remaining < 20 ? "text-destructive" : remaining < 60 ? "text-amber-400" : "text-muted-foreground"
          )}>
            {remaining}
          </span>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-1.5 rounded-full text-xs font-semibold btn-luxury text-primary-foreground shadow-sm"
          >
            {submitting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Casting…
              </span>
            ) : replyTo ? "Reply" : "Cast"}
          </button>
        </div>
      </div>
    </div>
  );
}