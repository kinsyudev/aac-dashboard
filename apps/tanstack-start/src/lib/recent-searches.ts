import { useState } from "react";

const STORAGE_KEY = "craft:recent-searches";
const MAX_RECENT = 10;

export type RecentItem = {
  id: number;
  name: string;
  icon: string | null;
  labor: number | null;
};

function readStorage(): RecentItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(items: RecentItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function useRecentSearches() {
  const [recents, setRecents] = useState<RecentItem[]>(readStorage);

  const add = (item: RecentItem) => {
    setRecents((prev) => {
      const next = [item, ...prev.filter((i) => i.id !== item.id)].slice(
        0,
        MAX_RECENT,
      );
      writeStorage(next);
      return next;
    });
  };

  const remove = (id: number) => {
    setRecents((prev) => {
      const next = prev.filter((i) => i.id !== id);
      writeStorage(next);
      return next;
    });
  };

  return { recents, add, remove };
}
