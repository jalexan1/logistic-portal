// ── Solicitudes.jsx ──────────────────────────────────────────────────────
// Bandeja de solicitudes radicadas.
//  · solicitante → ve las suyas ("Mis solicitudes")
//  · operador / consulta / admin → ve todas las de su cuenta
//  · operador / admin → cambia estado (RADICADA → EN_ALISTAMIENTO → DESPACHADA → ENTREGADA / ANULADA)
// Lectura desde despachos.vw_solicitudes (RLS aplica según el rol).
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "./auth/authContext";
import {
  listarSolicitudes, obtenerLineas, obtenerEventos, listarTransiciones, cambiarEstado,
} from "../services/solicitudesService";
import { fechaHoraBogota, isoFechaBogota } from "../utils/fechas";

const ESTADO_UI = {
  RADICADA:        { label: "Radicada",        color: "#2563EB", bg: "#EFF6FF" },
  EN_ALISTAMIENTO: { label: "En alistamiento", color: "#B45309", bg: "#FFFBEB" },
  DESPACHADA:      { label: "Despachada",      color: "#7C3AED", bg: "#F5F3FF" },
  ENTREGADA:       { label: "Entregada",       color: "#0F6E56", bg: "#E1F5EE" },
  ANULADA:         { label: "Anulada",         color: "#C0392B", bg: "#FFF0EE" },
};

const hace = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return isoFechaBogota(d); };

export default function Solicitudes({ isMobile }) {
  const { roles } = useAuth();
  const rol = roles?.DESPACHOS;
  const puedeOperar = rol === "operador" || rol === "admin";
  const esSolicitante = rol === "solicitante";

  const [filtros, setFiltros] = useState({ desde: hace(30), hasta: isoFechaBogota(new Date()), estado: "", texto: "" });
  const [datos, setDatos]     = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError]     = useState("");
  const [abierta, setAbierta] = useState(null);     // id expandida
  const [detalle, setDetalle] = useState({});       // id → { lineas, eventos }
  const [transiciones, setTransiciones] = useState([]);
  const [accion, setAccion]   = useState(null);     // { sol, destino }
  const [comentario, setComentario] = useState("");
  const [toast, setToast]     = useState("");

  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setDatos(await listarSolicitudes(filtros)); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (puedeOperar) listarTransiciones().then(setTransiciones).catch(() => {}); }, [puedeOperar]);

  const abrir = async (sol) => {
    if (abierta === sol.id) { setAbierta(null); return; }
    setAbierta(sol.id);
    if (!detalle[sol.id]) {
      try {
        const [lineas, eventos] = await Promise.all([obtenerLineas(sol.id), obtenerEventos(sol.id)]);
        setDetalle(p => ({ ...p, [sol.id]: { lineas, eventos } }));
      } catch (e) { aviso("⚠ " + e.message); }
    }
  };

  const descargarExcel = async (sol) => {
    let lineas = detalle[sol.id]?.lineas;
    if (!lineas) { try { lineas = await obtenerLineas(sol.id); } catch (e) { aviso("⚠ " + e.message); return; } }
    const headers = ["Entrega","Destinat.","Nombre destinatario de mercancías","Lugar-destinatario","Material","Cantidad entrega","UM","item","bodega"];
    const rows = lineas.map(l => [l.entrega, l.destinatario_nit, l.destinatario_nombre, l.destinatario_ciudad, l.material, Number(l.cantidad), l.um, l.item, l.bodega]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, `despacho_${(sol.area_solicitante || "envio").replace(/\s+/g, "_")}_${sol.numero}.xlsx`);
  };

  const destinosDe = (estado) => transiciones.filter(t => t.estado_origen === estado).map(t => t.estado_destino);

  const confirmarAccion = async () => {
    const { sol, destino } = accion;
    if (destino === "ANULADA" && !comentario.trim()) { aviso("⚠ Escriba el motivo de anulación"); return; }
    try {
      await cambiarEstado({ solicitudId: sol.id, estadoNuevo: destino, version: sol.version, comentario });
      aviso(`✓ ${sol.numero} → ${ESTADO_UI[destino]?.label || destino}`);
      setAccion(null); setComentario("");
      setDetalle(p => { const n = { ...p }; delete n[sol.id]; return n; });
      if (abierta === sol.id) setAbierta(null);
      cargar();
    } catch (e) {
      aviso("⚠ " + e.message);
      if (/modificada por otro usuario/i.test(e.message)) { setAccion(null); cargar(); }
    }
  };

  const resumen = useMemo(() => {
    const r = { total: datos.length, lineas: 0, unidades: 0 };
    datos.forEach(d => { r.lineas += d.total_lineas; r.unidades += Number(d.total_unidades); });
    return r;
  }, [datos]);

  const campo = { height: 36, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>{esSolicitante ? "Mis solicitudes" : "Solicitudes radicadas"}</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>
            {resumen.total} solicitud{resumen.total !== 1 ? "es" : ""} · {resumen.lineas} líneas · {resumen.unidades.toLocaleString("es-CO")} unidades
          </div>
        </div>
        <button onClick={cargar} style={{ ...campo, cursor: "pointer", color: "#0F6E56", fontWeight: 600 }}>↻ Actualizar</button>
      </div>

      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, padding: isMobile ? 12 : "14px 18px", marginBottom: 14,
        display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 2fr", gap: 10 }}>
        <label style={lbl}>Desde<input type="date" value={filtros.desde} onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} style={campo} /></label>
        <label style={lbl}>Hasta<input type="date" value={filtros.hasta} onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} style={campo} /></label>
        <label style={lbl}>Estado
          <select value={filtros.estado} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))} style={campo}>
            <option value="">Todos</option>
            {Object.entries(ESTADO_UI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label style={{ ...lbl, gridColumn: isMobile ? "span 2" : "auto" }}>Buscar
          <input placeholder="N° solicitud, área, pedido o solicitante" defaultValue={filtros.texto}
            onKeyDown={e => { if (e.key === "Enter") setFiltros(f => ({ ...f, texto: e.target.value })); }}
            onBlur={e => setFiltros(f => (f.texto === e.target.value ? f : { ...f, texto: e.target.value }))} style={campo} />
        </label>
      </div>

      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#C0392B" }}>{error}</div>}

      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden" }}>
        {cargando && <div style={{ padding: 20, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
        {!cargando && datos.length === 0 && <div style={{ padding: 24, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>No hay solicitudes en el rango seleccionado.</div>}
        {!cargando && datos.map(sol => {
          const ui = ESTADO_UI[sol.estado_codigo] || { label: sol.estado_nombre, color: "#44574F", bg: "#F2F8F5" };
          const det = detalle[sol.id];
          const destinos = puedeOperar ? destinosDe(sol.estado_codigo) : [];
          return (
            <div key={sol.id} style={{ borderBottom: "1px solid #F0F7F4" }}>
              <div onClick={() => abrir(sol)} style={{ display: "grid", cursor: "pointer", alignItems: "center", gap: 10, padding: "11px 16px",
                gridTemplateColumns: isMobile ? "1fr auto" : "150px 120px 1fr 120px 90px 110px 24px", background: abierta === sol.id ? "#F7FCF9" : "#fff" }}>
                <div style={{ fontWeight: 700, color: "#0F6E56", fontSize: 13 }}>{sol.numero}
                  {isMobile && <div style={{ fontSize: 11, color: "#6B8F80", fontWeight: 400 }}>{fechaHoraBogota(sol.radicada_at)} · {sol.area_solicitante}</div>}
                </div>
                {!isMobile && <div style={{ fontSize: 12, color: "#44574F" }}>{fechaHoraBogota(sol.radicada_at)}</div>}
                {!isMobile && <div style={{ fontSize: 12, color: "#1a2e27", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sol.area_solicitante} · {sol.solicitante_nombre}{sol.numero_pedido_origen ? ` · Pedido ${sol.numero_pedido_origen}` : ""}</div>}
                {!isMobile && <div style={{ fontSize: 12, color: "#6B8F80" }}>{sol.origen === "PDF" ? "Desde PDF" : "Manual"}</div>}
                {!isMobile && <div style={{ fontSize: 12, color: "#44574F", textAlign: "right" }}>{sol.total_lineas} lín.</div>}
                <span style={{ fontSize: 11, fontWeight: 600, color: ui.color, background: ui.bg, padding: "3px 10px", borderRadius: 20, textAlign: "center", whiteSpace: "nowrap" }}>{ui.label}</span>
                {!isMobile && <span style={{ color: "#9CB8AE", transform: abierta === sol.id ? "rotate(180deg)" : "none", transition: "transform .2s", display: "inline-block" }}>▾</span>}
              </div>

              {abierta === sol.id && (
                <div style={{ padding: isMobile ? "4px 12px 14px" : "4px 16px 16px 16px", background: "#F7FCF9" }}>
                  {!det && <div style={{ fontSize: 12, color: "#6B8F80", padding: 8 }}>Cargando detalle…</div>}
                  {det && (
                    <>
                      <div style={{ overflowX: "auto", border: "1px solid #E2EDE9", borderRadius: 8, background: "#fff", marginBottom: 10 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
                          <thead><tr style={{ background: "#F2F8F5", color: "#6B8F80" }}>
                            {["#", "Entrega", "NIT", "Destinatario", "Ciudad", "Material", "Cantidad", "UM", "Bodega"].map(h => <th key={h} style={{ padding: "7px 8px", textAlign: h === "Cantidad" ? "right" : "left", fontWeight: 500 }}>{h}</th>)}
                          </tr></thead>
                          <tbody>{det.lineas.map(l => (
                            <tr key={l.linea_nro} style={{ borderTop: "1px solid #F0F7F4" }}>
                              <td style={td}>{l.linea_nro}</td><td style={td}>{l.entrega}</td><td style={td}>{l.destinatario_nit}</td>
                              <td style={td}>{l.destinatario_nombre}</td><td style={td}>{l.destinatario_ciudad}</td><td style={td}>{l.material}</td>
                              <td style={{ ...td, textAlign: "right" }}>{Number(l.cantidad).toLocaleString("es-CO")}</td><td style={td}>{l.um}</td><td style={td}>{l.bodega}</td>
                            </tr>))}</tbody>
                        </table>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: "#6B8F80", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>Línea de tiempo:</span>
                        {det.eventos.map((ev, i) => (
                          <span key={i} title={ev.comentario || ""} style={{ fontSize: 11, color: "#44574F", background: "#fff", border: "1px solid #E2EDE9", borderRadius: 20, padding: "2px 9px" }}>
                            {ESTADO_UI[ev.estado_nuevo]?.label || ev.estado_nuevo} · {fechaHoraBogota(ev.created_at)}
                          </span>))}
                      </div>
                      {sol.motivo_anulacion && <div style={{ fontSize: 12, color: "#C0392B", marginBottom: 10 }}>Motivo de anulación: {sol.motivo_anulacion}</div>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => descargarExcel(sol)} style={btnSec}>⬇ Descargar Excel</button>
                        {destinos.map(dst => (
                          <button key={dst} onClick={() => { setAccion({ sol, destino: dst }); setComentario(""); }}
                            style={dst === "ANULADA" ? { ...btnSec, color: "#C0392B", borderColor: "#F5C6C0" } : { ...btnSec, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" }}>
                            {dst === "ANULADA" ? "Anular" : `Pasar a ${ESTADO_UI[dst]?.label || dst}`}
                          </button>))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {accion && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, padding: "22px 24px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27", marginBottom: 6 }}>
              {accion.destino === "ANULADA" ? "Anular solicitud" : "Cambiar estado"} · {accion.sol.numero}
            </div>
            <div style={{ fontSize: 13, color: "#44574F", marginBottom: 12 }}>
              {ESTADO_UI[accion.sol.estado_codigo]?.label} → <b>{ESTADO_UI[accion.destino]?.label}</b>
            </div>
            <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3}
              placeholder={accion.destino === "ANULADA" ? "Motivo de anulación (obligatorio)" : "Comentario (opcional)"}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #D4E5DE", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setAccion(null)} style={btnSec}>Cancelar</button>
              <button onClick={confirmarAccion} style={{ ...btnSec, background: accion.destino === "ANULADA" ? "#C0392B" : "#0F6E56", color: "#fff", borderColor: "transparent" }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff",
        padding: "10px 20px", borderRadius: 24, fontSize: 13, fontWeight: 500, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}

const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 };
const td = { padding: "6px 8px", color: "#1a2e27" };
const btnSec = { padding: "7px 14px", fontSize: 12, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer" };
