import { useState, useRef, useEffect } from "react";
import { Loader2, X, Link2, ImagePlus, Upload, Quote, Hash, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { hubPublishCast, neynarAction } from "@/lib/hub-submit";
import type { NeynarCast } from "@/lib/neynar";
import { getFollowedChannels, type FollowedChannel } from "@/lib/channel-follows";

const MAX_CHARS = 320;

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

async function uploadImage(file: File): Promise<string> {
  const { base64, mime } = await fileToUploadPayload(file);

  const clientId = (import.meta.env.VITE_IMGUR_CLIENT_ID ?? "") as string;
  if (clientId) {
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
    // fall through to server proxy on Imgur failure
  }

  // Server-proxy fallback · server uploads to freeimage.host (free, no key needed)
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
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<FollowedChannel | null>(defaultChannel ?? null);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const followedChannels = fid ? getFollowedChannels(Number(fid)) : [];
  const quoteUrl = quoteCast
    ? `https://farcaster.xyz/${quoteCast.author.username}/${quoteCast.hash.slice(0, 10)}`
    : "";
  const [embedUrl, setEmbedUrl] = useState(quoteUrl);
  const [showEmbedInput, setShowEmbedInput] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea as content grows (max 300px)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [text]);

  const canCast = signerApproved && (Boolean(localSigner) || Boolean(signerUuid)) && Boolean(fid);
  const charCount = text.length;
  const remaining = MAX_CHARS - charCount;
  const canSubmit = text.trim().length > 0 && remaining >= 0 && canCast && !submitting && !uploading;

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Image must be smaller than 10 MB."); return; }
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      setUploadedImages((prev) => [...prev, url]);
    } catch (err: unknown) {
      // Show the embed URL input so the user can paste an image URL as a fallback
      setShowEmbedInput(true);
      setError(err instanceof Error ? err.message : "Image upload failed · paste a URL in the link field below");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeImage(url: string) {
    setUploadedImages((prev) => prev.filter((u) => u !== url));
  }

  async function handleSubmit() {
    if (!canSubmit || !fid) return;
    setSubmitting(true);
    setError(null);
    try {
      const allEmbeds = [
        ...uploadedImages,
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
      setEmbedUrl("");
      setShowEmbedInput(false);
      setUploadedImages([]);
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

  return (
    <div className="border-b border-border/40 px-5 py-4">
      {!replyTo && followedChannels.length > 0 && (
        <div className="relative mb-3">
          <button
            onClick={() => setShowChannelPicker((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
              channel ? "text-primary border-primary/30 bg-primary/8" : "text-muted-foreground border-border hover:text-foreground"
            )}
          >
            {channel ? (
              <>
                <div className="w-4 h-4 rounded-md overflow-hidden bg-primary/10 shrink-0">
                  {channel.image_url && <img src={channel.image_url} alt="" className="w-full h-full object-cover" />}
                </div>
                {channel.name}
              </>
            ) : (
              <><Hash className="w-3.5 h-3.5" /> Channel</>
            )}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showChannelPicker && (
            <div className="absolute top-full mt-1 left-0 z-20 bg-popover border border-border rounded-xl shadow-xl overflow-hidden min-w-[200px] py-1">
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
        <div className="w-9 h-9 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center ring-1 ring-border/50">
          {profile?.pfpUrl ? (
            <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-bold text-primary">
              {profile?.displayName?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </div>

        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? (quoteCast ? "Add your thoughts…" : replyTo ? "Write your reply…" : "Share a cast…")}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 resize-none outline-none leading-relaxed min-h-[96px]"
            style={{ overflow: "hidden" }}
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

          {uploadedImages.length > 0 && (
            <div className={cn("mt-2 grid gap-1.5", uploadedImages.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {uploadedImages.map((url) => (
                <div key={url} className="relative rounded-xl overflow-hidden bg-muted/20 border border-border/40 flex items-center justify-center" style={{ maxHeight: 320 }}>
                  <img src={url} alt="" className="max-w-full max-h-[320px] object-contain" />
                  <button
                    onClick={() => removeImage(url)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showEmbedInput && (
            <input
              type="url"
              value={embedUrl}
              onChange={(e) => setEmbedUrl(e.target.value)}
              placeholder="https://…"
              className="input-luxury w-full py-2 px-3 text-xs mt-2"
            />
          )}

          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
      </div>

      {/* Toolbar · full width, aligned to left edge */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || uploadedImages.length >= 4}
            title="Upload image"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowEmbedInput((v) => !v)}
            title="Add link"
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              showEmbedInput
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-primary hover:bg-primary/10"
            )}
          >
            <Link2 className="w-4 h-4" />
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
            className="px-4 py-1.5 rounded-lg text-xs font-semibold btn-luxury text-primary-foreground"
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
