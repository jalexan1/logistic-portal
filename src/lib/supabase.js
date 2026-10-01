// ── lib/supabase.js ──────────────────────────────────────────────────────
// Cliente único de Supabase para toda la app.
// Usa el MISMO proyecto (kpi-logistics) y la MISMA clave de almacenamiento
// que NexusKPI (`sb-<proyecto>-auth-token` en localStorage). Como ambas apps
// se publican bajo el mismo dominio, comparten la sesión: login una sola vez.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Falla visible en desarrollo; en Vercel se configuran como variables de entorno.
  console.error("[supabase] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Acceso por esquema (estándar de BD: core / despachos / inventario)
export const core       = () => supabase.schema("core");
export const despachos  = () => supabase.schema("despachos");
export const inventario = () => supabase.schema("inventario");

// Ruta del launcher de tarjetas (misma URL base que NexusKPI)
export const PLATAFORMA_URL = import.meta.env.VITE_PLATAFORMA_URL || "/pages/plataforma.html";
