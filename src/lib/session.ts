import { auth } from "./auth";
import { redirect } from "next/navigation";

export const MANAGER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Returns the authenticated user or redirects to login.
 * Intended for server components / route handlers.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Returns the user only if they have the required role, else redirects.
 * @param roles roles allowed (empty = any authenticated user)
 */
export async function requireRole(...roles: string[]) {
  const user = await requireUser();
  if (!user) {
    redirect("/login");
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    redirect("/");
  }
  return user;
}

export function isManager(role?: string | null) {
  return !!role && MANAGER_ROLES.includes(role);
}

export function canManage(role?: string | null) {
  return isManager(role);
}

export function isServerStaff(role?: string | null) {
  return !!role && (role === "CASHIER" || role === "WAITER" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
}