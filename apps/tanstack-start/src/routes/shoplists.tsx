import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shoplists")({
  component: ShoplistsLayout,
});

function ShoplistsLayout() {
  return <Outlet />;
}
