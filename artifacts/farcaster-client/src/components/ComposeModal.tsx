import { X } from "lucide-react";
import { CastComposer } from "@/components/CastComposer";
import type { NeynarCast } from "@/lib/neynar";
import type { FollowedChannel } from "@/lib/channel-follows";

/**
 * Centered popup wrapper around CastComposer · shared by Home, Profile and
 * Channel so the "new cast" experience is identical everywhere: a modal card
 * on every screen size, dismissable by backdrop tap or the ✕.
 */
export function ComposeModal({
  onClose,
  onPublished,
  defaultChannel,
  title = "New Cast",
}: {
  onClose: () => void;
  onPublished: (cast: NeynarCast) => void;
  defaultChannel?: FollowedChannel;
  title?: string;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-background rounded-2xl shadow-2xl border border-border flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-bold text-foreground">{title}</span>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <CastComposer
            defaultChannel={defaultChannel}
            onPublished={(c) => { onPublished(c); onClose(); }}
            onCanceled={onClose}
          />
        </div>
      </div>
    </div>
  );
}
