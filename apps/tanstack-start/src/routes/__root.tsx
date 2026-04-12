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
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import type { AppRouter } from "@acme/api";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { ThemeProvider, ThemeToggle } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";

import { authClient } from "~/auth/client";
import appCss from "~/styles.css?url";

const APP_NAME = "AAC Dashboard";
const APP_DESCRIPTION =
  "ArcheAge Classic crafting, simulation, shared shopping lists, and profile tools.";
const NAV_ITEMS = [
  { to: "/craft", label: "Craft" },
  { to: "/simulator", label: "Simulator" },
  { to: "/shoplists", label: "Shopping Lists" },
  { to: "/profile", label: "Profile" },
] as const;

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  trpc: TRPCOptionsProxy<AppRouter>;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: APP_DESCRIPTION },
      { property: "og:site_name", content: APP_NAME },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "https://aa-classic.com/favicon.ico" },
      { rel: "shortcut icon", href: "https://aa-classic.com/favicon.ico" },
    ],
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
          <SiteHeader />
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

function SiteHeader() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="bg-background/90 border-b backdrop-blur">
      <nav className="container flex flex-col gap-4 py-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex flex-col leading-none">
            <span className="text-sm font-semibold uppercase tracking-[0.2em]">
              AAC
            </span>
            <span className="text-muted-foreground text-xs">Dashboard</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.to || pathname.startsWith(`${item.to}/`);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "text-muted-foreground hover:text-foreground rounded-full px-3 py-2 text-sm font-medium transition-colors",
                    isActive && "bg-muted text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="lg:ml-auto">
          {session ? (
            <div className="flex items-center gap-3 rounded-full border px-2 py-2 lg:pl-2 lg:pr-3">
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt={session.user.name}
                  className="h-10 w-10 rounded-full border object-cover"
                />
              ) : (
                <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold">
                  {session.user.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.user.name}</p>
                <p className="text-muted-foreground text-xs">Connected with Discord</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await authClient.signOut();
                  await navigate({ href: "/", replace: true });
                }}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                const result = await authClient.signIn.social({
                  provider: "discord",
                  callbackURL: pathname,
                });

                if (!result.data?.url) {
                  throw new Error("No URL returned from signInSocial");
                }

                await navigate({ href: result.data.url, replace: true });
              }}
            >
              Sign in with Discord
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
