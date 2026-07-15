import React, { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Copy, CheckCircle2 } from "lucide-react";
import { isAddress } from "viem";
import { useAddressBookStore, type Contact } from "@/store/addressBookStore";

const EMOJIS = ["👤","🐱","🦊","🌟","🎯","🦄","🐸","🌈","🐼","🦁","🐉","🌺","🎨","🏔️","🌊","🔮","⚡","🍀"];

interface Props {
  onSelectAddress?: (addr: string, label: string) => void;
  onClose: () => void;
}

export function AddressBookSheet({ onSelectAddress, onClose }: Props) {
  const { contacts, hydrate, addContact, updateContact, removeContact } = useAddressBookStore();
  useEffect(() => { hydrate(); }, [hydrate]);

  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");
  const [emoji, setEmoji] = useState("👤");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function startEdit(c: Contact) {
    setEditId(c.id);
    setLabel(c.label);
    setAddr(c.address);
    setEmoji(c.emoji);
    setError(null);
    setMode("edit");
  }

  function startAdd() {
    setEditId(null);
    setLabel("");
    setAddr("");
    setEmoji("👤");
    setError(null);
    setMode("add");
  }

  function onSave() {
    setError(null);
    if (!label.trim()) { setError("Enter a name"); return; }
    if (!isAddress(addr.trim())) { setError("Enter a valid 0x address"); return; }
    try {
      if (mode === "add") addContact(label.trim(), addr.trim() as `0x${string}`, emoji);
      else if (editId) updateContact(editId, label.trim(), emoji);
      setMode("list");
    } catch (e) { setError((e as Error).message); }
  }

  function onCopy(a: string) {
    navigator.clipboard.writeText(a).catch(() => {});
    setCopied(a);
    setTimeout(() => setCopied(c => c === a ? null : c), 2000);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        {mode !== "list"
          ? <button onClick={() => setMode("list")} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
          : <span className="text-base font-bold text-foreground">Address Book</span>}
        {mode === "list" && <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={20} /></button>}
        {mode === "list" && (
          <button onClick={startAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-bold">
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {mode === "list" && (
          <>
            {contacts.length === 0 && (
              <div className="py-14 text-center">
                <p className="text-3xl mb-3">📒</p>
                <p className="text-sm font-bold text-foreground">No saved contacts</p>
                <p className="text-xs text-muted-foreground mt-1">Add addresses to send quickly</p>
                <button onClick={startAdd} className="mt-4 px-5 py-2.5 rounded-2xl bg-primary text-white text-sm font-bold">Add Contact</button>
              </div>
            )}
            <div className="space-y-2 mt-1">
              {contacts.map(c => (
                <div key={c.id} className="flex items-center gap-3 p-3.5 rounded-2xl bg-card border border-border/40">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xl flex-shrink-0">{c.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{c.label}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{c.address.slice(0,8)}…{c.address.slice(-6)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {onSelectAddress && (
                      <button onClick={() => { onSelectAddress(c.address, c.label); onClose(); }}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors">
                        Use
                      </button>
                    )}
                    <button onClick={() => onCopy(c.address)} className="p-1.5 text-muted-foreground hover:text-foreground">
                      {copied === c.address ? <CheckCircle2 size={15} className="text-green-500" /> : <Copy size={15} />}
                    </button>
                    <button onClick={() => startEdit(c)} className="p-1.5 text-muted-foreground hover:text-foreground">
                      <Pencil size={15} />
                    </button>
                    {deleteConfirm === c.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => { removeContact(c.id); setDeleteConfirm(null); }} className="px-2 py-1 rounded-lg bg-destructive text-white text-[10px] font-bold">Yes</button>
                        <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 rounded-lg bg-muted text-[10px] font-bold">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(c.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {(mode === "add" || mode === "edit") && (
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Emoji</label>
              <div className="flex flex-wrap gap-2">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setEmoji(e)}
                    className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all ${emoji === e ? "bg-primary/20 ring-2 ring-primary scale-110" : "bg-muted/40 hover:bg-muted/80"}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Name</label>
              <input
                className="w-full bg-muted/40 border border-border rounded-xl px-3 py-3 text-sm text-foreground outline-none focus:border-primary/50"
                placeholder="e.g. Alice"
                value={label}
                onChange={e => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Address</label>
              <input
                className="w-full bg-muted/40 border border-border rounded-xl px-3 py-3 text-sm font-mono text-foreground outline-none focus:border-primary/50"
                placeholder="0x..."
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={addr}
                onChange={e => setAddr(e.target.value)}
                disabled={mode === "edit"}
              />
            </div>
            {error && <p className="text-xs text-destructive font-semibold">{error}</p>}
            <button onClick={onSave} className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-sm">
              {mode === "add" ? "Save Contact" : "Update Contact"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
