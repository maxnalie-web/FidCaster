import { useState, useRef } from "react";
import { X, Search, Loader2, Trash2, Plus, Hash, Users, ImagePlus, ShieldCheck, Award } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { searchUsers, type NeynarUser } from "@/lib/neynar";
import {
  saveCustomFeed, deleteCustomFeed, validateFeedLogo,
  type CustomFeed, type SpamLabelFilter,
} from "@/lib/custom-feeds";
import { cn } from "@/lib/utils";

function newId(): string {
  return `feed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const SPAM_OPTIONS: { id: SpamLabelFilter; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "not-spam", label: "Not spam" },
  { id: "spam-only", label: "Spam only" },
];

export function CustomFeedBuilderSheet({ existing, onClose, onSaved, onDeleted }: {
  existing: CustomFeed | null;
  onClose: () => void;
  onSaved: (feed: CustomFeed) => void;
  onDeleted?: (id: string) => void;
}) {
  const { fid, neynarKey } = useWallet();
  const myFid = fid ? Number(fid) : 0;

  const [name, setName] = useState(existing?.name ?? "");
  const [logoUrl, setLogoUrl] = useState<string | undefined>(existing?.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<CustomFeed["accounts"]>(existing?.accounts ?? []);
  const [keywords, setKeywords] = useState<string[]>(existing?.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [minNeynarScore, setMinNeynarScore] = useState(existing?.minNeynarScore ?? 0);
  const [minFollowers, setMinFollowers] = useState(existing?.minFollowers ?? 0);
  const [spamLabel, setSpamLabel] = useState<SpamLabelFilter>(existing?.spamLabel ?? "any");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NeynarUser[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);
    const result = await validateFeedLogo(file);
    if (!result.ok) { setLogoError(result.error); if (logoInputRef.current) logoInputRef.current.value = ""; return; }
    setLogoUrl(result.dataUrl);
  }

  function onQueryChange(v: string) {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchUsers(v.trim(), myFid, neynarKey ?? "");
        setSuggestions(res.result?.users?.slice(0, 6) ?? []);
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 300);
  }

  function addAccount(u: NeynarUser) {
    if (accounts.some((a) => a.fid === u.fid)) return;
    setAccounts((prev) => [...prev, { fid: u.fid, username: u.username, pfp_url: u.pfp_url }]);
    setQuery("");
    setSuggestions([]);
  }

  function removeAccount(fidToRemove: number) {
    setAccounts((prev) => prev.filter((a) => a.fid !== fidToRemove));
  }

  function addKeyword() {
    const k = keywordInput.trim();
    if (!k || keywords.includes(k)) { setKeywordInput(""); return; }
    setKeywords((prev) => [...prev, k]);
    setKeywordInput("");
  }

  function removeKeyword(k: string) {
    setKeywords((prev) => prev.filter((x) => x !== k));
  }

  const hasAnyFilter = accounts.length > 0 || keywords.length > 0 || minNeynarScore > 0 || minFollowers > 0 || spamLabel !== "any";
  const canSave = name.trim().length > 0 && hasAnyFilter;

  function handleSave() {
    if (!canSave || !myFid) return;
    const feed: CustomFeed = {
      id: existing?.id ?? newId(),
      name: name.trim(),
      logoUrl,
      accountFids: accounts.map((a) => a.fid),
      accounts,
      keywords,
      minNeynarScore,
      minFollowers,
      spamLabel,
    };
    saveCustomFeed(myFid, feed);
    onSaved(feed);
  }

  function handleDelete() {
    if (!existing || !myFid) return;
    deleteCustomFeed(myFid, existing.id);
    onDeleted?.(existing.id);
  }

  return (
    <div className="fixed inset-0 z-[80] bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
        <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <X className="w-5 h-5" />
        </button>
        <span className="text-base font-bold">{existing ? "Edit feed" : "New custom feed"}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-6 max-w-lg mx-auto">
          <div className="flex items-start gap-3">
            <div className="space-y-1.5 shrink-0">
              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground block">Logo (optional)</label>
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoSelect} />
              <button
                onClick={() => logoInputRef.current?.click()}
                className="w-14 h-14 rounded-2xl border border-dashed border-border bg-muted/20 flex items-center justify-center overflow-hidden hover:border-primary/40 transition-colors"
              >
                {logoUrl ? <img src={logoUrl} alt="" className="w-full h-full object-cover" /> : <ImagePlus className="w-5 h-5 text-muted-foreground" />}
              </button>
              {logoUrl && (
                <button onClick={() => { setLogoUrl(undefined); setLogoError(null); }} className="text-[10px] text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              )}
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground">Feed name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                placeholder="e.g. Base builders, Design crowd, Signal only…"
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-[10px] text-muted-foreground">Square image, 64–1024px, under 1MB. Skip it and the feed just shows its name.</p>
              {logoError && <p className="text-[10px] text-destructive">{logoError}</p>}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-primary/5 border border-primary/15">
            <p className="text-[11px] text-foreground leading-relaxed">
              Every filter below is optional and independent · turn on just one, a couple, or all of
              them. Keywords alone with no accounts works fine, and so does accounts alone with no
              keywords.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5">
              <Users className="w-3 h-3" /> Accounts
            </label>
            <p className="text-xs text-muted-foreground">Only show casts from these accounts, if you pick any.</p>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Search @username…"
                  className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              </div>
              {suggestions.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
                  {suggestions.map((u) => (
                    <button
                      key={u.fid}
                      onClick={() => addAccount(u)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-full overflow-hidden bg-muted shrink-0">
                        {u.pfp_url ? <img src={u.pfp_url} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-[10px] font-bold text-primary">{(u.username || "?")[0].toUpperCase()}</span>}
                      </div>
                      <span className="text-[13px] font-semibold text-foreground">@{u.username}</span>
                      <Plus className="w-3.5 h-3.5 text-primary ml-auto" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {accounts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {accounts.map((a) => (
                  <span key={a.fid} className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-primary/8 border border-primary/20 text-[12px] font-semibold text-primary">
                    <span className="w-4 h-4 rounded-full overflow-hidden bg-primary/20 shrink-0">
                      {a.pfp_url && <img src={a.pfp_url} alt="" className="w-full h-full object-cover" />}
                    </span>
                    @{a.username}
                    <button onClick={() => removeAccount(a.fid)} className="text-primary/60 hover:text-primary">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5">
              <Hash className="w-3 h-3" /> Keywords
            </label>
            <p className="text-xs text-muted-foreground">Only show casts that mention at least one of these words, if you add any.</p>
            <div className="flex gap-2">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                placeholder="e.g. base, onchain, design…"
                className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={addKeyword}
                disabled={!keywordInput.trim()}
                className="px-3.5 py-2.5 rounded-xl bg-muted text-foreground border border-border/60 text-sm font-semibold hover:bg-accent transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {keywords.map((k) => (
                  <span key={k} className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-muted border border-border text-[12px] font-semibold text-foreground">
                    {k}
                    <button onClick={() => removeKeyword(k)} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5">
                <Award className="w-3 h-3" /> Min Neynar score
              </label>
              <span className="text-[12px] font-bold text-foreground tabular-nums">{minNeynarScore > 0 ? minNeynarScore : "Any"}</span>
            </div>
            <input
              type="range" min={0} max={99} step={1}
              value={minNeynarScore}
              onChange={(e) => setMinNeynarScore(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">Skips authors scored below this. 0 = no filter.</p>
          </div>

          <div className="space-y-2 rounded-xl border border-border px-3 py-2.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-foreground block">Min follower count</label>
            <input
              type="number" min={0}
              value={minFollowers || ""}
              onChange={(e) => setMinFollowers(Number(e.target.value) || 0)}
              placeholder="0 = no filter"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-border px-3 py-2.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3" /> Spam label
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {SPAM_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSpamLabel(opt.id)}
                  className={cn(
                    "py-2 rounded-lg border text-[11px] font-semibold transition-all",
                    spamLabel === opt.id ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Farcaster's real published spam label · updated weekly. Accounts with no label yet are kept either way.</p>
          </div>

          <div className="flex gap-2 pt-2">
            {existing && (
              <button
                onClick={handleDelete}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-500/30 text-rose-500 text-sm font-semibold hover:bg-rose-500/8 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {existing ? "Save changes" : "Create feed"}
            </button>
          </div>
          {!hasAnyFilter && name.trim().length > 0 && (
            <p className="text-[11px] text-amber-500 -mt-3">Pick at least one filter above (accounts, keywords, score, followers, or spam label).</p>
          )}
        </div>
      </div>
    </div>
  );
}
