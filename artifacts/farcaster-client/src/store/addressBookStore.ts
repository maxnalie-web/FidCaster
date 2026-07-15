import { create } from "zustand";
import { isAddress } from "viem";

export interface Contact {
  id: string;
  label: string;
  address: `0x${string}`;
  emoji: string;
  addedAt: number;
}

const CONTACTS_KEY = "ab_contacts";
const EMOJIS = ["👤","🐱","🦊","🌟","🎯","🦄","🐸","🌈","🐼","🦁","🐉","🌺"];

function genId() { return `c_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function pickEmoji() { return EMOJIS[Math.floor(Math.random() * EMOJIS.length)]; }

function persist(contacts: Contact[]) {
  try { localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts)); } catch {}
}
function load(): Contact[] {
  try { const r = localStorage.getItem(CONTACTS_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}

interface AddressBookState {
  contacts: Contact[];
  hydrate: () => void;
  addContact: (label: string, address: `0x${string}`, emoji?: string) => void;
  updateContact: (id: string, label: string, emoji?: string) => void;
  removeContact: (id: string) => void;
  findByAddress: (address: string) => Contact | undefined;
}

export const useAddressBookStore = create<AddressBookState>((set, get) => ({
  contacts: [],

  hydrate: () => set({ contacts: load() }),

  addContact: (label, address, emoji) => {
    if (!isAddress(address)) throw new Error("Invalid address");
    const contact: Contact = { id: genId(), label: label.trim(), address, emoji: emoji ?? pickEmoji(), addedAt: Date.now() };
    const contacts = [...get().contacts, contact];
    persist(contacts);
    set({ contacts });
  },

  updateContact: (id, label, emoji) => {
    const contacts = get().contacts.map(c => c.id === id ? { ...c, label: label.trim(), ...(emoji ? { emoji } : {}) } : c);
    persist(contacts);
    set({ contacts });
  },

  removeContact: (id) => {
    const contacts = get().contacts.filter(c => c.id !== id);
    persist(contacts);
    set({ contacts });
  },

  findByAddress: (address) => get().contacts.find(c => c.address.toLowerCase() === address.toLowerCase()),
}));
