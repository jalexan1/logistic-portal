import React, { useState, useEffect } from "react";
import PortalDespachos from "./components/PortalDespachos";
import InventarioPasillos from "./components/InventarioPasillos";
import Utilidades from "./components/utilidades/Utilidades"; // ── NUEVO: módulo Utilidades
import Solicitudes from "./components/Solicitudes";
import Clientes from "./components/Clientes";
import Articulos from "./components/Articulos";
import Historico from "./components/Historico";
import ParametrosTomaPedido from "./components/admon/ParametrosTomaPedido";
import AdminBaseDatos from "./components/admon/AdminBaseDatos";
import { useAuth } from "./components/auth/authContext";
import { PLATAFORMA_URL } from "./lib/supabase";

// ── Hook responsive ──
const useIsMobile = () => {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
};

// ── Definición de vistas ──
const VISTAS = [
  {
    id: "despachos",
    label: "Despachos",
    labelCorto: "Despachos",
    requiere: ["DESPACHOS"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M5 3V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <path d="M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "solicitudes",
    label: "Solicitudes",
    labelCorto: "Solicitudes",
    requiere: ["DESPACHOS"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 2.5h10M3 6h10M3 9.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M12 10.9v1.2l.8.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "inventario",
    label: "Pasillos",
    labelCorto: "Pasillos",
    requiere: ["INVENTARIO"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  // Histórico de solicitudes y bloques: solo supervisor (operador) y administrador
  {
    id: "historico",
    label: "Histórico",
    labelCorto: "Histórico",
    requiere: ["DESPACHOS"],
    rolesPermitidos: ["operador", "admin"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <path d="M2 2.5v2.8h2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 5v3.2l2.2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
];

// ── Menú Maestros (supervisor = operador, y administrador de Despachos) ──
const OPCIONES_MAESTROS = [
  { id: "clientes",  label: "Clientes",  descripcion: "Maestro de clientes, revisión y carga masiva", icono: "👥" },
  { id: "articulos", label: "Artículos", descripcion: "Item (SKU) y código EAN", icono: "📦" },
];
const ICONO_MAESTROS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="3.5" rx="5.5" ry="2" stroke="currentColor" strokeWidth="1.3"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" strokeWidth="1.3"/></svg>
);
const ICONO_ADMON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
);

// ── Menú Admon (solo administrador): irá creciendo con más opciones ──
const OPCIONES_ADMON = [
  { id: "utilidades", label: "Utilidades", descripcion: "Herramientas de apoyo (extracción de picking, etc.)", icono: "🛠" },
  { id: "parametros", label: "Parámetros TomaPedido", descripcion: "Adjuntos, retención, rangos de consulta", icono: "⚙" },
  { id: "admin_bd",   label: "Administración BD y adjuntos", descripcion: "Respaldo de adjuntos y SQL de consulta", icono: "🗄" },
];

// ══════════════════════════════════════
// ── APP: Orquestador principal ──
// ══════════════════════════════════════
export default function App() {
  const isMobile = useIsMobile();
  const { perfil, roles, salir } = useAuth();

  // Solo las vistas permitidas por los accesos del usuario (core.accesos)
  const vistas = VISTAS.filter(v => v.requiere.some(app => roles?.[app] && (!v.rolesPermitidos || v.rolesPermitidos.includes(roles[app]))));
  // Admon: solo administrador (rol admin en cualquier aplicación)
  const esAdmin = Object.values(roles || {}).includes("admin");
  const admon = esAdmin ? OPCIONES_ADMON : [];
  const esSupervisor = ["operador", "admin"].includes(roles?.DESPACHOS);
  const maestros = esSupervisor ? OPCIONES_MAESTROS : [];
  const inicial = (() => {
    const pedida = new URLSearchParams(window.location.search).get("vista");
    return [...vistas, ...maestros, ...admon].find(v => v.id === pedida)?.id || vistas[0]?.id || maestros[0]?.id || admon[0]?.id;
  })();
  const [vista, setVista] = useState(inicial);
  const [menuAbierto, setMenuAbierto] = useState(null);   // "maestros" | "admon" | null
  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = () => setMenuAbierto(null);
    window.addEventListener("click", cerrar);
    return () => window.removeEventListener("click", cerrar);
  }, [menuAbierto]);

  // Botón de menú desplegable (Maestros, Admon)
  const menuDesplegable = (id, titulo, icono, opciones, encabezado) => {
    if (!opciones.length) return null;
    const dentro = opciones.some(o => o.id === vista);
    const abierto = menuAbierto === id;
    return (
      <div key={id} style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button onClick={() => setMenuAbierto(m => (m === id ? null : id))} aria-expanded={abierto}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "6px 10px" : "7px 14px", fontSize: isMobile ? 11 : 12,
            fontWeight: dentro ? 700 : 500, border: dentro ? "1px solid #0F6E56" : "1px solid #E2EDE9", borderRadius: 9, whiteSpace: "nowrap",
            background: dentro ? "#0F6E56" : "#fff", color: dentro ? "#fff" : "#6B8F80", cursor: "pointer" }}>
          <span style={{ color: dentro ? "#fff" : "#9CB8AE", display: "flex" }}>{icono}</span>
          {titulo}{dentro ? ` · ${opciones.find(o => o.id === vista)?.label}` : ""}
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: abierto ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        {abierto && (
          <div style={{ position: isMobile ? "fixed" : "absolute", top: isMobile ? 110 : "calc(100% + 6px)", left: isMobile ? 12 : 0, right: isMobile ? 12 : "auto", zIndex: 50,
            minWidth: 280, background: "#fff", border: "1px solid #E2EDE9", borderRadius: 12, boxShadow: "0 16px 40px rgba(10,30,24,0.16)", padding: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9CB8AE", textTransform: "uppercase", letterSpacing: ".08em", padding: "6px 10px 4px" }}>{encabezado}</div>
            {opciones.map(o => (
              <button key={o.id} onClick={() => { setVista(o.id); setMenuAbierto(null); }}
                style={{ display: "flex", alignItems: "flex-start", gap: 10, width: "100%", textAlign: "left", padding: "9px 10px", border: "none", borderRadius: 8,
                  background: vista === o.id ? "#EAF7F1" : "transparent", cursor: "pointer" }}
                onMouseEnter={e => { if (vista !== o.id) e.currentTarget.style.background = "#F7FCF9"; }}
                onMouseLeave={e => { if (vista !== o.id) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ fontSize: 16, lineHeight: "20px" }}>{o.icono}</span>
                <span><span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1a2e27" }}>{o.label}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#6B8F80" }}>{o.descripcion}</span></span>
              </button>))}
          </div>
        )}
      </div>
    );
  };

  const nombreUsuario = perfil?.nombre || perfil?.email || "Usuario";

  // Manual de usuario (antes estaba dentro de la pantalla de Despachos)
  const descargarManual = () => {
    const link = document.createElement("a");
    link.href = `${import.meta.env.BASE_URL}manual_portal_despachos.html`;
    link.download = "Manual_Portal_Despachos_Logistics_and_Services.html";
    link.click();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F7F9F8", fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #E2EDE9",
        padding: "0 16px", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: isMobile ? "wrap" : "nowrap", minHeight: 56, rowGap: 0, padding: isMobile ? "8px 0 0" : 0 }}>

          {/* Navegación de pestañas */}
          <nav style={{ display: "flex", gap: 4, alignItems: "center",
            ...(isMobile ? { order: 3, width: "100%", overflowX: "auto", padding: "8px 0 10px", scrollbarWidth: "none" } : {}) }}>
            {vistas.map(v => {
              const activo = vista === v.id;
              return (
                <React.Fragment key={v.id}>
                <button onClick={() => setVista(v.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: isMobile ? "6px 10px" : "7px 14px",
                    fontSize: isMobile ? 11 : 12, fontWeight: activo ? 700 : 500,
                    border: activo ? "1px solid #0F6E56" : "1px solid #E2EDE9",
                    borderRadius: 9, flexShrink: 0, whiteSpace: "nowrap",
                    background: activo ? "#0F6E56" : "#fff",
                    color: activo ? "#fff" : "#6B8F80",
                    cursor: "pointer",
                    transition: "all 0.18s",
                  }}
                  onMouseEnter={e => { if (!activo) { e.currentTarget.style.background = "#F2F8F5"; e.currentTarget.style.color = "#0F6E56"; e.currentTarget.style.borderColor = "#C5DDD4"; } }}
                  onMouseLeave={e => { if (!activo) { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#6B8F80"; e.currentTarget.style.borderColor = "#E2EDE9"; } }}
                >
                  <span style={{ color: activo ? "#fff" : "#9CB8AE" }}>{v.icon}</span>
                  {isMobile ? v.labelCorto : v.label}
                </button>
                {/* Maestros va después de Solicitudes */}
                {v.id === "solicitudes" && menuDesplegable("maestros", "Maestros", ICONO_MAESTROS, maestros, "Maestros · supervisor y administrador")}
                </React.Fragment>
              );
            })}
            {!vistas.some(v => v.id === "solicitudes") && menuDesplegable("maestros", "Maestros", ICONO_MAESTROS, maestros, "Maestros · supervisor y administrador")}
            {menuDesplegable("admon", "Admon", ICONO_ADMON, admon, "Administración · solo administrador")}
          </nav>

          {/* Usuario + regreso a la plataforma */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            {roles?.DESPACHOS && (
              <button onClick={descargarManual} title="Descargar manual de usuario"
                style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "6px 8px" : "7px 11px", fontSize: isMobile ? 11 : 12, fontWeight: 600,
                  border: "1px solid #E2EDE9", borderRadius: 9, color: "#0F6E56", background: "#fff", cursor: "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H3V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M13 2H8.5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5H13V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 4v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                {!isMobile && "Manual"}
              </button>
            )}
            <a href={PLATAFORMA_URL} title="Plataforma: volver a todas las aplicaciones" aria-label="Plataforma"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "6px 8px" : "7px 9px", fontSize: isMobile ? 11 : 12, fontWeight: 600,
                border: "1px solid #E2EDE9", borderRadius: 9, color: "#6B8F80", textDecoration: "none", background: "#fff" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/></svg>
            </a>
            {!isMobile && (
              <div style={{ textAlign: "right", lineHeight: 1.2, maxWidth: 160 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2e27", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreUsuario}</div>
                <div style={{ fontSize: 10, color: "#9CB8AE" }}>{Object.entries(roles || {}).filter(([k]) => k === "DESPACHOS" || k === "INVENTARIO").map(([k, r]) => `${k === "DESPACHOS" ? "Desp." : "Inv."}: ${r}`).join(" · ")}</div>
              </div>
            )}
            <button onClick={() => salir()} title="Cerrar sesión (cierra también NexusKPI)"
              style={{ padding: isMobile ? "6px 8px" : "7px 11px", fontSize: isMobile ? 11 : 12, fontWeight: 600, border: "1px solid #F5C6C0", borderRadius: 9, background: "#FFF5F5", color: "#C0392B", cursor: "pointer" }}>
              Salir
            </button>
          </div>
        </div>
      </div>

      {/* ── Contenido de la vista activa ── */}
      <div style={{ maxWidth: 1140, margin: "0 auto", padding: isMobile ? "16px 12px 0" : "24px 24px 0" }}>
        {vista === "despachos"  && <PortalDespachos isMobile={isMobile} />}
        {vista === "solicitudes" && <Solicitudes isMobile={isMobile} />}
        {vista === "inventario" && <InventarioPasillos isMobile={isMobile} />}
        {/* Menú Maestros (supervisor y administrador) */}
        {vista === "clientes"   && esSupervisor && <Clientes />}
        {vista === "articulos"  && esSupervisor && <Articulos />}
        {vista === "historico"  && <Historico />}
        {/* Menú Admon (solo administrador) */}
        {vista === "utilidades" && esAdmin && <Utilidades isMobile={isMobile} />}
        {vista === "parametros" && esAdmin && <ParametrosTomaPedido />}
        {vista === "admin_bd"   && esAdmin && <AdminBaseDatos />}
      </div>

    </div>
  );
}
