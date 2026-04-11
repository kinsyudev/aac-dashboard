/// <reference types="vite/client" />
import { useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type * as React from "react";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import type { AppRouter } from "@acme/api";
import { ThemeProvider, ThemeToggle } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";

import appCss from "~/styles.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  trpc: TRPCOptionsProxy<AppRouter>;
}>()({
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      context.trpc.profile.getUserData.queryOptions(),
    );
  },
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function NavigationProgress() {
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });
  const hasBeenIdle = useRef(false);

  if (!isLoading) {
    hasBeenIdle.current = true;
  }

  if (!isLoading || !hasBeenIdle.current) return null;
  return (
    <div
      className="bg-primary fixed top-0 left-0 z-50 h-0.5"
      style={{ animation: "nav-progress 10s ease-out forwards" }}
    />
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body className="bg-background text-foreground min-h-screen font-sans antialiased">
          <NavigationProgress />
          <nav className="border-b px-6 py-3">
            <div className="container flex items-center gap-6">
              <Link to="/craft" className="text-sm font-medium hover:underline">
                Craft
              </Link>
              <Link to="/profile" className="text-sm font-medium hover:underline">
                Profile
              </Link>
            </div>
          </nav>
          {children}
          <div className="absolute right-4 bottom-12">
            <ThemeToggle />
          </div>
          <Toaster />
          <TanStackRouterDevtools position="bottom-right" />
          <Scripts />
        </body>
      </html>
    </ThemeProvider>
  );
}
