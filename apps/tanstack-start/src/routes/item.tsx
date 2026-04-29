import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/item")({
  loader: ({ context }) => {
    return context.queryClient.fetchQuery(
      context.trpc.auth.requireMember.queryOptions(),
    );
  },
  component: () => <Outlet />,
});
