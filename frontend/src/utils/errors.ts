export function errorMessage(error: unknown, fallback = "Ocurrió un error"): string {
  const value = (error as any)?.detail ?? error;

  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.msg) return String(item.msg);
        if (item?.message) return String(item.message);
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value?.msg) return String(value.msg);
  if (value?.message) return String(value.message);
  if (value && typeof value === "object") return JSON.stringify(value);
  return fallback;
}
