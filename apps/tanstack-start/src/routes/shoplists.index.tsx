import type { inferProcedureOutput } from "@trpc/server";
import { Suspense } from "react";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { ItemIcon } from "~/component/item-icon";
import { useTRPC } from "~/lib/trpc";

type DuplicateResult = inferProcedureOutput<
  AppRouter["shoppingLists"]["duplicate"]
>;

export const Route = createFileRoute("/shoplists/")({
  head: () => ({
    meta: [
      { title: "Shopping Lists | AAC Dashboard" },
      {
        name: "description",
        content:
          "Browse owned and shared shopping lists for ArcheAge Classic crafts, simulations, and material runs.",
      },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      context.trpc.shoppingLists.listMineAndShared.queryOptions(),
    );
  },
  component: ShoplistsPage,
});

function ShoplistsPage() {
  return (
    <main className="container py-16">
      <Suspense fallback={<p>Loading shopping lists...</p>}>
        <ShoplistsContent />
      </Suspense>
    </main>
  );
}

function ShoplistsContent() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(
    trpc.shoppingLists.listMineAndShared.queryOptions(),
  );

  const duplicate = useMutation(
    trpc.shoppingLists.duplicate.mutationOptions({
      onSuccess: async (result: DuplicateResult) => {
        await queryClient.invalidateQueries(
          trpc.shoppingLists.listMineAndShared.pathFilter(),
        );
        toast.success("Shopping list duplicated.");
        await navigate({
          to: "/shoplists/$listId",
          params: { listId: result.id },
        });
      },
      onError: () => toast.error("Failed to duplicate shopping list."),
    }),
  );

  const deleteList = useMutation(
    trpc.shoppingLists.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.shoppingLists.listMineAndShared.pathFilter(),
        );
        toast.success("Shopping list deleted.");
      },
      onError: () => toast.error("Failed to delete shopping list."),
    }),
  );

  const handleDelete = (listId: string, name: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${name}"? This cannot be undone.`,
      );
      if (!confirmed) return;
    }
    deleteList.mutate({ listId });
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Shopping Lists</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Browse lists you own and lists other players shared with you.
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Owned</h2>
          <p className="text-muted-foreground text-sm">
            {data.owned.length} list{data.owned.length === 1 ? "" : "s"}
          </p>
        </div>
        {data.owned.length === 0 ? (
          <EmptyState message="No owned shopping lists yet. Create one from a craft or simulator shoplist preview." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.owned.map((list) => (
              <ListCard
                key={list.id}
                list={list}
                actionLabel="Open"
                freshDuplicatePending={
                  duplicate.isPending &&
                  duplicate.variables.listId === list.id &&
                  duplicate.variables.mode === "fresh"
                }
                snapshotDuplicatePending={
                  duplicate.isPending &&
                  duplicate.variables.listId === list.id &&
                  duplicate.variables.mode === "copyState"
                }
                deletePending={
                  deleteList.isPending &&
                  deleteList.variables.listId === list.id
                }
                onFreshDuplicate={() =>
                  duplicate.mutate({ listId: list.id, mode: "fresh" })
                }
                onSnapshotDuplicate={() =>
                  duplicate.mutate({ listId: list.id, mode: "copyState" })
                }
                onDelete={() => handleDelete(list.id, list.name)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Shared With Me</h2>
          <p className="text-muted-foreground text-sm">
            {data.shared.length} list{data.shared.length === 1 ? "" : "s"}
          </p>
        </div>
        {data.shared.length === 0 ? (
          <EmptyState message="Nothing shared with you yet." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.shared.map((list) => (
              <ListCard
                key={list.id}
                list={list}
                role={list.role}
                actionLabel="Open"
                freshDuplicatePending={
                  duplicate.isPending &&
                  duplicate.variables.listId === list.id &&
                  duplicate.variables.mode === "fresh"
                }
                snapshotDuplicatePending={
                  duplicate.isPending &&
                  duplicate.variables.listId === list.id &&
                  duplicate.variables.mode === "copyState"
                }
                onFreshDuplicate={() =>
                  duplicate.mutate({ listId: list.id, mode: "fresh" })
                }
                onSnapshotDuplicate={() =>
                  duplicate.mutate({ listId: list.id, mode: "copyState" })
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed px-5 py-8 text-sm">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

function ListCard({
  list,
  role,
  actionLabel,
  onFreshDuplicate,
  onSnapshotDuplicate,
  onDelete,
  freshDuplicatePending = false,
  snapshotDuplicatePending = false,
  deletePending = false,
}: {
  list: {
    id: string;
    name: string;
    sourceType: "craft" | "simulator";
    sourceQuantity: number;
    updatedAt: Date;
    sourceItem: {
      id: number | null;
      name: string | null;
      icon: string | null;
    } | null;
    owner: { id: string; name: string; image: string | null };
  };
  role?: "read" | "write";
  actionLabel: string;
  onFreshDuplicate: () => void;
  onSnapshotDuplicate: () => void;
  onDelete?: () => void;
  freshDuplicatePending?: boolean;
  snapshotDuplicatePending?: boolean;
  deletePending?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {list.sourceItem?.icon ? (
              <ItemIcon
                icon={list.sourceItem.icon}
                name={list.sourceItem.name ?? list.name}
              />
            ) : null}
            <h3 className="truncate text-lg font-semibold">{list.name}</h3>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {list.sourceQuantity}{" "}
            {list.sourceType === "simulator"
              ? `attempt${list.sourceQuantity === 1 ? "" : "s"}`
              : `craft${list.sourceQuantity === 1 ? "" : "s"}`}
            {role ? ` • ${role}` : " • owner"}
          </p>
        </div>
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {list.owner.image ? (
          <img
            src={list.owner.image}
            alt={list.owner.name}
            className="h-6 w-6 rounded-full border object-cover"
          />
        ) : (
          <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full border text-xs">
            {list.owner.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="truncate">{list.owner.name}</span>
      </div>

      <p className="text-muted-foreground text-xs">
        Updated {new Date(list.updatedAt).toLocaleString()}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/shoplists/$listId" params={{ listId: list.id }}>
            {actionLabel}
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onFreshDuplicate}
          loading={freshDuplicatePending}
          loadingText="Duplicating..."
        >
          Duplicate fresh
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onSnapshotDuplicate}
          loading={snapshotDuplicatePending}
          loadingText="Duplicating..."
        >
          Duplicate with progress
        </Button>
        {onDelete ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onDelete}
            loading={deletePending}
            loadingText="Deleting..."
          >
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
