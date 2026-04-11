const SIZE_CLASS = {
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-16 w-16",
} as const;

export function ItemIcon({
  icon,
  name,
  size = "sm",
}: {
  icon: string | null;
  name: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  const cls = SIZE_CLASS[size];
  return icon ? (
    <img
      src={`https://aa-classic.com/game/icons/${icon}`}
      alt={name}
      className={`${cls} shrink-0`}
    />
  ) : (
    <div className={`bg-muted ${cls} shrink-0 rounded`} />
  );
}
