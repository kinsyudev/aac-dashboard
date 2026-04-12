import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/shoplists")({
  component: ShoplistsLayout,
});

function ShoplistsLayout() {
  return <Outlet />;
}
