import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";

async function findUser(idOrEmail: string) {
  return prisma.user.findFirst({
    where: {
      OR: [{ id: idOrEmail }, { email: idOrEmail }],
    },
    include: { store: true },
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email or ID", type: "text" },
        password: { label: "Password", type: "password" },
        pin: { label: "PIN", type: "password" },
      },
      async authorize(credentials) {
        const identifier = credentials?.email as string;
        const password = credentials?.password as string | undefined;
        const pin = credentials?.pin as string | undefined;

        if (!identifier) return null;

        const user = await findUser(identifier);
        if (!user || !user.isActive) return null;

        // PIN login (fast terminal access)
        if (pin) {
          if (!user.pin) return null;
          const pinValid = await compare(pin, user.pin);
          if (!pinValid) return null;
          return toSessionUser(user);
        }

        // Password login
        if (!password || !user.passwordHash) return null;
        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;
        return toSessionUser(user);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role ?? "WAITER";
        token.storeId = (user as any).storeId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? "";
        session.user.role = (token.role as string) ?? "WAITER";
        session.user.storeId = (token.storeId as string) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
});

function toSessionUser(user: {
  id: string;
  name: string | null;
  email: string;
  role: string;
  store: { id: string } | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: null,
    role: user.role,
    storeId: user.store?.id ?? null,
  };
}
