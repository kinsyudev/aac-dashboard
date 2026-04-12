import { createFileRoute, Link } from "@tanstack/react-router";

import { authClient } from "~/auth/client";

const APP_NAME = "AAC Dashboard";
const HOME_DESCRIPTION =
  "ArcheAge Classic crafting, simulator, profile, and shopping list tools in one place.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: APP_NAME },
      { name: "description", content: HOME_DESCRIPTION },
      { property: "og:title", content: APP_NAME },
      { property: "og:description", content: HOME_DESCRIPTION },
      { name: "twitter:title", content: APP_NAME },
      { name: "twitter:description", content: HOME_DESCRIPTION },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { data: session } = authClient.useSession();

  return (
    <main className="container py-16">
      <div className="flex max-w-5xl flex-col gap-12">
        <section className="flex flex-col gap-4">
          <p className="text-primary text-sm font-semibold uppercase tracking-[0.2em]">
            ArcheAge Classic Tools
          </p>
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Plan crafts, compare margins, and keep your material runs organized.
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg">
              Use the craft explorer, profitability simulator, and shared shopping
              lists without bouncing between pages that feel disconnected.
            </p>
          </div>
          <p className="text-muted-foreground text-sm">
            {session
              ? `Connected as ${session.user.name}.`
              : "Sign in with Discord to save profile pricing and access shared lists."}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard
            title="Craft"
            description="Search recipes, inspect materials, and move straight into an item breakdown."
            to="/craft"
            cta="Open craft search"
          />
          <DashboardCard
            title="Simulator"
            description="Model sealed craft chains and compare margins before spending labor or gold."
            to="/simulator"
            cta="Run simulations"
          />
          <DashboardCard
            title="Shopping Lists"
            description="Track ingredient runs, duplicate shared lists, and keep collaboration in one place."
            to="/shoplists"
            cta="View lists"
          />
          <DashboardCard
            title="Profile"
            description="Set proficiencies and material overrides so every result reflects your account."
            to="/profile"
            cta="Edit profile"
          />
        </section>
      </div>
    </main>
  );
}

function DashboardCard({
  cta,
  description,
  title,
  to,
}: {
  cta: string;
  description: string;
  title: string;
  to: "/craft" | "/simulator" | "/shoplists" | "/profile";
}) {
  return (
    <Link
      to={to}
      className="group from-background to-muted/40 hover:border-primary/50 hover:bg-muted/40 flex min-h-52 flex-col rounded-2xl border bg-linear-to-br p-6 transition-colors"
    >
      <div className="flex flex-1 flex-col gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm leading-6">{description}</p>
      </div>
      <span className="text-sm font-medium underline-offset-4 group-hover:underline">
        {cta}
      </span>
    </Link>
  );
}
