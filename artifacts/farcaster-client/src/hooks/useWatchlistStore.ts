import { useState, useCallback, useEffect } from "react";
import { loadWatchlists, saveWatchlists, newWatchlistId, type Watchlist, type WatchlistFilter } from "@/lib/watchlist";
import { useWallet } from "@/hooks/useWallet";

export interface WatchlistStore {
  lists: Watchlist[];
  createList: (name: string) => Watchlist;
  deleteList: (id: string) => void;
  renameList: (id: string, name: string) => void;
  setFilter: (id: string, filter: WatchlistFilter) => void;
  addFid: (id: string, fid: number) => void;
  removeFid: (id: string, fid: number) => void;
  toggleWatched: (fid: number) => void;
  isWatched: (fid: number) => boolean;
  watchedFids: () => number[];
  defaultListId: string | null;
}

let _subscribers: Array<() => void> = [];
let _lists: Watchlist[] = [];
let _activeFid: number | null = null;

function notifyAll(): void {
  for (const cb of _subscribers) cb();
}

function persist(): void {
  if (_activeFid != null) saveWatchlists(_activeFid, _lists);
}

export function useWatchlistStore(): WatchlistStore {
  const { fid } = useWallet();
  const myFid = fid ? Number(fid) : null;
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const cb = () => forceUpdate(v => v + 1);
    _subscribers.push(cb);
    return () => { _subscribers = _subscribers.filter(s => s !== cb); };
  }, []);

  useEffect(() => {
    if (myFid === _activeFid) return;
    _activeFid = myFid;
    if (myFid != null) {
      const loaded = loadWatchlists(myFid);
      _lists = loaded.length > 0
        ? loaded
        : [{ id: newWatchlistId(), name: "My Watchlist", fids: [], filter: {}, createdAt: Date.now() }];
    } else {
      _lists = [];
    }
    notifyAll();
  }, [myFid]);

  const createList = useCallback((name: string): Watchlist => {
    const list: Watchlist = { id: newWatchlistId(), name, fids: [], filter: {}, createdAt: Date.now() };
    _lists = [..._lists, list];
    persist(); notifyAll();
    return list;
  }, []);

  const deleteList = useCallback((id: string) => {
    _lists = _lists.filter(l => l.id !== id);
    persist(); notifyAll();
  }, []);

  const renameList = useCallback((id: string, name: string) => {
    _lists = _lists.map(l => l.id === id ? { ...l, name } : l);
    persist(); notifyAll();
  }, []);

  const setFilter = useCallback((id: string, filter: WatchlistFilter) => {
    _lists = _lists.map(l => l.id === id ? { ...l, filter } : l);
    persist(); notifyAll();
  }, []);

  const addFid = useCallback((id: string, fid: number) => {
    _lists = _lists.map(l => l.id === id && !l.fids.includes(fid) ? { ...l, fids: [...l.fids, fid] } : l);
    persist(); notifyAll();
  }, []);

  const removeFid = useCallback((id: string, fid: number) => {
    _lists = _lists.map(l => l.id === id ? { ...l, fids: l.fids.filter(f => f !== fid) } : l);
    persist(); notifyAll();
  }, []);

  const toggleWatched = useCallback((fid: number) => {
    const defaultList = _lists[0];
    if (!defaultList) return;
    if (defaultList.fids.includes(fid)) {
      _lists = _lists.map(l => l.id === defaultList.id ? { ...l, fids: l.fids.filter(f => f !== fid) } : l);
    } else {
      _lists = _lists.map(l => l.id === defaultList.id ? { ...l, fids: [...l.fids, fid] } : l);
    }
    persist(); notifyAll();
  }, []);

  const isWatched = useCallback((fid: number) => _lists.some(l => l.fids.includes(fid)), []);
  const watchedFids = useCallback(() => Array.from(new Set(_lists.flatMap(l => l.fids))), []);
  const defaultListId = _lists[0]?.id ?? null;

  return {
    lists: _lists,
    createList,
    deleteList,
    renameList,
    setFilter,
    addFid,
    removeFid,
    toggleWatched,
    isWatched,
    watchedFids,
    defaultListId,
  };
}
