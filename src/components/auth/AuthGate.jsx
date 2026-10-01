// ── AuthGate.jsx ─────────────────────────────────────────────────────────
// Guardia de la app: sin sesión → login; con sesión → carga perfil, accesos
// y maestro de destinatarios; sin acceso a Despachos/Inventario → aviso.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from "react";
import { AuthContext } from "./authContext";
import {
  obtenerSesion, escucharSesion, cargarContextoUsuario, cerrarSesion, vigilarInactividad,
} from "../../services/authService";
import { cargarDestinatarios } from "../../services/clientesService";
import LoginScreen from "./LoginScreen";
import { PLATAFORMA_URL } from "../../lib/supabase";

const APPS_DE_ESTE_PORTAL = ["DESPACHOS", "INVENTARIO"];

export default function AuthGate({ children }) {
  const [estado, setEstado] = useState("cargando"); // cargando | login | sin-acceso | error | listo
  const [ctx, setCtx]       = useState(null);
  const [error, setError]   = useState("");

  const salir = useCallback(async (motivo) => {
    await cerrarSesion();
    setCtx(null);
    setError(motivo || "");
    setEstado("login");
  }, []);

  const preparar = useCallback(async (session) => {
    if (!session) { setCtx(null); setEstado("login"); return; }
    setEstado("cargando");
    try {
      const u = await cargarContextoUsuario(session.user.id);
      if (u.perfil && u.perfil.activo === false) { await salir("Usuario inactivo. Contacte al administrador."); return; }
      const tieneAcceso = APPS_DE_ESTE_PORTAL.some(a => u.roles[a]);
      if (!tieneAcceso) { setCtx({ session, ...u }); setEstado("sin-acceso"); return; }
      if (u.roles.DESPACHOS) await cargarDestinatarios();
      setCtx({ session, ...u });
      setEstado("listo");
    } catch (e) {
      setError(e.message);
      setEstado("error");
    }
  }, [salir]);

  useEffect(() => {
    let vivo = true;
    obtenerSesion().then(s => { if (vivo) preparar(s); });
    const off = escucharSesion((s) => {
      // Solo reaccionamos a cierre de sesión (p. ej. "Salir" desde NexusKPI o expiración)
      if (!s && vivo) { setCtx(null); setEstado("login"); }
    });
    return () => { vivo = false; off(); };
  }, [preparar]);

  useEffect(() => {
    if (estado !== "listo" && estado !== "sin-acceso") return;
    return vigilarInactividad(() => salir("Sesión cerrada por inactividad."));
  }, [estado, salir]);

  if (estado === "cargando") return <Pantalla><Spinner /> <span>Cargando…</span></Pantalla>;
  if (estado === "login")    return <LoginScreen aviso={error} onLogin={(s) => { setError(""); preparar(s); }} />;
  if (estado === "error") return (
    <Pantalla>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#C0392B", marginBottom: 8 }}>No se pudo iniciar la aplicación</div>
        <div style={{ fontSize: 13, color: "#44574F", marginBottom: 16 }}>{error}</div>
        <button onClick={() => obtenerSesion().then(preparar)} style={btn}>Reintentar</button>
        <button onClick={() => salir()} style={{ ...btn, background: "#fff", color: "#0F6E56", border: "1px solid #C5DDD4", marginLeft: 8 }}>Salir</button>
      </div>
    </Pantalla>
  );
  if (estado === "sin-acceso") return (
    <Pantalla>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2e27", marginBottom: 8 }}>Sin acceso a este portal</div>
        <div style={{ fontSize: 13, color: "#44574F", marginBottom: 18 }}>
          Tu usuario ({ctx?.perfil?.email}) no tiene habilitado Portal de Despachos ni Inventario de Pasillos.
          Solicita el acceso al administrador de la plataforma.
        </div>
        <a href={PLATAFORMA_URL} style={{ ...btn, textDecoration: "none", display: "inline-block" }}>Ir a la plataforma</a>
        <button onClick={() => salir()} style={{ ...btn, background: "#fff", color: "#0F6E56", border: "1px solid #C5DDD4", marginLeft: 8 }}>Salir</button>
      </div>
    </Pantalla>
  );

  return <AuthContext.Provider value={{ ...ctx, salir }}>{children}</AuthContext.Provider>;
}

const btn = { padding: "9px 20px", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, background: "#0F6E56", color: "#fff", cursor: "pointer" };

function Pantalla({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 16,
      background: "#F7F9F8", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", color: "#44574F", fontSize: 14 }}>
      {children}
    </div>
  );
}

function Spinner() {
  return <span style={{ width: 18, height: 18, border: "2px solid #C5DDD4", borderTopColor: "#0F6E56", borderRadius: "50%",
    display: "inline-block", animation: "spin 0.8s linear infinite" }} />;
}
