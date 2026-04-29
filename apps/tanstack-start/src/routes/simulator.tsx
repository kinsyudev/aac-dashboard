import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/simulator")({
  loader: ({ context }) => {
    return context.queryClient.fetchQuery(
      context.trpc.auth.requireAdmin.queryOptions(),
    );
  },
  component: () => <Outlet />,
});
