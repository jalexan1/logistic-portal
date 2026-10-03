// ── Solicitudes.jsx ──────────────────────────────────────────────────────
// Bandeja de solicitudes radicadas.
//  · solicitante → ve las suyas ("Mis solicitudes")
//  · operador / consulta / admin → ve todas las de su cuenta
//
// Solo hay DOS estados: RADICADA → PROCESADA.
// PROCESAMIENTO POR BLOQUE (operador / admin):
//   1. Se marcan las solicitudes radicadas con la casilla de la derecha.
//   2. "Procesar bloque" abre la confirmación con el resumen.
//   3. Al confirmar, la base pasa TODAS a Procesada en una sola transacción
//      (todas o ninguna) y devuelve el número del bloque (LOT-AAAA-######).
//   4. Con ese número se genera UN solo Excel con las líneas de todo el bloque.
//   El bloque queda en "Bloques procesados" para volver a descargar su Excel;
//   un administrador puede revertirlo (las solicitudes vuelven a Radicada).
// Lectura desde despachos.vw_solicitudes (RLS aplica según el rol).
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "./auth/authContext";
import {
  listarSolicitudes, obtenerLineas, obtenerEventos,
  procesarLote, listarLotes, obtenerLineasLote, revertirLote, nuevaLlave,
} from "../services/solicitudesService";
import { fechaHoraBogota, isoFechaBogota } from "../utils/fechas";

// Estados vigentes (los que se pueden filtrar y asignar)
const ESTADO_UI = {
  RADICADA:  { label: "Radicada",  color: "#2563EB", bg: "#EFF6FF" },
  PROCESADA: { label: "Procesada", color: "#0F6E56", bg: "#E1F5EE" },
};
// Estados anteriores: solo para mostrar el historial de solicitudes viejas
const ESTADO_HISTORICO = {
  EN_ALISTAMIENTO: { label: "En alistamiento", color: "#6B7280", bg: "#F3F4F6" },
  DESPACHADA:      { label: "Despachada",      color: "#6B7280", bg: "#F3F4F6" },
  ENTREGADA:       { label: "Entregada",       color: "#6B7280", bg: "#F3F4F6" },
  ANULADA:         { label: "Anulada",         color: "#C0392B", bg: "#FFF0EE" },
};
const uiEstado = (codigo, nombre) =>
  ESTADO_UI[codigo] || ESTADO_HISTORICO[codigo] || { label: nombre || codigo, color: "#44574F", bg: "#F2F8F5" };

const hace = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return isoFechaBogota(d); };
const num = (n) => Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 });
const plural = (n, uno, varios) => `${num(n)} ${Number(n) === 1 ? uno : varios}`;

const HEADERS_PLANTILLA = ["Entrega","Destinat.","Nombre destinatario de mercancías","Lugar-destinatario","Material","Cantidad entrega","UM","item","bodega"];
const filaPlantilla = (l) => [l.entrega, l.destinatario_nit, l.destinatario_nombre, l.destinatario_ciudad, l.material, Number(l.cantidad), l.um, l.item, l.bodega];
const COLS_PLANTILLA = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];

// ── Excel consolidado del bloque ──────────────────────────────────────────
// Hoja 1 "Plantilla": mismas 9 columnas de siempre, con TODAS las líneas del bloque.
// Hoja 2 "Solicitudes del bloque": qué solicitudes entraron y sus totales.
// Hoja 3 "Detalle": cada línea con el número de su solicitud (trazabilidad).
function generarExcelLote(lote, lineas) {
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet([HEADERS_PLANTILLA, ...lineas.map(filaPlantilla)]);
  ws1["!cols"] = COLS_PLANTILLA;
  XLSX.utils.book_append_sheet(wb, ws1, "Plantilla");

  const porSol = new Map();
  lineas.forEach(l => {
    const s = porSol.get(l.solicitud_id) || { ...l, lineas: 0, unidades: 0 };
    s.lineas += 1; s.unidades += Number(l.cantidad);
    porSol.set(l.solicitud_id, s);
  });
  const sols = [...porSol.values()];
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["Bloque", lote.numero],
    ["Procesado el", fechaHoraBogota(lote.procesadoAt)],
    ["Procesado por", lote.procesadoPor || ""],
    ["Comentario", lote.comentario || ""],
    ["Solicitudes", sols.length],
    ["Líneas", lineas.length],
    ["Unidades", sols.reduce((a, s) => a + s.unidades, 0)],
    [],
    ["N° solicitud", "Radicada el", "Área", "Solicitante", "Origen", "Pedido origen", "Líneas", "Unidades"],
    ...sols.map(s => [s.solicitud_numero, fechaHoraBogota(s.radicada_at), s.area_solicitante, s.solicitante_nombre,
      s.origen === "PDF" ? "PDF" : "Manual", s.numero_pedido_origen || "", s.lineas, s.unidades]),
  ]);
  ws2["!cols"] = [{wch:18},{wch:18},{wch:20},{wch:28},{wch:10},{wch:16},{wch:9},{wch:11}];
  XLSX.utils.book_append_sheet(wb, ws2, "Solicitudes del bloque");

  const ws3 = XLSX.utils.aoa_to_sheet([
    ["N° solicitud", "Línea", ...HEADERS_PLANTILLA],
    ...lineas.map(l => [l.solicitud_numero, l.linea_nro, ...filaPlantilla(l)]),
  ]);
  ws3["!cols"] = [{wch:18},{wch:7}, ...COLS_PLANTILLA];
  XLSX.utils.book_append_sheet(wb, ws3, "Detalle");

  XLSX.writeFile(wb, `despachos_bloque_${lote.numero}.xlsx`);
}

// Casilla de selección. Se dibuja a mano porque index.css quita la apariencia
// nativa de los <input> (appearance: none): un checkbox normal quedaría invisible.
// El <input> real sigue ahí (oculto) para teclado y lectores de pantalla.
function Casilla({ marcada, parcial = false, deshabilitada = false, onChange, titulo }) {
  const ref = useRef(null);
  const mixta = parcial && !marcada;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixta; }, [mixta]);
  const activa = marcada || mixta;
  return (
    <label title={titulo} onClick={e => e.stopPropagation()}
      style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8,
        cursor: deshabilitada ? "not-allowed" : "pointer", opacity: deshabilitada ? 0.35 : 1 }}>
      <input ref={ref} type="checkbox" checked={marcada} disabled={deshabilitada} onChange={e => onChange(e.target.checked)}
        aria-label={titulo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, margin: 0, cursor: "inherit" }} />
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 6, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center",
        border: `2px solid ${activa ? "#0F6E56" : deshabilitada ? "#C9D6D0" : "#8FB3A6"}`, background: activa ? "#0F6E56" : deshabilitada ? "#F2F4F3" : "#fff", transition: "background .12s, border-color .12s" }}>
        {marcada && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        {mixta && <span style={{ width: 10, height: 2, borderRadius: 2, background: "#fff" }} />}
      </span>
    </label>
  );
}

export default function Solicitudes({ isMobile }) {
  const { roles, perfil } = useAuth();
  const rol = roles?.DESPACHOS;
  const puedeOperar = rol === "operador" || rol === "admin";
  const esAdmin = rol === "admin";
  const esSolicitante = rol === "solicitante";
  const veBloques = !esSolicitante;

  // Quien procesa abre la bandeja en "Radicada": lo pendiente por procesar
  const [filtros, setFiltros] = useState({ desde: hace(30), hasta: isoFechaBogota(new Date()), estado: puedeOperar ? "RADICADA" : "", texto: "" });
  const [datos, setDatos]     = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError]     = useState("");
  const [abierta, setAbierta] = useState(null);     // id expandida
  const [detalle, setDetalle] = useState({});       // id → { lineas, eventos }
  const [toast, setToast]     = useState("");

  // Selección para el bloque
  const [sel, setSel] = useState(() => new Set());
  // Ventana del bloque: { fase: 'confirmar' | 'procesando' | 'listo', items, lote?, lineas?, avisoExcel? }
  const [bloque, setBloque] = useState(null);
  const [comentario, setComentario] = useState("");
  const llaveRef = useRef(null);                    // misma llave en reintentos → no duplica el bloque

  // Bloques procesados
  const [verLotes, setVerLotes] = useState(false);
  const [lotes, setLotes]       = useState([]);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [bajando, setBajando]   = useState(null);
  const [reversion, setReversion] = useState(null); // lote a revertir
  const [motivo, setMotivo]     = useState("");
  const [revirtiendo, setRevirtiendo] = useState(false);

  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 4000); };

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const filas = await listarSolicitudes({ ...filtros, limite: 500 });
      setDatos(filas);
      // La selección solo conserva lo que sigue visible y Radicado
      const vigentes = new Set(filas.filter(f => f.estado_codigo === "RADICADA").map(f => f.id));
      setSel(prev => new Set([...prev].filter(id => vigentes.has(id))));
    }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [filtros]);

  const cargarLotes = useCallback(async () => {
    if (!veBloques) return;
    setCargandoLotes(true);
    try { setLotes(await listarLotes({ desde: filtros.desde, hasta: filtros.hasta })); }
    catch (e) { aviso("⚠ " + e.message); }
    finally { setCargandoLotes(false); }
  }, [filtros.desde, filtros.hasta, veBloques]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (verLotes) cargarLotes(); }, [verLotes, cargarLotes]);

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
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([HEADERS_PLANTILLA, ...lineas.map(filaPlantilla)]);
    ws["!cols"] = COLS_PLANTILLA;
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, `despacho_${(sol.area_solicitante || "envio").replace(/\s+/g, "_")}_${sol.numero}.xlsx`);
  };

  // ── Selección ──
  const seleccionables = useMemo(() => datos.filter(d => d.estado_codigo === "RADICADA"), [datos]);
  const seleccionadas  = useMemo(() => datos.filter(d => sel.has(d.id)), [datos, sel]);
  const todasMarcadas  = seleccionables.length > 0 && seleccionadas.length === seleccionables.length;
  const totalSel = useMemo(() => ({
    lineas: seleccionadas.reduce((a, s) => a + Number(s.total_lineas || 0), 0),
    unidades: seleccionadas.reduce((a, s) => a + Number(s.total_unidades || 0), 0),
  }), [seleccionadas]);

  const marcar = (id, on) => setSel(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const marcarTodas = (on) => setSel(on ? new Set(seleccionables.map(s => s.id)) : new Set());

  // ── Bloque ──
  const abrirBloque = (items) => {
    if (!items.length) return;
    llaveRef.current = nuevaLlave();
    setComentario("");
    setBloque({ fase: "confirmar", items });
  };

  const cerrarBloque = () => {
    if (bloque?.fase === "procesando") return;
    setBloque(null);
  };

  const confirmarBloque = async () => {
    const items = bloque.items;
    setBloque(b => ({ ...b, fase: "procesando" }));
    // 1) La base procesa el bloque (todas o ninguna). Si falla, NO se genera Excel.
    let lote;
    try {
      const r = await procesarLote({ llave: llaveRef.current, solicitudIds: items.map(i => i.id), comentario });
      lote = { id: r.id, numero: r.numero, procesadoAt: r.procesadoAt, comentario: comentario.trim(),
        procesadoPor: perfil?.nombre || perfil?.email || "",
        totalSolicitudes: r.totalSolicitudes, totalLineas: r.totalLineas, totalUnidades: r.totalUnidades };
    } catch (e) {
      aviso("⚠ " + e.message);
      setBloque(b => ({ ...b, fase: "confirmar" }));
      // Otro usuario ya procesó alguna: se refresca la lista para que la selección quede al día
      if (/ya no están Radicadas|no existen/i.test(e.message)) { setBloque(null); cargar(); }
      return;
    }
    // 2) Excel único con el número oficial del bloque
    let lineas = null, avisoExcel = "";
    try { lineas = await obtenerLineasLote(lote.id); generarExcelLote(lote, lineas); }
    catch (e) { avisoExcel = "El bloque quedó procesado, pero no se pudo generar el Excel: " + e.message; }
    setBloque({ fase: "listo", items, lote, lineas, avisoExcel });
    setSel(new Set());
    setDetalle({}); setAbierta(null);
    cargar();
    if (verLotes) cargarLotes();
  };

  const redescargarBloque = async () => {
    try {
      const lineas = bloque.lineas || await obtenerLineasLote(bloque.lote.id);
      generarExcelLote(bloque.lote, lineas);
      setBloque(b => ({ ...b, lineas, avisoExcel: "" }));
    } catch (e) { aviso("⚠ " + e.message); }
  };

  const descargarLote = async (l) => {
    setBajando(l.id);
    try {
      const lineas = await obtenerLineasLote(l.id);
      if (!lineas.length) { aviso("⚠ Este bloque no tiene líneas disponibles."); return; }
      generarExcelLote({ id: l.id, numero: l.numero, procesadoAt: l.procesado_at, procesadoPor: l.procesado_por, comentario: l.comentario }, lineas);
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setBajando(null); }
  };

  const confirmarReversion = async () => {
    if (!motivo.trim()) { aviso("⚠ Escriba el motivo de la reversión"); return; }
    setRevirtiendo(true);
    try {
      const r = await revertirLote({ loteId: reversion.id, motivo });
      aviso(`✓ ${reversion.numero} revertido: ${plural(r?.solicitudes_revertidas, "solicitud volvió", "solicitudes volvieron")} a Radicada`);
      setReversion(null); setMotivo("");
      setDetalle({}); setAbierta(null);
      cargar(); cargarLotes();
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setRevirtiendo(false); }
  };

  const resumen = useMemo(() => {
    const r = { total: datos.length, lineas: 0, unidades: 0 };
    datos.forEach(d => { r.lineas += d.total_lineas; r.unidades += Number(d.total_unidades); });
    return r;
  }, [datos]);

  const campo = { height: 36, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box" };
  const colsFila = isMobile
    ? (puedeOperar ? "1fr auto 32px" : "1fr auto")
    : (puedeOperar ? "150px 120px 1fr 100px 80px 110px 20px 32px" : "150px 120px 1fr 100px 80px 110px 20px");

  return (
    <div style={{ paddingBottom: sel.size > 0 ? 110 : 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>{esSolicitante ? "Mis solicitudes" : "Solicitudes radicadas"}</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>
            {plural(resumen.total, "solicitud", "solicitudes")} · {plural(resumen.lineas, "línea", "líneas")} · {num(resumen.unidades)} unidades
          </div>
        </div>
        <button onClick={() => { cargar(); if (verLotes) cargarLotes(); }} style={{ ...campo, cursor: "pointer", color: "#0F6E56", fontWeight: 600 }}>↻ Actualizar</button>
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
        {/* Encabezado de la lista: "marcar todas" a la derecha */}
        {puedeOperar && !cargando && datos.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "6px 16px", background: "#F7FCF9", borderBottom: "1px solid #E2EDE9" }}>
            <span style={{ fontSize: 11, color: "#6B8F80" }}>
              {seleccionables.length === 0
                ? "No hay solicitudes Radicadas en esta lista"
                : sel.size > 0 ? `${sel.size} de ${seleccionables.length} radicadas marcadas` : `Marcar las ${seleccionables.length} radicadas`}
            </span>
            <Casilla marcada={todasMarcadas} parcial={sel.size > 0} deshabilitada={seleccionables.length === 0}
              onChange={marcarTodas} titulo="Marcar o desmarcar todas las solicitudes Radicadas de la lista" />
          </div>
        )}

        {cargando && <div style={{ padding: 20, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
        {!cargando && datos.length === 0 && <div style={{ padding: 24, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>
          {filtros.estado === "RADICADA" ? "No hay solicitudes Radicadas pendientes en el rango seleccionado." : "No hay solicitudes en el rango seleccionado."}
        </div>}
        {!cargando && datos.map(sol => {
          const ui = uiEstado(sol.estado_codigo, sol.estado_nombre);
          const det = detalle[sol.id];
          const esRadicada = sol.estado_codigo === "RADICADA";
          const marcada = sel.has(sol.id);
          return (
            <div key={sol.id} style={{ borderBottom: "1px solid #F0F7F4" }}>
              <div onClick={() => abrir(sol)} style={{ display: "grid", cursor: "pointer", alignItems: "center", gap: 10, padding: "8px 16px",
                gridTemplateColumns: colsFila, background: marcada ? "#EAF7F1" : abierta === sol.id ? "#F7FCF9" : "#fff" }}>
                <div style={{ fontWeight: 700, color: "#0F6E56", fontSize: 13 }}>{sol.numero}
                  {isMobile && <div style={{ fontSize: 11, color: "#6B8F80", fontWeight: 400 }}>{fechaHoraBogota(sol.radicada_at)} · {sol.area_solicitante}</div>}
                </div>
                {!isMobile && <div style={{ fontSize: 12, color: "#44574F" }}>{fechaHoraBogota(sol.radicada_at)}</div>}
                {!isMobile && <div style={{ fontSize: 12, color: "#1a2e27", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sol.area_solicitante} · {sol.solicitante_nombre}{sol.numero_pedido_origen ? ` · Pedido ${sol.numero_pedido_origen}` : ""}</div>}
                {!isMobile && <div style={{ fontSize: 12, color: "#6B8F80" }}>{sol.origen === "PDF" ? "Desde PDF" : "Manual"}</div>}
                {!isMobile && <div style={{ fontSize: 12, color: "#44574F", textAlign: "right" }}>{sol.total_lineas} lín.</div>}
                <span title={sol.lote_numero ? `Bloque ${sol.lote_numero}` : ""} style={{ fontSize: 11, fontWeight: 600, color: ui.color, background: ui.bg, padding: "3px 10px", borderRadius: 20, textAlign: "center", whiteSpace: "nowrap" }}>{ui.label}</span>
                {!isMobile && <span style={{ color: "#9CB8AE", transform: abierta === sol.id ? "rotate(180deg)" : "none", transition: "transform .2s", display: "inline-block" }}>▾</span>}
                {puedeOperar && (
                  <Casilla marcada={marcada} deshabilitada={!esRadicada} onChange={on => marcar(sol.id, on)}
                    titulo={esRadicada ? `Marcar ${sol.numero} para procesar` : `${sol.numero} ya está ${ui.label}`} />
                )}
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
                            {uiEstado(ev.estado_nuevo).label} · {fechaHoraBogota(ev.created_at)}
                          </span>))}
                        {sol.lote_numero && <span style={{ fontSize: 11, fontWeight: 600, color: "#0F6E56", background: "#E1F5EE", borderRadius: 20, padding: "2px 9px" }}>Bloque {sol.lote_numero}</span>}
                      </div>
                      {sol.motivo_anulacion && <div style={{ fontSize: 12, color: "#C0392B", marginBottom: 10 }}>Motivo de anulación: {sol.motivo_anulacion}</div>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => descargarExcel(sol)} style={btnSec}>⬇ Descargar Excel de esta solicitud</button>
                        {puedeOperar && esRadicada && (
                          <button onClick={() => abrirBloque([sol])} style={{ ...btnSec, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" }}>Procesar solo esta</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Bloques procesados (historial + re-descarga) ── */}
      {veBloques && (
        <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden", marginTop: 14 }}>
          <div onClick={() => setVerLotes(v => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", cursor: "pointer", background: verLotes ? "#F7FCF9" : "#fff" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>Bloques procesados</div>
              <div style={{ fontSize: 11, color: "#6B8F80" }}>Cada bloque guarda su Excel consolidado · mismo rango de fechas de los filtros</div>
            </div>
            <span style={{ ...btnSec, padding: "6px 12px" }}>{verLotes ? "Ocultar" : "Mostrar"}</span>
          </div>
          {verLotes && (
            <div style={{ borderTop: "1px solid #E2EDE9", overflowX: "auto" }}>
              {cargandoLotes && <div style={{ padding: 16, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
              {!cargandoLotes && lotes.length === 0 && <div style={{ padding: 20, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>No hay bloques procesados en el rango seleccionado.</div>}
              {!cargandoLotes && lotes.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 760 }}>
                  <thead><tr style={{ background: "#F7FCF9", color: "#6B8F80" }}>
                    {["Bloque", "Procesado el", "Por", "Solicitudes", "Líneas", "Unidades", "Comentario", ""].map((h, i) => (
                      <th key={i} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i >= 3 && i <= 5 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>))}
                  </tr></thead>
                  <tbody>{lotes.map(l => {
                    const revertido = Boolean(l.revertido_at);
                    return (
                      <tr key={l.id} style={{ borderTop: "1px solid #F0F7F4", opacity: revertido ? 0.6 : 1 }}>
                        <td style={{ ...tdL, fontWeight: 700, color: "#0F6E56" }}>{l.numero}</td>
                        <td style={tdL}>{fechaHoraBogota(l.procesado_at)}</td>
                        <td style={tdL}>{l.procesado_por}</td>
                        <td style={{ ...tdL, textAlign: "right" }}>{num(l.total_solicitudes)}</td>
                        <td style={{ ...tdL, textAlign: "right" }}>{num(l.total_lineas)}</td>
                        <td style={{ ...tdL, textAlign: "right" }}>{num(l.total_unidades)}</td>
                        <td style={{ ...tdL, whiteSpace: "normal", maxWidth: 240, color: revertido ? "#C0392B" : "#44574F" }}>
                          {revertido ? `Revertido el ${fechaHoraBogota(l.revertido_at)}: ${l.motivo_reversion}` : (l.comentario || "")}
                        </td>
                        <td style={{ ...tdL, textAlign: "right" }}>
                          {!revertido && (
                            <span style={{ display: "inline-flex", gap: 6 }}>
                              <button onClick={() => descargarLote(l)} disabled={bajando === l.id} style={{ ...btnSec, padding: "5px 10px", fontSize: 11 }}>{bajando === l.id ? "…" : "⬇ Excel"}</button>
                              {esAdmin && <button onClick={() => { setReversion(l); setMotivo(""); }} style={{ ...btnSec, padding: "5px 10px", fontSize: 11, color: "#C0392B", borderColor: "#F5C6C0" }}>Revertir</button>}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Barra de acción del bloque (aparece al marcar) ── */}
      {puedeOperar && sel.size > 0 && !bloque && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 14, zIndex: 900, display: "flex", justifyContent: "center", padding: "0 12px", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center",
            background: "#1a2e27", color: "#fff", borderRadius: 14, padding: "10px 14px 10px 18px", boxShadow: "0 10px 30px rgba(10,30,24,0.35)", maxWidth: "100%" }}>
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{plural(sel.size, "solicitud marcada", "solicitudes marcadas")}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>{plural(totalSel.lineas, "línea", "líneas")} · {num(totalSel.unidades)} unidades</div>
            </div>
            <button onClick={() => setSel(new Set())} style={{ height: 36, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.3)", borderRadius: 9, background: "transparent", color: "#fff", cursor: "pointer" }}>Quitar marcas</button>
            <button onClick={() => abrirBloque(seleccionadas)} style={{ height: 36, padding: "0 16px", fontSize: 13, fontWeight: 700, border: "none", borderRadius: 9, background: "#34D399", color: "#06281E", cursor: "pointer" }}>Procesar bloque y generar Excel</button>
          </div>
        </div>
      )}

      {/* ── Ventana del bloque ── */}
      {bloque && (
        <div onClick={cerrarBloque} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {bloque.fase !== "listo" ? (
              <>
                <div style={{ padding: "18px 22px 12px" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2e27" }}>Procesar {plural(bloque.items.length, "solicitud", "solicitudes")}</div>
                  <div style={{ fontSize: 12.5, color: "#44574F", marginTop: 4 }}>
                    Pasarán de <b>Radicada</b> a <b>Procesada</b> y se descargará <b>un solo Excel</b> con todas sus líneas.
                  </div>
                </div>
                <div style={{ margin: "0 22px", border: "1px solid #E2EDE9", borderRadius: 10, overflowY: "auto", flex: "0 1 260px", minHeight: 60 }}>
                  {bloque.items.map(s => (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 10, alignItems: "center", padding: "7px 12px", borderBottom: "1px solid #F0F7F4", fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: "#0F6E56" }}>{s.numero}</span>
                      <span style={{ color: "#44574F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.area_solicitante} · {s.solicitante_nombre}</span>
                      <span style={{ color: "#6B8F80", whiteSpace: "nowrap" }}>{s.total_lineas} lín. · {num(s.total_unidades)} und.</span>
                    </div>))}
                </div>
                <div style={{ padding: "12px 22px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[[bloque.items.length, "Solicitudes"], [bloque.items.reduce((a, s) => a + Number(s.total_lineas), 0), "Líneas"], [bloque.items.reduce((a, s) => a + Number(s.total_unidades), 0), "Unidades"]].map(([v, t]) => (
                    <div key={t} style={{ flex: 1, minWidth: 110, background: "#F2F8F5", borderRadius: 10, padding: "8px 12px" }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: "#0F6E56" }}>{num(v)}</div>
                      <div style={{ fontSize: 10, color: "#6B8F80", textTransform: "uppercase", letterSpacing: ".06em" }}>{t}</div>
                    </div>))}
                </div>
                <div style={{ padding: "12px 22px 0" }}>
                  <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2} disabled={bloque.fase === "procesando"}
                    placeholder="Comentario del bloque (opcional). Ej.: turno de la mañana, ola 2…"
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #D4E5DE", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "14px 22px 18px" }}>
                  <button onClick={cerrarBloque} disabled={bloque.fase === "procesando"} style={btnSec}>Cancelar</button>
                  <button onClick={confirmarBloque} disabled={bloque.fase === "procesando"}
                    style={{ ...btnSec, background: bloque.fase === "procesando" ? "#6FA895" : "#0F6E56", color: "#fff", borderColor: "transparent", cursor: bloque.fase === "procesando" ? "wait" : "pointer", padding: "9px 18px" }}>
                    {bloque.fase === "procesando" ? "Procesando…" : "Confirmar y descargar Excel"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: "#0F6E56", padding: "22px 24px", color: "#fff", textAlign: "center" }}>
                  <div style={{ fontSize: 12, opacity: 0.8, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600 }}>Bloque procesado</div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{bloque.lote.numero}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 6 }}>
                    {plural(bloque.lote.totalSolicitudes, "solicitud", "solicitudes")} · {plural(bloque.lote.totalLineas, "línea", "líneas")} · {num(bloque.lote.totalUnidades)} unidades
                  </div>
                </div>
                <div style={{ padding: "16px 24px 20px" }}>
                  {bloque.avisoExcel
                    ? <div style={{ fontSize: 12.5, color: "#B45309", background: "#FFFBEB", border: "1px solid #FCD9A0", borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>⚠ {bloque.avisoExcel}</div>
                    : <div style={{ fontSize: 12.5, color: "#44574F", marginBottom: 12, textAlign: "center" }}>El Excel <b>despachos_bloque_{bloque.lote.numero}.xlsx</b> se descargó en su equipo. Puede volver a descargarlo desde «Bloques procesados».</div>}
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={redescargarBloque} style={btnSec}>⬇ Descargar Excel de nuevo</button>
                    <button onClick={() => setBloque(null)} style={{ ...btnSec, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56", padding: "7px 22px" }}>Cerrar</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Revertir bloque (solo admin) ── */}
      {reversion && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, padding: "22px 24px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27", marginBottom: 6 }}>Revertir bloque {reversion.numero}</div>
            <div style={{ fontSize: 13, color: "#44574F", marginBottom: 12 }}>
              Sus {plural(reversion.total_solicitudes, "solicitud volverá", "solicitudes volverán")} a <b>Radicada</b> y el bloque quedará anulado. El cambio queda en la línea de tiempo.
            </div>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Motivo de la reversión (obligatorio)"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #D4E5DE", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setReversion(null)} disabled={revirtiendo} style={btnSec}>Cancelar</button>
              <button onClick={confirmarReversion} disabled={revirtiendo} style={{ ...btnSec, background: "#C0392B", color: "#fff", borderColor: "transparent" }}>{revirtiendo ? "Revirtiendo…" : "Revertir bloque"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: "fixed", bottom: sel.size > 0 ? 84 : 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff",
        padding: "10px 20px", borderRadius: 24, fontSize: 13, fontWeight: 500, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}

const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 };
const td = { padding: "6px 8px", color: "#1a2e27" };
const tdL = { padding: "8px 10px", color: "#1a2e27", whiteSpace: "nowrap" };
const btnSec = { padding: "7px 14px", fontSize: 12, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer" };
