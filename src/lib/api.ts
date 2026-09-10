import { getCurrentUser } from "./session";

export type ApiUser = {
  id: string;
  role: string;
  storeId?: string | null;
};

/**
 * Guard for API route handlers. Returns the authenticated user
 * or a JSON error response. Requires an optional set of allowed roles.
 */
export async function apiAuth(...roles: string[]): Promise<ApiUser | Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return { id: user.id, role: user.role, storeId: user.storeId };
}
