import type { ReactNode } from "react";

import { Input } from "@acme/ui/input";

import type { RecentItem } from "~/lib/recent-searches";
import { ItemIcon } from "~/component/item-icon";

interface BaseListItem {
  id: number;
  name: string;
  icon: string | null;
}

export function SearchPageShell({
  title,
  description,
  query,
  onQueryChange,
  placeholder,
  inputClassName = "max-w-sm",
  children,
}: {
  title: string;
  description?: string;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  inputClassName?: string;
  children: ReactNode;
}) {
  return (
    <main className="container py-16">
      <h1
        className={
          description ? "mb-2 text-3xl font-bold" : "mb-6 text-3xl font-bold"
        }
      >
        {title}
      </h1>
      {description ? (
        <p className="text-muted-foreground mb-6 text-sm">{description}</p>
      ) : null}
      <div className="flex flex-col gap-4">
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className={inputClassName}
        />
        {children}
      </div>
    </main>
  );
}

export function ItemSearchResultList<T extends BaseListItem>({
  items,
  emptyMessage,
  renderLink,
  getMeta,
  getBadge,
}: {
  items: T[];
  emptyMessage: string;
  renderLink: (item: T, content: ReactNode) => ReactNode;
  getMeta?: (item: T) => string | null | undefined;
  getBadge?: (item: T) => ReactNode;
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col divide-y">
      {items.map((item) => (
        <li key={item.id}>
          {renderLink(
            item,
            <ItemListRowContent
              name={item.name}
              icon={item.icon}
              meta={getMeta?.(item)}
              badge={getBadge?.(item)}
            />,
          )}
        </li>
      ))}
    </ul>
  );
}

export function RecentItemList({
  recents,
  onRemove,
  renderLink,
  getBadge,
}: {
  recents: RecentItem[];
  onRemove: (id: number) => void;
  renderLink: (item: RecentItem, content: ReactNode) => ReactNode;
  getBadge?: (item: RecentItem) => ReactNode;
}) {
  if (recents.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No recent searches yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        Recent
      </p>
      <ul className="flex flex-col divide-y">
        {recents.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            {renderLink(
              item,
              <ItemListRowContent
                name={item.name}
                icon={item.icon}
                badge={getBadge?.(item)}
                className="flex-1"
              />,
            )}
            <button
              onClick={() => onRemove(item.id)}
              className="text-muted-foreground hover:text-foreground px-2 text-sm transition-colors"
              aria-label="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemListRowContent({
  name,
  icon,
  meta,
  badge,
  className,
}: {
  name: string;
  icon: string | null;
  meta?: string | null | undefined;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 transition-colors ${className ?? ""}`}
    >
      <ItemIcon icon={icon} name={name} size="md" />
      <span className="flex-1 font-medium">{name}</span>
      {meta ? (
        <span className="text-muted-foreground text-xs">{meta}</span>
      ) : null}
      {badge}
    </div>
  );
}
