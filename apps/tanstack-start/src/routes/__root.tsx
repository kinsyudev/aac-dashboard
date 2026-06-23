/// <reference types="vite/client" />
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { ThemeProvider, ThemeScript, ThemeToggle } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";

import { authClient } from "~/auth/client";
import { StatusPage } from "~/component/status-page";
import {
  buildMetaTags,
  getAppName,
  getDefaultDescription,
} from "~/lib/metadata";
import { useTRPC } from "~/lib/trpc";
import appCss from "~/styles.css?url";

const APP_NAME = getAppName();
const APP_DESCRIPTION = getDefaultDescription();
const NAV_ITEMS = [
  { to: "/craft", label: "Craft", access: "member" },
  { to: "/item", label: "Items", access: "member" },
  { to: "/trade-packs", label: "Trade Packs", access: "member" },
  { to: "/costume-planner", label: "Costume Planner", access: "member" },
  { to: "/simulator", label: "Simulator", access: "admin" },
  { to: "/shoplists", label: "Shopping Lists", access: "member" },
  { to: "/profile", label: "Profile", access: "member" },
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
  loader: async ({ context }) => {
    const viewer = await context.queryClient.fetchQuery(
      context.trpc.auth.getViewer.queryOptions(),
    );
    // eslint-disable-next-line no-restricted-properties
    const isDevelopment = process.env.NODE_ENV === "development";

    if (viewer.canAccessMember) {
      void context.queryClient.prefetchQuery(
        context.trpc.profile.getUserData.queryOptions(),
      );
    }

    return {
      isDevelopment,
    };
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
  const { isDevelopment } = Route.useLoaderData();
  const { data: realSession } = authClient.useSession();
  const trpc = useTRPC();
  const { data: viewer } = useQuery(trpc.auth.getViewer.queryOptions());
  const { data: effectiveSession } = useQuery(
    trpc.auth.getSession.queryOptions(),
  );
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.access === "admin") {
      return viewer?.canAccessAdmin ?? false;
    }

    return viewer?.canAccessMember ?? false;
  });
  let accessLabel = "Connected with Discord";

  if (viewer?.isBypass) {
    accessLabel = "Allowlisted access";
  } else if (viewer?.effectiveRole === "admin") {
    accessLabel = "Admin access";
  } else if (viewer?.effectiveRole === "member") {
    accessLabel = "Member access";
  }
  const displaySession = effectiveSession ?? realSession;

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
            {visibleNavItems.map((item) => {
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
          {realSession ? (
            <div className="flex items-center gap-3 rounded-full border px-2 py-2 lg:pr-3 lg:pl-2">
              {displaySession?.user.image ? (
                <img
                  src={displaySession.user.image}
                  alt={displaySession.user.name}
                  className="h-10 w-10 rounded-full border object-cover"
                />
              ) : (
                <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold">
                  {displaySession?.user.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {displaySession?.user.name}
                </p>
                <p className="text-muted-foreground text-xs">{accessLabel}</p>
                {viewer?.isImpersonating ? (
                  <p className="text-muted-foreground text-xs">
                    Impersonating in development
                  </p>
                ) : null}
              </div>
              {isDevelopment ? (
                <DevImpersonationMenu
                  actorUserId={realSession.user.id}
                  currentUserId={displaySession?.user.id ?? realSession.user.id}
                  isImpersonating={viewer?.isImpersonating ?? false}
                />
              ) : null}
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

interface DevImpersonationResponse {
  actorUserId: string;
  currentImpersonatedUserId: string | null;
  users: {
    id: string;
    name: string;
    image: string | null;
    role: "member" | "admin" | null;
    discordAccountId: string | null;
  }[];
}

function DevImpersonationMenu({
  actorUserId,
  currentUserId,
  isImpersonating,
}: {
  actorUserId: string;
  currentUserId: string;
  isImpersonating: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<DevImpersonationResponse>({
    queryKey: ["dev-impersonation-users"],
    queryFn: async () => {
      const response = await fetch("/api/dev/impersonation", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load impersonation users");
      }

      return (await response.json()) as DevImpersonationResponse;
    },
    staleTime: 30_000,
  });

  const switchUser = async (userId: string) => {
    if (userId === actorUserId) {
      await clearImpersonation();
      return;
    }

    await fetch("/api/dev/impersonation", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId }),
    });
    await queryClient.invalidateQueries({
      queryKey: ["dev-impersonation-users"],
    });
    window.location.reload();
  };

  const clearImpersonation = async () => {
    await fetch("/api/dev/impersonation", {
      method: "DELETE",
      credentials: "include",
    });
    await queryClient.invalidateQueries({
      queryKey: ["dev-impersonation-users"],
    });
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {isImpersonating ? "Impersonating" : "Impersonate"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Development only</DropdownMenuLabel>
        <DropdownMenuLabel className="text-muted-foreground font-normal">
          Switch the effective server user for local testing.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isImpersonating ? (
          <DropdownMenuItem onSelect={() => void clearImpersonation()}>
            Stop impersonating
          </DropdownMenuItem>
        ) : null}
        {isLoading ? (
          <DropdownMenuItem disabled>Loading users...</DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup
            value={currentUserId}
            onValueChange={(value) => void switchUser(value)}
          >
            {data?.users.map((item) => {
              const isActor = item.id === actorUserId;
              const suffix = item.role ? ` (${item.role})` : "";

              return (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  {isActor ? `You: ${item.name}` : item.name}
                  {suffix}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
