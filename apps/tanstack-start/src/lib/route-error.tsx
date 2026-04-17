import type { ErrorComponentProps } from "@tanstack/react-router";
import type { TRPCClientErrorLike } from "@trpc/client";
import { Link } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";

import { authClient } from "~/auth/client";
import { StatusPage } from "~/component/status-page";

type AppError = ErrorComponentProps["error"] | TRPCClientErrorLike<AppRouter>;

function getErrorCode(error: AppError) {
  if (
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    typeof error.data.code === "string"
  ) {
    return error.data.code;
  }

  return undefined;
}

export function RouteErrorBoundary({ error, reset }: ErrorComponentProps) {
  const code = getErrorCode(error);

  if (code === "UNAUTHORIZED") {
    return (
      <StatusPage
        variant="sign-in-required"
        actions={
          <Button
            onClick={async () => {
              await authClient.signIn.social({
                provider: "discord",
              });
            }}
          >
            Sign in with Discord
          </Button>
        }
      />
    );
  }

  if (code === "FORBIDDEN") {
    return <StatusPage variant="access-denied" />;
  }

  if (code === "NOT_FOUND") {
    return <StatusPage variant="not-found" />;
  }

  return (
    <StatusPage
      variant="server-error"
      actions={
        <>
          <Button onClick={() => reset()}>Try again</Button>
          <Button asChild variant="outline">
            <Link to="/">Back home</Link>
          </Button>
        </>
      }
    >
      {error instanceof Error && error.message ? (
        <p className="text-muted-foreground text-sm">{error.message}</p>
      ) : null}
    </StatusPage>
  );
}
