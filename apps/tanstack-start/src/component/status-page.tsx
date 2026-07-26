import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Button } from "@acme/ui/button";

import { InlineState } from "~/component/inline-state";
import { PageHeading, PageShell } from "~/component/page-composition";

type StatusPageVariant =
  | "not-found"
  | "server-error"
  | "sign-in-required"
  | "access-denied";

const STATUS_CONTENT = {
  "not-found": {
    eyebrow: "404",
    title: "Page not found",
    description:
      "The page or resource you requested does not exist, or it is no longer available.",
  },
  "server-error": {
    eyebrow: "500",
    title: "Something went wrong",
    description:
      "The page failed to load because the server returned an unexpected error.",
  },
  "sign-in-required": {
    eyebrow: "401",
    title: "Sign in required",
    description:
      "You need to sign in with Discord before you can view this page.",
  },
  "access-denied": {
    eyebrow: "403",
    title: "Access denied",
    description:
      "Your account does not have permission to view this page or resource.",
  },
} satisfies Record<
  StatusPageVariant,
  {
    eyebrow: string;
    title: string;
    description: string;
  }
>;

export function StatusPage({
  actions,
  children,
  variant,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  variant: StatusPageVariant;
}) {
  const content = STATUS_CONTENT[variant];

  return (
    <PageShell layout="narrow">
      <p className="text-primary text-xs font-semibold tracking-[0.24em] uppercase">
        {content.eyebrow}
      </p>
      <PageHeading title={content.title} subtitle={content.description} />
      {children ? (
        <InlineState kind="unavailable">{children}</InlineState>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {actions ?? (
          <>
            <Button asChild>
              <Link to="/">Back home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/shoplists">Open shopping lists</Link>
            </Button>
          </>
        )}
      </div>
    </PageShell>
  );
}
