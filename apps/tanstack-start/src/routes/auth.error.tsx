import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { Button } from "@acme/ui/button";

import { StatusPage } from "~/component/status-page";

const searchSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
});

export const Route = createFileRoute("/auth/error")({
  validateSearch: searchSchema,
  component: AuthErrorPage,
});

function AuthErrorPage() {
  const { error, message } = Route.useSearch();
  const errorCode = error?.toUpperCase();
  const isUnauthorized =
    errorCode === "UNAUTHORIZED" || (errorCode?.includes("SIGN_IN") ?? false);
  const isForbidden =
    errorCode === "FORBIDDEN" ||
    (errorCode?.includes("NOT_ALLOWED") ?? false) ||
    (errorCode?.includes("ACCESS") ?? false);

  if (isUnauthorized) {
    return (
      <StatusPage variant="sign-in-required">
        {message ? (
          <p className="text-muted-foreground text-sm">{message}</p>
        ) : null}
      </StatusPage>
    );
  }

  if (isForbidden) {
    return (
      <StatusPage
        variant="access-denied"
        actions={
          <>
            <Button asChild>
              <Link to="/">Back home</Link>
            </Button>
          </>
        }
      >
        {message ? (
          <p className="text-muted-foreground text-sm">{message}</p>
        ) : null}
      </StatusPage>
    );
  }

  return (
    <StatusPage
      variant="server-error"
      actions={
        <>
          <Button asChild>
            <Link to="/">Back home</Link>
          </Button>
        </>
      }
    >
      {message ? (
        <p className="text-muted-foreground text-sm">{message}</p>
      ) : null}
    </StatusPage>
  );
}
