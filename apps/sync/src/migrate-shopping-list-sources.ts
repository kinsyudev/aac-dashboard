import { db } from "@acme/db/client";
import { sql } from "@acme/db";

async function migrateShoppingListSources() {
  await db.execute(sql.raw(`
    create table if not exists shopping_list_sources (
      id uuid primary key default gen_random_uuid(),
      shopping_list_id uuid not null references shopping_lists(id) on delete cascade,
      source_type shopping_list_source_type not null default 'craft',
      craft_id integer not null references crafts(id) on delete cascade,
      item_id integer references items(id) on delete set null,
      quantity integer not null default 1,
      position integer not null default 0,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    );
  `));

  await db.execute(sql.raw(`
    create index if not exists idx_shopping_list_sources_list
      on shopping_list_sources(shopping_list_id);
  `));
  await db.execute(sql.raw(`
    create index if not exists idx_shopping_list_sources_type
      on shopping_list_sources(shopping_list_id, source_type);
  `));

  const legacyColumnRows = await db.execute<{
    has_legacy_columns: boolean;
  }>(sql.raw(`
    select exists (
      select 1
      from information_schema.columns
      where table_name = 'shopping_lists'
        and column_name = 'source_craft_id'
    ) as has_legacy_columns;
  `));
  const hasLegacyColumns = legacyColumnRows[0]?.has_legacy_columns ?? false;

  if (hasLegacyColumns) {
    await db.execute(sql.raw(`
      insert into shopping_list_sources (
        shopping_list_id,
        source_type,
        craft_id,
        item_id,
        quantity,
        position,
        created_at,
        updated_at
      )
      select
        sl.id,
        sl.source_type,
        sl.source_craft_id,
        sl.source_item_id,
        sl.source_quantity,
        0,
        sl.created_at,
        sl.updated_at
      from shopping_lists sl
      where sl.source_craft_id is not null
        and not exists (
          select 1
          from shopping_list_sources src
          where src.shopping_list_id = sl.id
        );
    `));

    await db.execute(sql.raw(`
      alter table shopping_lists
        drop column if exists source_type,
        drop column if exists source_craft_id,
        drop column if exists source_item_id,
        drop column if exists source_quantity;
    `));
  }

  const sourceCountRows = await db.execute<{ list_count: number }>(
    sql.raw(`
      select count(*)::int as list_count
      from shopping_list_sources;
    `),
  );
  const listCount = sourceCountRows[0]?.list_count ?? 0;

  console.log(`shopping_list_sources ready; ${listCount} source row(s) present.`);
}

migrateShoppingListSources()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
