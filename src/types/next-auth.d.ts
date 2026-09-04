import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      storeId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    storeId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    storeId?: string | null;
  }
}
