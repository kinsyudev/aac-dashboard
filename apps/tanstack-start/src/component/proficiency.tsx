import type { Proficiency } from "@acme/db/schema";

interface ProficiencyConfig {
  color: string;
  icon: string;
}

const CONFIG: Record<Proficiency, ProficiencyConfig> = {
  // Harvesting
  Husbandry: {
    icon: "🐄",
    color: "bg-green-500/15 text-green-700 dark:text-green-400",
  },
  Farming: {
    icon: "🌾",
    color: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
  },
  Fishing: {
    icon: "🎣",
    color: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  },
  Logging: {
    icon: "🪵",
    color: "bg-amber-800/15 text-amber-800 dark:text-amber-500",
  },
  Gathering: {
    icon: "🌿",
    color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  Mining: {
    icon: "⛏️",
    color: "bg-stone-500/15 text-stone-700 dark:text-stone-400",
  },
  // Crafting
  Alchemy: {
    icon: "⚗️",
    color: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  },
  Cooking: {
    icon: "🍳",
    color: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  },
  Handicrafts: {
    icon: "🧶",
    color: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  },
  Machining: {
    icon: "⚙️",
    color: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
  },
  Metalwork: {
    icon: "🔨",
    color: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  Printing: {
    icon: "📜",
    color: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  },
  Masonry: {
    icon: "🧱",
    color: "bg-stone-400/15 text-stone-600 dark:text-stone-400",
  },
  Tailoring: {
    icon: "🧵",
    color: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  },
  Leatherwork: {
    icon: "🧤",
    color: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  Weaponry: {
    icon: "⚔️",
    color: "bg-red-600/15 text-red-800 dark:text-red-400",
  },
  Carpentry: {
    icon: "🪚",
    color: "bg-yellow-600/15 text-yellow-800 dark:text-yellow-500",
  },
  // Special
  Construction: {
    icon: "🏗️",
    color: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  },
  Larceny: {
    icon: "🗡️",
    color: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
  },
  Commerce: {
    icon: "💰",
    color: "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400",
  },
  Artistry: {
    icon: "🎨",
    color: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  },
  Exploration: {
    icon: "🧭",
    color: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  },
};

export function ProficiencyBadge({
  proficiency,
  showIcon = true,
  suffix,
}: {
  proficiency: string | null | undefined;
  showIcon?: boolean;
  suffix?: string;
}) {
  if (!proficiency) return null;
  const cfg =
    proficiency in CONFIG ? CONFIG[proficiency as Proficiency] : undefined;
  const color = cfg?.color ?? "bg-muted text-muted-foreground";
  const icon = cfg?.icon;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${color}`}
    >
      {showIcon && icon && <span>{icon}</span>}
      {proficiency}
      {suffix && <span className="opacity-75">{suffix}</span>}
    </span>
  );
}
