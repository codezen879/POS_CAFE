-- Waiter + kitchen item workflow for the Vercel/Supabase PostgreSQL database.
-- This script is intentionally idempotent so it can be applied once before
-- deploying the application changes.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "requiresKitchen" BOOLEAN NOT NULL DEFAULT true;

-- Preserve the seeded waiter-direct examples on an existing production
-- database. Managers can change this flag for any product from Menu Manager.
UPDATE "products"
SET "requiresKitchen" = false
WHERE "code" IN ('402', '503');

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "requiresKitchen" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "priorityAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnReason" TEXT,
  ADD COLUMN IF NOT EXISTS "billable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "disposition" TEXT,
  ADD COLUMN IF NOT EXISTS "reusedFromItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "order_items"
  ALTER COLUMN "status" SET DEFAULT 'ORDERED';

-- Bring historical rows onto the workflow's status and routing semantics.
UPDATE "order_items"
SET "status" = 'ORDERED'
WHERE "status" = 'PENDING';

UPDATE "order_items" AS item
SET "requiresKitchen" = product."requiresKitchen"
FROM "products" AS product
WHERE item."productId" = product."id";

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotencyKey_key"
  ON "payments"("idempotencyKey");

ALTER TABLE "waste_items"
  ADD COLUMN IF NOT EXISTS "billable" BOOLEAN;

CREATE TABLE IF NOT EXISTS "order_item_events" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "priorityBefore" BOOLEAN,
  "priorityAfter" BOOLEAN,
  "reason" TEXT,
  "note" TEXT,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_item_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_item_events_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_item_events_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "order_items_status_priority_createdAt_idx"
  ON "order_items"("status", "priority", "createdAt");

CREATE INDEX IF NOT EXISTS "order_items_requiresKitchen_status_idx"
  ON "order_items"("requiresKitchen", "status");

CREATE INDEX IF NOT EXISTS "order_items_reusedFromItemId_idx"
  ON "order_items"("reusedFromItemId");

CREATE INDEX IF NOT EXISTS "order_item_events_itemId_createdAt_idx"
  ON "order_item_events"("itemId", "createdAt");

CREATE INDEX IF NOT EXISTS "order_item_events_actorId_createdAt_idx"
  ON "order_item_events"("actorId", "createdAt");

CREATE INDEX IF NOT EXISTS "order_item_events_eventType_createdAt_idx"
  ON "order_item_events"("eventType", "createdAt");
