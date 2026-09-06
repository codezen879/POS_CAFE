import {
  LayoutDashboard,
  UtensilsCrossed,
  CookingPot,
  NotebookText,
  ReceiptText,
  Users,
  Boxes,
  UsersRound,
  BarChart3,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboard },
      { title: "Table Service", href: "/tables", icon: UtensilsCrossed },
      { title: "Kitchen Display", href: "/kitchen", icon: CookingPot },
      { title: "Menu", href: "/menu", icon: NotebookText, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Orders", href: "/orders", icon: ReceiptText },
      { title: "Billing", href: "/billing", icon: ReceiptText },
      { title: "Waste", href: "/waste", icon: Trash2 },
      { title: "Customers & Loyalty", href: "/customers", icon: Users },
      { title: "Inventory", href: "/inventory", icon: Boxes, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Staff", href: "/staff", icon: UsersRound, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { title: "Reports", href: "/reports", icon: BarChart3, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { title: "Settings", href: "/settings", icon: Settings, roles: ["SUPER_ADMIN", "ADMIN"] },
    ],
  },
];

export function getNavGroups(role?: string | null) {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || (role && item.roles.includes(role))),
    }))
    .filter((group) => group.items.length > 0);
}
