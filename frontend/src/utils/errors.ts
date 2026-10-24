export function errorMessage(error: unknown, fallback = "Ocurrió un error"): string {
  const value = (error as any)?.detail ?? error;

  if (typeof value === "string") {
    const normalized = value.trim();
    // Reverse proxies (Render/nginx) can return their complete HTML error
    // document. Never expose that raw page inside a mobile alert.
    if (/^<!doctype\s+html|^<html[\s>]|<title>\s*502\s*<\/title>/i.test(normalized)) {
      const status = Number((error as any)?.status || 0);
      if (status === 502) return "El servidor de lectura no está disponible en este momento. Verifica el backend e inténtalo nuevamente.";
      if (status >= 500) return "El servidor de lectura presentó un error temporal. Inténtalo nuevamente.";
      return fallback;
    }
    if (normalized.length > 500) return fallback;
    return normalized || fallback;
  }
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
