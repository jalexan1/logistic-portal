import React, { useState, useEffect } from "react";
import PortalDespachos from "./components/PortalDespachos";
import InventarioPasillos from "./components/InventarioPasillos";
import Utilidades from "./components/utilidades/Utilidades"; // ── NUEVO: módulo Utilidades
import Solicitudes from "./components/Solicitudes";
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
    label: "Portal de despachos",
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
    label: "Inventario de Pasillos",
    labelCorto: "Inventario",
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
  // ── NUEVO: Utilidades ──────────────────────────────────────────────────
  {
    id: "utilidades",
    label: "Utilidades",
    labelCorto: "Utilidades",
    requiere: ["DESPACHOS", "INVENTARIO"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M13.5 2.5L10 6l-1.5-1.5L12 1l1.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        <path d="M10 6 5.5 10.5A2.12 2.12 0 1 0 8 13L12.5 8.5 10 6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        <circle cx="4.5" cy="12.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
];

// ══════════════════════════════════════
// ── APP: Orquestador principal ──
// ══════════════════════════════════════
export default function App() {
  const isMobile = useIsMobile();
  const { perfil, roles, salir } = useAuth();

  // Solo las vistas permitidas por los accesos del usuario (core.accesos)
  const vistas = VISTAS.filter(v => v.requiere.some(app => roles?.[app]));
  const inicial = (() => {
    const pedida = new URLSearchParams(window.location.search).get("vista");
    return vistas.find(v => v.id === pedida)?.id || vistas[0]?.id;
  })();
  const [vista, setVista] = useState(inicial);

  const vistaActual = vistas.find(v => v.id === vista);
  const nombreUsuario = perfil?.nombre || perfil?.email || "Usuario";

  return (
    <div style={{ minHeight: "100vh", background: "#F7F9F8", fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #E2EDE9",
        padding: "0 16px", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: isMobile ? "wrap" : "nowrap", minHeight: 56, rowGap: 0, padding: isMobile ? "8px 0 0" : 0 }}>

          {/* Logo + nombre empresa */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="3" width="14" height="2" rx="1" fill="white"/>
                <rect x="2" y="8" width="14" height="2" rx="1" fill="white"/>
                <rect x="2" y="13" width="9" height="2" rx="1" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "#0F6E56", lineHeight: 1.2 }}>
                Logistics and Services
              </div>
              {!isMobile && (
                <div style={{ fontSize: 11, color: "#6B8F80" }}>
                  {vistaActual?.label}
                </div>
              )}
            </div>
          </div>

          {/* Navegación de pestañas */}
          <nav style={{ display: "flex", gap: 4, alignItems: "center",
            ...(isMobile ? { order: 3, width: "100%", overflowX: "auto", padding: "8px 0 10px", scrollbarWidth: "none" } : {}) }}>
            {vistas.map(v => {
              const activo = vista === v.id;
              return (
                <button key={v.id} onClick={() => setVista(v.id)}
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
              );
            })}
          </nav>

          {/* Usuario + regreso a la plataforma */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <a href={PLATAFORMA_URL} title="Volver a la plataforma (todas las aplicaciones)"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "6px 8px" : "7px 11px", fontSize: isMobile ? 11 : 12, fontWeight: 600,
                border: "1px solid #E2EDE9", borderRadius: 9, color: "#6B8F80", textDecoration: "none", background: "#fff" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/></svg>
              {!isMobile && "Plataforma"}
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
        {vista === "utilidades" && <Utilidades isMobile={isMobile} />} {/* ── NUEVO */}
      </div>

    </div>
  );
}
