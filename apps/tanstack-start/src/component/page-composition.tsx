import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "@acme/ui";

type PageLayout = "normal" | "wide" | "narrow" | "landing";

const layoutClasses: Record<PageLayout, string> = {
  normal: "max-w-6xl",
  wide: "max-w-[1600px]",
  narrow: "max-w-2xl",
  landing: "max-w-5xl",
};

export function PageShell({
  layout = "normal",
  className,
  children,
}: {
  layout?: PageLayout;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      data-layout={layout}
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8",
        layoutClasses[layout],
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeading({
  title,
  subtitle,
  identity,
  badges,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  identity?: ReactNode;
  badges?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-w-0 flex-col gap-4", className)}>
      {back ? <div className="text-sm">{back}</div> : null}
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {identity ? <div className="shrink-0">{identity}</div> : null}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-3xl font-bold tracking-tight text-pretty">
                {title}
              </h1>
              {badges}
            </div>
            {subtitle ? (
              <p className="text-muted-foreground mt-1 max-w-3xl text-sm text-pretty">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-4 border-t pt-6", className)}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
