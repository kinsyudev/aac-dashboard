import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/craft")({
  loader: ({ context }) => {
    return context.queryClient.fetchQuery(
      context.trpc.auth.requireMember.queryOptions(),
    );
  },
  component: () => <Outlet />,
});
