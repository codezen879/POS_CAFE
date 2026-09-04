import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/pg";
import { hash } from "bcryptjs";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding POS Cafe (Postgres / Supabase)...");

  // --- Store ---
  const store = await prisma.store.upsert({
    where: { id: "store-main" },
    update: {},
    create: {
      id: "store-main",
      name: "POS Cafe - Main",
      legalName: "POS Cafe Pvt Ltd",
      address: "12 Coffee Lane",
      city: "Mumbai",
      state: "MH",
      country: "IN",
      currency: "INR",
      gstin: "27ABCDE1234F1Z5",
      phone: "+91 98765 43210",
      email: "hello@poscafe.example",
    },
  });

  // --- Super admin + staff ---
  const adminPassword = await hash("admin123", 10);
  const staffPassword = await hash("staff123", 10);
  const adminPin = await hash("1234", 10);
  const staffPin = await hash("5678", 10);

  await prisma.user.upsert({
    where: { email: "admin@poscafe.example" },
    update: {},
    create: {
      email: "admin@poscafe.example",
      name: "Store Admin",
      passwordHash: adminPassword,
      pin: adminPin,
      role: "SUPER_ADMIN",
      storeId: store.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "cashier@poscafe.example" },
    update: {},
    create: {
      email: "cashier@poscafe.example",
      name: "Rahul (Cashier)",
      passwordHash: staffPassword,
      pin: staffPin,
      role: "CASHIER",
      storeId: store.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "kitchen@poscafe.example" },
    update: {},
    create: {
      email: "kitchen@poscafe.example",
      name: "Chef Ayesha",
      passwordHash: staffPassword,
      pin: "1111",
      role: "KITCHEN",
      storeId: store.id,
    },
  });

  // --- Tax rates ---
  const tax18 = await prisma.taxRate.upsert({
    where: { id: "tax-18" },
    update: {},
    create: { id: "tax-18", storeId: store.id, code: "TAX18", name: "GST 18%", rate: 18 },
  });
  const tax5 = await prisma.taxRate.upsert({
    where: { id: "tax-5" },
    update: {},
    create: { id: "tax-5", storeId: store.id, code: "TAX5", name: "GST 5%", rate: 5 },
  });
  const tax12 = await prisma.taxRate.upsert({
    where: { id: "tax-12" },
    update: {},
    create: { id: "tax-12", storeId: store.id, code: "TAX12", name: "GST 12%", rate: 12 },
  });

  // --- Menu categories ---
  const catCoffee = await prisma.menuCategory.upsert({
    where: { slug: "coffee" },
    update: {},
    create: { slug: "coffee", name: "Coffee", sortOrder: 1, icon: "☕" },
  });
  const catFood = await prisma.menuCategory.upsert({
    where: { slug: "food" },
    update: {},
    create: { slug: "food", name: "Food & Snacks", sortOrder: 2, icon: "🥪" },
  });
  const catBakery = await prisma.menuCategory.upsert({
    where: { slug: "bakery" },
    update: {},
    create: { slug: "bakery", name: "Bakery", sortOrder: 3, icon: "🥐" },
  });
  const catDesserts = await prisma.menuCategory.upsert({
    where: { slug: "desserts" },
    update: {},
    create: { slug: "desserts", name: "Desserts", sortOrder: 4, icon: "🍰" },
  });
  const catBev = await prisma.menuCategory.upsert({
    where: { slug: "beverages" },
    update: {},
    create: { slug: "beverages", name: "Beverages", sortOrder: 5, icon: "🧋" },
  });

  // --- Products ---
  const products = [
    { code: "101", name: "Choco Chip Frappe", cat: catCoffee, price: 220, tax: tax18, veg: true, best: true, avail: true, prep: 8, max: 5, desc: "Cold coffee with chocolate chips" },
    { code: "102", name: "Irish Coffee", cat: catCoffee, price: 260, tax: tax18, veg: true, best: false, avail: true, prep: 10, max: null, desc: "Classic Irish coffee with cream" },
    { code: "103", name: "Latte Coffee", cat: catCoffee, price: 180, tax: tax18, veg: true, best: true, avail: true, prep: 5, max: 10, desc: "Smooth espresso with steamed milk" },
    { code: "104", name: "Cappuccino", cat: catCoffee, price: 170, tax: tax18, veg: true, best: false, avail: true, prep: 5, max: null, desc: "Espresso, hot milk, foam" },
    { code: "105", name: "Mocha", cat: catCoffee, price: 200, tax: tax18, veg: true, best: false, avail: true, prep: 7, max: null, desc: "Chocolate + espresso treat" },
    { code: "106", name: "Cold Coffee", cat: catCoffee, price: 190, tax: tax18, veg: true, best: true, avail: true, prep: 5, max: 8, desc: "Blended iced coffee" },
    { code: "201", name: "Grilled Sandwich", cat: catFood, price: 150, tax: tax5, veg: true, best: false, avail: true, prep: 10, max: null, desc: "Veg grilled sandwich" },
    { code: "202", name: "Veg Wrap", cat: catFood, price: 160, tax: tax5, veg: true, best: false, avail: true, prep: 12, max: null, desc: "Fresh veg wrap" },
    { code: "203", name: "French Fries", cat: catFood, price: 120, tax: tax5, veg: true, best: false, avail: true, prep: 8, max: null, desc: "Crispy salted fries" },
    { code: "204", name: "Veg Salad", cat: catFood, price: 140, tax: tax5, veg: true, best: false, avail: true, prep: 6, max: null, desc: "Garden fresh salad" },
    { code: "301", name: "Butter Croissant", cat: catBakery, price: 90, tax: tax5, veg: true, best: false, avail: true, prep: 2, max: null, desc: "Flaky butter croissant" },
    { code: "302", name: "Chocolate Muffin", cat: catBakery, price: 95, tax: tax5, veg: true, best: false, avail: true, prep: 2, max: null, desc: "Moist chocolate muffin" },
    { code: "303", name: "Chocolate Cookie", cat: catBakery, price: 60, tax: tax5, veg: true, best: false, avail: true, prep: 1, max: null, desc: "Soft chocolate cookie" },
    { code: "401", name: "Chocolate Pastry", cat: catDesserts, price: 120, tax: tax12, veg: true, best: false, avail: true, prep: 2, max: null, desc: "Rich chocolate pastry" },
    { code: "501", name: "Fresh Lemonade", cat: catBev, price: 110, tax: tax12, veg: true, best: false, avail: true, prep: 3, max: null, desc: "Freshly squeezed" },
    { code: "502", name: "Iced Tea", cat: catBev, price: 130, tax: tax12, veg: true, best: false, avail: true, prep: 3, max: null, desc: "Refreshing peach iced tea" },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { code: p.code },
      update: {
        name: p.name, basePrice: p.price, description: p.desc,
        isVeg: p.veg, isBestseller: p.best, isAvailable: p.avail,
        prepTimeMins: p.prep, maxOrderQty: p.max, taxRateId: p.tax.id, categoryId: p.cat.id,
      },
      create: {
        code: p.code, name: p.name, basePrice: p.price, description: p.desc,
        isVeg: p.veg, isBestseller: p.best, isAvailable: p.avail,
        prepTimeMins: p.prep, maxOrderQty: p.max, taxRateId: p.tax.id, categoryId: p.cat.id,
      },
    });
  }

  // --- Add-on options ---
  const addons = [
    { name: "Extra Foam", flavour: null, price: 20 },
    { name: "Extra Espresso Shot", flavour: null, price: 40 },
    { name: "Choco Syrup", flavour: "Chocolate", price: 30 },
    { name: "Caramel Syrup", flavour: "Caramel", price: 30 },
    { name: "Vanilla Syrup", flavour: "Vanilla", price: 30 },
  ];
  for (const a of addons) {
    await prisma.addonOption.upsert({
      where: { id: `addon-${a.name.replace(/\s/g, "")}` },
      update: { price: a.price, flavour: a.flavour },
      create: { id: `addon-${a.name.replace(/\s/g, "")}`, name: a.name, price: a.price, flavour: a.flavour },
    });
  }

  const coffeeProducts = await prisma.product.findMany({ where: { categoryId: catCoffee.id } });
  const choco = await prisma.addonOption.findUnique({ where: { id: "addon-ChocoSyrup" } });
  const caramel = await prisma.addonOption.findUnique({ where: { id: "addon-CaramelSyrup" } });
  const foam = await prisma.addonOption.findUnique({ where: { id: "addon-ExtraFoam" } });
  if (choco && coffeeProducts.length) {
    for (const p of coffeeProducts) {
      const existing = await prisma.productAddon.findUnique({ where: { productId_addonId: { productId: p.id, addonId: choco.id } } });
      if (!existing) await prisma.productAddon.create({ data: { productId: p.id, addonId: choco.id } });
      if (caramel) {
        const e2 = await prisma.productAddon.findUnique({ where: { productId_addonId: { productId: p.id, addonId: caramel.id } } });
        if (!e2) await prisma.productAddon.create({ data: { productId: p.id, addonId: caramel.id } });
      }
      if (foam) {
        const e3 = await prisma.productAddon.findUnique({ where: { productId_addonId: { productId: p.id, addonId: foam.id } } });
        if (!e3) await prisma.productAddon.create({ data: { productId: p.id, addonId: foam.id } });
      }
    }
  }

  // --- Floors, tables, seats ---
  const floor = await prisma.floor.upsert({
    where: { id: "floor-main" },
    update: {},
    create: { id: "floor-main", name: "Main Floor", sortOrder: 1 },
  });

  const tables = [
    { name: "T1", seats: 2 },
    { name: "T2", seats: 2 },
    { name: "T3", seats: 4 },
    { name: "T4", seats: 4 },
  ];
  for (const t of tables) {
    const table = await prisma.diningTable.upsert({
      where: { id: `table-${t.name.toLowerCase()}` },
      update: { seatCount: t.seats, status: "AVAILABLE" },
      create: { id: `table-${t.name.toLowerCase()}`, tableName: t.name, floorId: floor.id, storeId: store.id, seatCount: t.seats },
    });
    for (let s = 1; s <= t.seats; s++) {
      const existing = await prisma.tableSeat.findUnique({ where: { tableId_seatNo: { tableId: table.id, seatNo: s } } });
      if (!existing) {
        await prisma.tableSeat.create({ data: { tableId: table.id, seatNo: s } });
      }
    }
  }

  // --- Suppliers & ingredients ---
  await prisma.supplier.upsert({
    where: { id: "supplier-1" },
    update: {},
    create: { id: "supplier-1", name: "Coffee Bean Co.", phone: "+91 90000 00001", contact: "Vendor" },
  });
  const ingredients = [
    { name: "Espresso Beans", unit: "kg", stock: 20, reorder: 5 },
    { name: "Milk", unit: "l", stock: 50, reorder: 10 },
    { name: "Sugar", unit: "kg", stock: 30, reorder: 5 },
    { name: "Chocolate Syrup", unit: "l", stock: 12, reorder: 3 },
    { name: "Wheat Bread", unit: "pcs", stock: 60, reorder: 20 },
  ];
  for (const i of ingredients) {
    await prisma.ingredient.upsert({
      where: { id: `ing-${i.name.replace(/\s/g, "")}` },
      update: { stockQty: i.stock, reorderLevel: i.reorder },
      create: {
        id: `ing-${i.name.replace(/\s/g, "")}`, name: i.name, unit: i.unit,
        stockQty: i.stock, reorderLevel: i.reorder, supplierId: "supplier-1",
      },
    });
  }

  // --- Settings ---
  await prisma.setting.upsert({
    where: { storeId_key: { storeId: store.id, key: "service_charge_percent" } },
    update: { value: "0" },
    create: { storeId: store.id, key: "service_charge_percent", value: "0", group: "billing" },
  });
  await prisma.setting.upsert({
    where: { storeId_key: { storeId: store.id, key: "loyalty_points_per_rupee" } },
    update: { value: "1" },
    create: { storeId: store.id, key: "loyalty_points_per_rupee", value: "1", group: "loyalty" },
  });

  // --- Demo customer ---
  await prisma.customer.upsert({
    where: { phone: "+919876543210" },
    update: {},
    create: { name: "Aarav Sharma", phone: "+919876543210", email: "aarav@example.com", loyaltyPoints: 120 },
  });

  console.log("Seed complete ✓ (Postgres / Supabase)");
  console.log("\nLogin: admin@poscafe.example / admin123  (PIN 1234)");
  console.log("Cashier: cashier@poscafe.example / staff123  (PIN 5678)");
  console.log("Kitchen: kitchen@poscafe.example / staff123  (PIN 1111)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });