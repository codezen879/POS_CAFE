import { PrismaClient } from "@prisma/client";
import { PrismaClient as PrismaClientPg } from "@/generated/pg";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPostgresClient(): PrismaClient {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set. Supabase/Vercel deployment requires it.");
  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClientPg({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }) as unknown as PrismaClient;
  globalForPrisma.prisma = client;
  return client;
}

export const prisma: PrismaClient = process.env.POSTGRES_URL
  ? globalForPrisma.prisma ?? createPostgresClient()
  : globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;