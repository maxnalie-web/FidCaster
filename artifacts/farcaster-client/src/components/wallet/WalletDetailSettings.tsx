import React, { useRef, useState } from "react";
import {
  KeyRound, FileKey, Eye, Pencil, Plus, ShieldCheck, Trash2,
  Copy, CheckCircle2,
} from "lucide-react";
import { TokenApprovalsSheet } from "@/components/wallet/TokenApprovalsSheet";
import { PinGate } from "@/components/wallet/PinGate";
import { useWalletStore, type WalletKind } from "@/store/walletStore";
import { WalletAvatar } from "./WalletAvatar";

function kindLabel(kind: WalletKind): string {
  if (kind === "seed") return "Recovery phrase wallet";
  if (kind === "private-key") return "Private key wallet";
  return "Watch-only wallet";
}

interface Props {
  walletId: string;
  onBack: () => void;
}

const MASKED = "•".repeat(40);

export function WalletDetailSettings({ walletId, onBack }: Props) {
  const wallet = useWalletStore(s => s.wallets.find(w => w.id === walletId));
  const activeWalletId = useWalletStore(s => s.activeWalletId);
  const activeAccountIndex = useWalletStore(s => s.activeAccountIndex);
  const setActiveWallet = useWalletStore(s => s.setActiveWallet);
  const renameWallet = useWalletStore(s => s.renameWallet);
  const revealMnemonic = useWalletStore(s => s.revealMnemonic);
  const revealPrivateKey = useWalletStore(s => s.revealPrivateKey);
  const removeWallet = useWalletStore(s => s.removeWallet);
  const addAccountToWallet = useWalletStore(s => s.addAccountToWallet);
  const removeAccountFromWallet = useWalletStore(s => s.removeAccountFromWallet);

  const renameAccount = useWalletStore(s => s.renameAccount);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ wallet: true } | { wallet: false; accountIndex: number } | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);

  const [revealLoading, setRevealLoading] = useState<"mnemonic" | "key" | null>(null);
  const [reveal, setReveal] = useState<{ kind: "mnemonic" | "key"; value: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const clipRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [removeAccountConfirm, setRemoveAccountConfirm] = useState<number | null>(null);
  const [showApprovals, setShowApprovals] = useState(false);

  // Gate revealing a seed phrase / private key behind a local PIN - there
  // was previously no authentication at all on this path, just a blur +
  // "tap to reveal". See lib/walletPin.ts.
  const [pinGateFor, setPinGateFor] = useState<"mnemonic" | "key" | null>(null);

  // Which account within this wallet secrets/approvals apply to. Defaults to
  // whichever account is actually active if this is the active wallet -
  // previously this was hardcoded to account 0, silently revealing/scanning
  // the wrong account's key whenever a different account was selected.
  const [revealAccountIndex, setRevealAccountIndex] = useState<number | null>(null);

  if (!wallet) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Wallet not found</div>
      </div>
    );
  }

  const isRemoveDisabled = wallet.sourceFid !== undefined;

  // Effective account for reveal-key / approvals: whichever one the user
  // explicitly picked (revealAccountIndex), else the active account if this
  // wallet is the active wallet, else the first account.
  const effectiveAccountIndex =
    revealAccountIndex ??
    (wallet.id === activeWalletId ? activeAccountIndex : 0);
  const effectiveAccount =
    wallet.accounts.find(a => a.index === effectiveAccountIndex) ?? wallet.accounts[0];

  const onAddAccount = async () => {
    if (addingAccount) return;
    setAddingAccount(true);
    try { await addAccountToWallet(wallet.id); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed to add account."); }
    finally { setAddingAccount(false); }
  };

  const doRevealMnemonic = async () => {
    setRevealLoading("mnemonic");
    try { setReveal({ kind: "mnemonic", value: await revealMnemonic(wallet.id) }); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed to reveal."); }
    finally { setRevealLoading(null); }
  };

  const doRevealKey = async () => {
    setRevealLoading("key");
    try { setReveal({ kind: "key", value: await revealPrivateKey(wallet.id, effectiveAccount.index) }); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed to reveal."); }
    finally { setRevealLoading(null); }
  };

  const onPinConfirmed = () => {
    const kind = pinGateFor;
    setPinGateFor(null);
    if (kind === "mnemonic") doRevealMnemonic();
    else if (kind === "key") doRevealKey();
  };

  const closeReveal = () => {
    if (clipRef.current) { clearTimeout(clipRef.current); clipRef.current = null; }
    setReveal(null); setShowSecret(false); setCopied(false);
  };

  const onCopy = async () => {
    if (!reveal || !showSecret) return;
    await navigator.clipboard.writeText(reveal.value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (clipRef.current) clearTimeout(clipRef.current);
    clipRef.current = setTimeout(async () => {
      try { const cur = await navigator.clipboard.readText(); if (cur === reveal.value) await navigator.clipboard.writeText(""); } catch {}
      clipRef.current = null;
    }, 60000);
  };

  const doRemove = async () => {
    try { await removeWallet(wallet.id); onBack(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed to remove."); setRemoveConfirm(false); }
  };

  const doRemoveAccount = () => {
    if (removeAccountConfirm === null) return;
    try { removeAccountFromWallet(wallet.id, removeAccountConfirm); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed to remove account."); }
    finally { setRemoveAccountConfirm(null); }
  };

  const revealWords = reveal?.kind === "mnemonic" ? reveal.value.split(" ") : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back</button>
        <span className="text-base font-bold text-foreground truncate">{wallet.label}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
        {/* Identity card */}
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-card border border-border">
          <WalletAvatar label={wallet.label} color={wallet.color} seed={wallet.accounts[0]?.address} size={48} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground truncate">{wallet.label}</div>
            <div className="text-xs text-muted-foreground">{kindLabel(wallet.kind)}</div>
          </div>
        </div>

        {/* General */}
        <Section label="General">
          <Row icon={<Pencil size={15} className="text-primary" />} iconColor="#6366f1" title="Rename Wallet" desc="Change display name" onClick={() => { setRenameText(wallet.label); setRenameTarget({ wallet: true }); setRenameOpen(true); }} />
        </Section>

        {/* Accounts (seed only) */}
        {wallet.kind === "seed" && (
          <Section label="Accounts">
            {wallet.accounts.map((account, i) => {
              const isActive = wallet.id === activeWalletId && account.index === activeAccountIndex;
              return (
                <div key={account.index} className={`flex items-center ${i > 0 ? "border-t border-border/50" : ""}`}>
                  <button
                    className="flex-1 flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors min-w-0"
                    onClick={() => setActiveWallet(wallet.id, account.index)}
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#6366f120" }}>
                      {isActive ? <CheckCircle2 size={15} className="text-primary" /> : <KeyRound size={15} className="text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{account.label}</div>
                      <div className="text-xs text-muted-foreground">{account.address.slice(0, 8)}…{account.address.slice(-6)}{isActive ? " · Active" : ""}</div>
                    </div>
                  </button>
                  <button
                    className="px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setRenameText(account.label); setRenameTarget({ wallet: false, accountIndex: account.index }); setRenameOpen(true); }}
                  >
                    <Pencil size={13} />
                  </button>
                  {wallet.accounts.length > 1 && (
                    <button
                      className="px-3 py-2 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => setRemoveAccountConfirm(account.index)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            <Row
              divider
              icon={addingAccount ? <span className="text-primary text-xs animate-spin">⟳</span> : <Plus size={15} className="text-primary" />}
              iconColor="#6366f1"
              title="Add Account"
              desc="Derive another account from this seed"
              onClick={onAddAccount}
            />
          </Section>
        )}

        {/* Security */}
        <Section label="Security">
          {wallet.kind === "seed" && wallet.accounts.length > 1 && (
            <div className="px-4 py-3 border-b border-border/50">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">
                Applies to account:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {wallet.accounts.map(acc => (
                  <button
                    key={acc.index}
                    onClick={() => setRevealAccountIndex(acc.index)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                      effectiveAccountIndex === acc.index
                        ? "bg-primary text-white border-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {acc.label || `Account ${acc.index + 1}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {wallet.kind === "seed" && (
            <Row
              icon={revealLoading === "mnemonic" ? <span className="text-green-500 text-xs animate-spin">⟳</span> : <KeyRound size={15} className="text-green-500" />}
              iconColor="#10b981"
              title="Reveal Recovery Phrase"
              desc="View your 12-word backup"
              onClick={() => setPinGateFor("mnemonic")}
            />
          )}
          {wallet.kind !== "watch-only" && (
            <Row
              divider={wallet.kind === "seed"}
              icon={revealLoading === "key" ? <span className="text-green-500 text-xs animate-spin">⟳</span> : <FileKey size={15} className="text-green-500" />}
              iconColor="#10b981"
              title="Reveal Private Key"
              desc={wallet.accounts.length > 1 ? `View raw key for ${effectiveAccount.label || `Account ${effectiveAccount.index + 1}`}` : "View raw private key hex"}
              onClick={() => setPinGateFor("key")}
            />
          )}
          <Row
            divider={wallet.kind !== "watch-only"}
            icon={<ShieldCheck size={15} className="text-green-500" />}
            iconColor="#10b981"
            title="Token Approvals"
            desc={wallet.accounts.length > 1 ? `For ${effectiveAccount.label || `Account ${effectiveAccount.index + 1}`}` : "Review & revoke spending permissions"}
            onClick={() => setShowApprovals(true)}
          />
        </Section>

        {/* Danger */}
        <Section label="Danger Zone">
          <Row
            icon={<Trash2 size={15} className={isRemoveDisabled ? "text-muted-foreground" : "text-destructive"} />}
            iconColor={isRemoveDisabled ? "#6b7280" : "#ef4444"}
            title="Remove Wallet"
            desc={isRemoveDisabled ? "Linked to Farcaster account - sign out to remove" : "Delete from this device"}
            onClick={() => !isRemoveDisabled && setRemoveConfirm(true)}
            disabled={isRemoveDisabled}
            destructive={!isRemoveDisabled}
          />
        </Section>
      </div>

      {/* Rename modal */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6 py-8 overflow-y-auto" onClick={() => setRenameOpen(false)}>
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm space-y-4 max-h-full overflow-y-auto my-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-foreground">
              {renameTarget?.wallet === true ? "Rename Wallet" : "Rename Account"}
            </h3>
            <input
              autoFocus
              className="w-full bg-muted/40 border border-border rounded-xl px-3 py-3 text-sm text-foreground outline-none"
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && renameText.trim()) {
                  if (renameTarget?.wallet === true) renameWallet(wallet.id, renameText.trim());
                  else if (renameTarget?.wallet === false) renameAccount(wallet.id, renameTarget.accountIndex, renameText.trim());
                  setRenameOpen(false);
                }
              }}
            />
            <div className="flex gap-2">
              <button className="flex-1 py-3 rounded-xl border border-border text-sm font-bold text-muted-foreground" onClick={() => setRenameOpen(false)}>Cancel</button>
              <button
                className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-40"
                disabled={!renameText.trim()}
                onClick={() => {
                  if (renameTarget?.wallet === true) renameWallet(wallet.id, renameText.trim());
                  else if (renameTarget?.wallet === false) renameAccount(wallet.id, renameTarget.accountIndex, renameText.trim());
                  setRenameOpen(false);
                }}
              >Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Reveal modal */}
      {reveal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-5 py-8 overflow-y-auto" onClick={closeReveal}>
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm space-y-4 max-h-full overflow-y-auto my-auto" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-foreground">{reveal.kind === "mnemonic" ? "Recovery Phrase" : "Private Key"}</h3>
              {reveal.kind === "key" && wallet.accounts.length > 1 && (
                <p className="text-xs font-mono text-muted-foreground mt-0.5">
                  {effectiveAccount.label || `Account ${effectiveAccount.index + 1}`} · {effectiveAccount.address.slice(0, 8)}…{effectiveAccount.address.slice(-6)}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Never share this. Anyone with it controls your funds.</p>
            </div>

            <div className="relative">
              {reveal.kind === "mnemonic" ? (
                <div className={`grid grid-cols-3 gap-1.5 p-3 rounded-xl bg-muted/40 border border-border ${!showSecret ? "blur-sm" : ""}`}>
                  {(showSecret ? revealWords : Array.from({ length: 12 })).map((w, i) => (
                    <div key={i} className="flex items-center gap-1 bg-background rounded-lg px-2 py-1.5">
                      <span className="text-[9px] text-muted-foreground w-3 font-mono">{i + 1}.</span>
                      <span className="text-[11px] font-semibold text-foreground">{showSecret ? (w as string) : "••••"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`p-3 rounded-xl bg-muted/40 border border-border ${!showSecret ? "blur-sm" : ""}`}>
                  <p className="text-xs font-mono text-foreground break-all leading-relaxed">{showSecret ? reveal.value : MASKED}</p>
                </div>
              )}
              {!showSecret && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={() => setShowSecret(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-semibold"
                  >
                    <Eye size={14} /> Tap to reveal
                  </button>
                </div>
              )}
            </div>

            <button
              disabled={!showSecret}
              onClick={onCopy}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition-all ${showSecret ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : "border-border text-muted-foreground opacity-40"}`}
            >
              {copied ? <CheckCircle2 size={15} className="text-green-500" /> : <Copy size={15} />}
              {copied ? "Copied!" : showSecret ? "Copy" : "Reveal to copy"}
            </button>
            <button onClick={closeReveal} className="w-full py-3 rounded-xl bg-primary text-white text-sm font-bold">Done</button>
          </div>
        </div>
      )}

      {/* Token Approvals overlay */}
      {showApprovals && effectiveAccount?.address && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end" onClick={() => setShowApprovals(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-background rounded-t-[28px] max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border/70 rounded-full mx-auto mt-3 mb-0 shrink-0" />
            <TokenApprovalsSheet
              address={effectiveAccount.address as `0x${string}`}
              walletColor="#10b981"
              onClose={() => setShowApprovals(false)}
            />
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {removeConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-6" onClick={() => setRemoveConfirm(false)}>
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-destructive">Remove Wallet?</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Make sure you've backed up your recovery phrase or private key - this cannot be undone.
            </p>
            <div className="flex gap-2">
              <button className="flex-1 py-3 rounded-xl border border-border text-sm font-bold text-muted-foreground" onClick={() => setRemoveConfirm(false)}>Cancel</button>
              <button className="flex-1 py-3 rounded-xl bg-destructive text-white text-sm font-bold" onClick={doRemove}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Remove account confirm */}
      {removeAccountConfirm !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-6" onClick={() => setRemoveAccountConfirm(null)}>
          <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-destructive">Remove Account?</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This removes {wallet.accounts.find(a => a.index === removeAccountConfirm)?.label || `Account ${removeAccountConfirm + 1}`} from this wallet. Make sure you've backed up its private key if it holds funds - this cannot be undone.
            </p>
            <div className="flex gap-2">
              <button className="flex-1 py-3 rounded-xl border border-border text-sm font-bold text-muted-foreground" onClick={() => setRemoveAccountConfirm(null)}>Cancel</button>
              <button className="flex-1 py-3 rounded-xl bg-destructive text-white text-sm font-bold" onClick={doRemoveAccount}>Remove</button>
            </div>
          </div>
        </div>
      )}

      <PinGate
        open={pinGateFor !== null}
        title={pinGateFor === "mnemonic" ? "Required to view your recovery phrase." : "Required to view your private key."}
        onSuccess={onPinConfirmed}
        onCancel={() => setPinGateFor(null)}
      />
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">{label}</p>
      <div className="rounded-2xl bg-card border border-border overflow-hidden divide-y divide-border/50">
        {children}
      </div>
    </div>
  );
}

function Row({
  icon, iconColor, title, desc, onClick, divider, disabled, destructive, rightIcon
}: {
  icon: React.ReactNode; iconColor: string; title: string; desc: string;
  onClick: () => void; divider?: boolean; disabled?: boolean; destructive?: boolean;
  rightIcon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors disabled:opacity-50 ${disabled ? "" : "hover:bg-muted/30"}`}
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${iconColor}20` }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${destructive ? "text-destructive" : "text-foreground"}`}>{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      {rightIcon && <div className="shrink-0">{rightIcon}</div>}
    </button>
  );
}
