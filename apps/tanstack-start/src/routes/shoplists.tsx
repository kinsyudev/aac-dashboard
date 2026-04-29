import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/shoplists")({
  loader: ({ context }) => {
    return context.queryClient.fetchQuery(
      context.trpc.auth.requireMember.queryOptions(),
    );
  },
  component: ShoplistsLayout,
});

function ShoplistsLayout() {
  return <Outlet />;
}
