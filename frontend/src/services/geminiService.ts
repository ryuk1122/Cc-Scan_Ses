import { api } from "@/src/utils/api";

type GeminiScanResult = {
  cedula?: string;
  nombres?: string;
  primer_apellido?: string;
  segundo_apellido?: string;
  genero?: string;
  fecha_nacimiento?: string;
  fecha_expiracion?: string;
  tipo_sangre?: string;
  mrz_valido?: boolean;
  _pipeline?: string;
  _gemini?: any;
  error?: string;
  detalle?: string;
};

export async function analizarConGemini(imageBase64: string): Promise<GeminiScanResult> {
  try {
    const normalized = String(imageBase64 || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    if (!normalized) return { error: "imagen_vacia" };

    const result = await api.ocrCedula(normalized, { forceGemini: true });
    return {
      ...(result.parsed || {}),
      cedula: result.cedula,
      _pipeline: result.pipeline_usado || "backend_ocr",
      _gemini: result.gemini || {},
      error: result.ok ? undefined : result.error || "ocr_no_detecto_documento",
    };
  } catch (error: any) {
    return { error: "backend_ocr_error", detalle: error?.message || String(error) };
  }
}
