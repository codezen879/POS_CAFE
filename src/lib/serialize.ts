function isDecimal(v: unknown): v is { toNumber(): number } {
  return v != null && typeof v === "object" && typeof (v as any).toNumber === "function";
}

export function toPlain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (isDecimal(v)) return v.toNumber();
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Map) return Object.fromEntries(v);
      if (v instanceof Set) return Array.from(v);
      return v;
    })
  );
}