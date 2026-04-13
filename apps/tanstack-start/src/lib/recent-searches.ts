import { useState } from "react";

const MAX_RECENT = 10;

export interface RecentItem {
  id: number;
  name: string;
  icon: string | null;
  labor: number | null;
}

function readStorage(storageKey: string): RecentItem[] {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? (JSON.parse(stored) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(storageKey: string, items: RecentItem[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function useRecentSearches(storageKey = "craft:recent-searches") {
  const [recents, setRecents] = useState<RecentItem[]>(() =>
    readStorage(storageKey),
  );

  const add = (item: RecentItem) => {
    setRecents((prev) => {
      const next = [item, ...prev.filter((i) => i.id !== item.id)].slice(
        0,
        MAX_RECENT,
      );
      writeStorage(storageKey, next);
      return next;
    });
  };

  const remove = (id: number) => {
    setRecents((prev) => {
      const next = prev.filter((i) => i.id !== id);
      writeStorage(storageKey, next);
      return next;
    });
  };

  return { recents, add, remove };
}
