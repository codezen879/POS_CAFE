import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SettingsManager } from "@/components/settings/settings-manager";
import { toPlain } from "@/lib/serialize";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);

  const [store, taxRates, settings] = await Promise.all([
    prisma.store.findFirst(),
    prisma.taxRate.findMany({ orderBy: { code: "asc" } }),
    prisma.setting.findMany(),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settings) settingsMap[s.key] = s.value;

  return <SettingsManager store={toPlain(store) as any} taxRates={toPlain(taxRates) as any} settings={settingsMap} isManager={isManager} />;
}