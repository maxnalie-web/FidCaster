import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Share, Link2, ImageIcon, Loader2, Send, Smartphone, MessageCircle } from "lucide-react";
import { renderCastToImage } from "@/lib/cast-image";
import { XLogo } from "@/components/NeynarScoreBadge";
import type { NeynarCast } from "@/lib/neynar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MENU_WIDTH = 190;
const MENU_EST_HEIGHT = 280;

/**
 * Share entry point for a cast: copy link, share out to X/Telegram/WhatsApp,
 * the device's native share sheet, and a rendered PNG image of the cast.
 */
export function ShareButton({ cast, iconClassName, iconSize = 18, menuDirection = "up" }: {
  cast: NeynarCast;
  iconClassName?: string;
  iconSize?: number;
  /** Preferred direction when there's room for it · auto-flips near a screen edge. */
  menuDirection?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Position the menu with `position: fixed` computed from the button's actual
  // on-screen rect, flipping up/down/left/right as needed · a plain
  // `absolute` + `bottom-full` menu used to render off the top of the
  // viewport whenever the share button sat near the top of a scrolled page
  // (e.g. the first cast on a profile), showing only its bottom half.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) { setMenuPos(null); return; }
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const goUp = menuDirection === "up"
      ? spaceAbove > MENU_EST_HEIGHT || spaceAbove > spaceBelow
      : spaceBelow < MENU_EST_HEIGHT && spaceAbove > spaceBelow;
    const top = goUp
      ? Math.max(8, rect.top - Math.min(MENU_EST_HEIGHT, spaceAbove - 8))
      : rect.bottom + 4;
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    );
    const maxHeight = goUp ? Math.min(MENU_EST_HEIGHT, rect.top - 16) : Math.min(MENU_EST_HEIGHT, window.innerHeight - rect.bottom - 16);
    setMenuPos({ top, left, maxHeight });
  }, [open, menuDirection]);

  const castUrl = `${window.location.origin}/cast/${cast.hash}`;
  const shareText = cast.text?.slice(0, 200) ?? "";

  async function copyLink() {
    setOpen(false);
    await navigator.clipboard.writeText(castUrl);
    toast.success("Link copied");
  }

  function shareToX() {
    setOpen(false);
    const url = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: castUrl })}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareToWhatsApp() {
    setOpen(false);
    const url = `https://api.whatsapp.com/send?${new URLSearchParams({ text: `${shareText}\n${castUrl}` })}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareToTelegram() {
    setOpen(false);
    const url = `https://t.me/share/url?${new URLSearchParams({ url: castUrl, text: shareText })}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function shareNative() {
    setOpen(false);
    const shareData = { title: "FidCaster", text: shareText, url: castUrl };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
      }
    } catch { /* user cancelled the native sheet */ }
  }

  async function shareImage() {
    setRendering(true);
    try {
      const blob = await renderCastToImage(cast);
      const file = new File([blob], `fidcaster-${cast.hash.slice(0, 8)}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "FidCaster" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success("Image saved");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") { /* user cancelled share sheet */ }
      else toast.error(e instanceof Error ? e.message : "Failed to render image");
    } finally {
      setRendering(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={iconClassName ?? "flex items-center gap-1 px-2.5 py-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"}
        title="Share"
      >
        <Share width={iconSize} height={iconSize} />
      </button>
      {open && menuPos && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH, maxHeight: menuPos.maxHeight }}
          className="bg-popover border border-border rounded-xl shadow-2xl z-50 py-1 overflow-y-auto"
        >
          <button onClick={copyLink} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors">
            <Link2 className="w-4 h-4 text-muted-foreground" /> Copy link
          </button>
          <div className="my-1 border-t border-border" />
          <button onClick={shareToWhatsApp} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors">
            <MessageCircle className="w-4 h-4 text-[#25D366]" /> WhatsApp
          </button>
          <button onClick={shareToX} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors">
            <XLogo size={14} className="text-foreground shrink-0" /> X
          </button>
          <button onClick={shareToTelegram} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors">
            <Send className="w-4 h-4 text-[#229ED9]" /> Telegram
          </button>
          {typeof navigator !== "undefined" && !!navigator.share && (
            <button onClick={shareNative} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors">
              <Smartphone className="w-4 h-4 text-muted-foreground" /> More…
            </button>
          )}
          <div className="my-1 border-t border-border" />
          <button onClick={shareImage} disabled={rendering} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50">
            {rendering ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
            Share as image
          </button>
        </div>
      )}
    </div>
  );
}
