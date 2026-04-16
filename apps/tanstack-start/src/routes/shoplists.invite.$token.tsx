import type { inferProcedureOutput } from "@trpc/server";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { authClient } from "~/auth/client";
import { useTRPC } from "~/lib/trpc";

type AcceptInviteResult = inferProcedureOutput<
  AppRouter["shoppingLists"]["acceptInviteToken"]
>;

export const Route = createFileRoute("/shoplists/invite/$token")({
  component: InviteAcceptancePage,
});

function InviteAcceptancePage() {
  const { token } = Route.useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { data, isLoading } = useQuery(
    trpc.shoppingLists.getInvitePreview.queryOptions(token),
  );

  const acceptInvite = useMutation(
    trpc.shoppingLists.acceptInviteToken.mutationOptions({
      onSuccess: async (result: AcceptInviteResult) => {
        await Promise.all([
          queryClient.invalidateQueries(
            trpc.shoppingLists.listMineAndShared.pathFilter(),
          ),
          queryClient.invalidateQueries(
            trpc.shoppingLists.getInvitePreview.pathFilter(),
          ),
        ]);
        toast.success("Invite accepted.");
        await navigate({
          to: "/shoplists/$listId",
          params: { listId: result.listId },
        });
      },
      onError: () => toast.error("Failed to accept invite."),
    }),
  );

  return (
    <main className="container py-16">
      <div className="mx-auto flex max-w-xl flex-col gap-6 rounded-xl border p-8">
        <div>
          <h1 className="text-3xl font-bold">Shopping List Invite</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Accept a one-time invite to join a collaborative shopping list.
          </p>
        </div>

        {isLoading ? <p>Loading invite...</p> : null}

        {!isLoading && !data ? (
          <p className="text-sm">Invite not found.</p>
        ) : null}

        {data ? (
          <>
            <div className="rounded-lg border p-4">
              <p className="font-medium">{data.list.name}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Shared by {data.owner.name} with {data.role} access
              </p>
              <p className="text-muted-foreground mt-3 text-sm">
                Status: {data.isAvailable ? "available" : "unavailable"}
              </p>
            </div>

            {!session ? (
              <Button
                loading={isSigningIn}
                loadingText="Signing in..."
                onClick={async () => {
                  setIsSigningIn(true);
                  try {
                    const result = await authClient.signIn.social({
                      provider: "discord",
                      callbackURL: `/shoplists/invite/${token}`,
                    });
                    if (result.data?.url) {
                      await navigate({ href: result.data.url, replace: true });
                    }
                  } finally {
                    setIsSigningIn(false);
                  }
                }}
              >
                Sign in with Discord
              </Button>
            ) : (
              <Button
                disabled={!data.isAvailable}
                loading={acceptInvite.isPending}
                loadingText="Accepting..."
                onClick={() => acceptInvite.mutate(token)}
              >
                Accept invite
              </Button>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
