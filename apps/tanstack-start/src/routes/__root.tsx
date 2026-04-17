/// <reference types="vite/client" />
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import * as React from "react";
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
import { ThemeProvider, ThemeScript, ThemeToggle } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";

import { authClient } from "~/auth/client";
import { StatusPage } from "~/component/status-page";
import {
  buildMetaTags,
  getAppName,
  getDefaultDescription,
} from "~/lib/metadata";
import appCss from "~/styles.css?url";

const APP_NAME = getAppName();
const APP_DESCRIPTION = getDefaultDescription();
const NAV_ITEMS = [
  { to: "/craft", label: "Craft" },
  { to: "/item", label: "Items" },
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
      { property: "og:site_name", content: APP_NAME },
      { name: "twitter:card", content: "summary_large_image" },
      ...buildMetaTags({
        title: APP_NAME,
        description: APP_DESCRIPTION,
      }),
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
  notFoundComponent: () => <StatusPage variant="not-found" />,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function NavigationProgress() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [isMounted, setIsMounted] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);
  const previousPathnameRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    if (!isMounted) return;

    if (previousPathnameRef.current === null) {
      previousPathnameRef.current = pathname;
      return;
    }

    if (previousPathnameRef.current === pathname) return;

    previousPathnameRef.current = pathname;
    setIsVisible(true);

    const timeoutId = window.setTimeout(() => {
      setIsVisible(false);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [isMounted, pathname]);

  if (!isMounted || !isVisible) return null;

  return (
    <div
      className="bg-primary pointer-events-none fixed top-0 left-0 z-[60] h-1 shadow-[0_0_12px_currentColor]"
      style={{ animation: "nav-progress 450ms ease-out forwards" }}
    />
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript />
          <HeadContent />
        </head>
        <body className="bg-background text-foreground min-h-screen font-sans antialiased">
          <NavigationProgress />
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <div className="flex-1 pt-20 pb-14">{children}</div>
            <footer className="bg-background/90 fixed right-0 bottom-0 left-0 z-40 border-t backdrop-blur">
              <div className="container flex justify-end py-4">
                <p className="text-muted-foreground text-sm">Made by kinsyu</p>
              </div>
            </footer>
          </div>
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
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [isSigningIn, setIsSigningIn] = React.useState(false);

  return (
    <header className="bg-background/90 fixed top-0 right-0 left-0 z-40 border-b backdrop-blur">
      <nav className="container flex flex-col gap-4 py-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-[0.2em] uppercase">
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
            <div className="flex items-center gap-3 rounded-full border px-2 py-2 lg:pr-3 lg:pl-2">
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
                <p className="truncate text-sm font-medium">
                  {session.user.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  Connected with Discord
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={isSigningOut}
                loadingText="Signing out..."
                onClick={async () => {
                  setIsSigningOut(true);
                  try {
                    await authClient.signOut();
                    await navigate({ href: "/", replace: true });
                  } finally {
                    setIsSigningOut(false);
                  }
                }}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              loading={isSigningIn}
              loadingText="Signing in..."
              onClick={async () => {
                setIsSigningIn(true);
                try {
                  const result = await authClient.signIn.social({
                    provider: "discord",
                    callbackURL: pathname,
                  });

                  if (!result.data?.url) {
                    throw new Error("No URL returned from signInSocial");
                  }

                  await navigate({ href: result.data.url, replace: true });
                } finally {
                  setIsSigningIn(false);
                }
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
