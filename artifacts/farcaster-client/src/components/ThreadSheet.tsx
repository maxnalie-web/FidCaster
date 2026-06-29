import { useState, useEffect } from "react";
import { X, Loader2, MessageCircle, ArrowLeft } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getCastConversation, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { CastCard } from "./CastCard";
import { CastComposer } from "./CastComposer";

type Props = {
  cast: NeynarCast | null;
  onClose: () => void;
  onViewProfile?: (user: NeynarUser) => void;
  zIndex?: string;
};

export function ThreadSheet({ cast, onClose, onViewProfile, zIndex = "z-[60]" }: Props) {
  const { fid, neynarKey } = useWallet();
  const viewerFid = fid ? Number(fid) : 0;

  const [fullCast, setFullCast] = useState<NeynarCast | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cast) { setFullCast(null); return; }
    setLoading(true);
    setFullCast(null);
    getCastConversation(cast.hash, viewerFid, neynarKey)
      .then((res) => setFullCast(res.conversation.cast))
      .catch(() => setFullCast(cast))
      .finally(() => setLoading(false));
  }, [cast?.hash]);

  if (!cast) return null;

  const displayed = fullCast ?? cast;
  const replies = fullCast?.direct_replies ?? [];

  function handlePublished(newCast: NeynarCast) {
    setFullCast((prev) => {
      if (!prev) return prev;
      return { ...prev, direct_replies: [newCast, ...(prev.direct_replies ?? [])] };
    });
  }

  return (
    <div className={`fixed inset-0 ${zIndex} flex`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md h-full bg-background border-l border-border flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
              <MessageCircle className="w-4 h-4 text-primary" />
              Thread
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="border-b-2 border-border/70">
            <CastCard cast={displayed} viewerFid={viewerFid} onViewProfile={onViewProfile} />
          </div>

          <CastComposer
            replyTo={displayed}
            onPublished={handlePublished}
            placeholder={`Reply to @${displayed.author.username}...`}
          />

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : replies.length === 0 && !loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No replies yet</div>
          ) : (
            <div>
              {replies.length > 0 && (
                <div className="px-5 py-2 border-b border-border/30">
                  <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wide font-medium">
                    {replies.length} {replies.length === 1 ? "reply" : "replies"}
                  </span>
                </div>
              )}
              {replies.map((r) => (
                <CastCard
                  key={r.hash}
                  cast={r}
                  viewerFid={viewerFid}
                  onViewProfile={onViewProfile}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
