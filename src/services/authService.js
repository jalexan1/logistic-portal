// ── authService.js ───────────────────────────────────────────────────────
// Sesión, perfil y accesos por aplicación (core.accesos).
// Compartido con NexusKPI: misma sesión y mismo control de inactividad.
// ─────────────────────────────────────────────────────────────────────────
import { supabase, core } from "../lib/supabase";

export const INACTIVIDAD_MIN = 30;
const KEY_ACTIVIDAD = "ls_ultima_actividad"; // misma clave que usa NexusKPI

export async function iniciarSesion(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(traducirErrorAuth(error));
  marcarActividad();
  return data.session;
}

export async function cerrarSesion() {
  try { await supabase.auth.signOut(); } catch { /* sin red: igual se limpia localmente */ }
  try { localStorage.removeItem("ls_accesos"); } catch { /* ignore */ }
}

export async function obtenerSesion() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function escucharSesion(cb) {
  const { data } = supabase.auth.onAuthStateChange((_evt, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// Perfil + accesos del usuario autenticado.
export async function cargarContextoUsuario(userId) {
  const [perfilRes, appsRes] = await Promise.all([
    core().from("perfiles").select("id,email,nombre,area,cuenta_id,activo").eq("id", userId).maybeSingle(),
    core().rpc("fn_mis_aplicaciones"),
  ]);
  if (perfilRes.error) throw new Error("No se pudo leer el perfil: " + perfilRes.error.message);
  if (appsRes.error)   throw new Error("No se pudieron leer los accesos: " + appsRes.error.message);
  const roles = {};
  (appsRes.data || []).forEach(a => { roles[a.codigo] = a.rol; });
  try { localStorage.setItem("ls_accesos", JSON.stringify({ uid: userId, apps: appsRes.data, ts: Date.now() })); } catch { /* ignore */ }
  return { perfil: perfilRes.data, apps: appsRes.data || [], roles };
}

// ── Inactividad compartida entre apps ────────────────────────────────────
export function marcarActividad() {
  try { localStorage.setItem(KEY_ACTIVIDAD, String(Date.now())); } catch { /* ignore */ }
}

export function vigilarInactividad(onVencida) {
  let ultimoMarcado = 0;
  const onEvento = () => {
    const ahora = Date.now();
    if (ahora - ultimoMarcado > 15000) { ultimoMarcado = ahora; marcarActividad(); }
  };
  const eventos = ["mousemove", "keydown", "click", "touchstart", "scroll"];
  eventos.forEach(e => window.addEventListener(e, onEvento, { passive: true }));
  marcarActividad();
  const timer = setInterval(() => {
    const ultima = Number(localStorage.getItem(KEY_ACTIVIDAD) || Date.now());
    if (Date.now() - ultima > INACTIVIDAD_MIN * 60000) onVencida();
  }, 30000);
  return () => { clearInterval(timer); eventos.forEach(e => window.removeEventListener(e, onEvento)); };
}

function traducirErrorAuth(error) {
  const m = (error?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "El correo aún no ha sido confirmado.";
  if (m.includes("fetch")) return "Sin conexión con el servidor. Intente de nuevo.";
  return error?.message || "Error de autenticación.";
}
