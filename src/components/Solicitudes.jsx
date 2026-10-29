// ── Solicitudes.jsx ──────────────────────────────────────────────────────
// Bandeja de solicitudes radicadas.
// Fase 4: UNA FILA POR LÍNEA con todos los campos de "Excel desde PDF"
// (fecha, área, solicitante, correo, entrega, NIT, nombre, dirección, ciudad,
// departamento, teléfono, SKU, EAN, cantidad, UM, ítem, bodega…), filtros por
// columna (con comodín *) y paginación 5/10/15/30/50/80/150 (arranca en 10).
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
// Lectura desde despachos.vw_solicitud_lineas (RLS aplica según el rol).
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useAuth } from "./auth/authContext";
import {
  listarLineasSolicitudes, obtenerEventos,
  procesarLote, listarLotes, obtenerLineasLote, revertirLote, nuevaLlave,
} from "../services/solicitudesService";
import { COLUMNAS_LINEAS, filtrarLineas, valorCelda } from "../utils/tablaLineas";
import Paginador from "./Paginador";
import AdjuntosBoton from "./AdjuntosBoton";
import { listarAdjuntos } from "../services/adjuntosService";
import { fechaHoraBogota, isoFechaBogota } from "../utils/fechas";
import { descargarExcelBloque } from "../services/excelDespachoService";
import { cargarParametros, diasRango, PARAMETROS_DEFECTO } from "../services/parametrosService";

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

const num = (n) => Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 });
const plural = (n, uno, varios) => `${num(n)} ${Number(n) === 1 ? uno : varios}`;

// ── Excel consolidado del bloque (fase 7) ────────────────────────────────
// UN archivo despachos_bloque_<LOT>.xlsx con 4 hojas:
//   DESPACHO · CARGA A WMS · CARGA LIBRO 1 · TABLERO CONTROL
function generarExcelLote(lote, lineasBase) {
  descargarExcelBloque(lote.numero, lineasBase);
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
  // Fase 7: arranca SOLO con el día de hoy. Máximo N días (parámetro); más → Histórico.
  const [filtros, setFiltros] = useState({ desde: isoFechaBogota(new Date()), hasta: isoFechaBogota(new Date()), estado: puedeOperar ? "RADICADA" : "" });
  const [maxDias, setMaxDias] = useState(PARAMETROS_DEFECTO.solicitudes_rango_max_dias);
  useEffect(() => { cargarParametros().then(p => setMaxDias(Number(p.solicitudes_rango_max_dias) || 7)).catch(() => {}); }, []);
  const [datos, setDatos]     = useState([]);       // UNA FILA POR LÍNEA (vw_solicitud_lineas)
  const [cargando, setCargando] = useState(false);
  const [error, setError]     = useState("");
  const [toast, setToast]     = useState("");
  const [historial, setHistorial] = useState(null); // { sol, eventos | null }

  // Filtros por columna + paginación (5, 10, 15, 30, 50, 80, 150 · arranca en 10)
  const [filtrosCol, setFiltrosCol] = useState({});
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);

  // Selección para el bloque (ids de solicitud)
  const [sel, setSel] = useState(() => new Set());
  // Ventana del bloque: { fase: 'confirmar' | 'procesando' | 'listo', items, lote?, lineas?, avisoExcel? }
  const [bloque, setBloque] = useState(null);
  const [comentario, setComentario] = useState("");
  const llaveRef = useRef(null);                    // misma llave en reintentos → no duplica el bloque

  // Bloques procesados
  const [verLotes, setVerLotes] = useState(false);
  const [lotes, setLotes]       = useState([]);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [bajandoLote, setBajandoLote] = useState(null);
  const [reversion, setReversion] = useState(null); // lote a revertir
  const [motivo, setMotivo]     = useState("");
  const [revirtiendo, setRevirtiendo] = useState(false);

  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 4000); };
  const rangoInvalido = Boolean(filtros.desde && filtros.hasta && filtros.desde > filtros.hasta);
  const rangoExcedido = !rangoInvalido && Boolean(filtros.desde && filtros.hasta) && diasRango(filtros.desde, filtros.hasta) > maxDias;
  const msgExcedido = `Esta pantalla consulta máximo ${maxDias} días. Para consultas de más de ${maxDias} días use la pantalla Histórico (menú «Histórico»).`;

  const cargar = useCallback(async () => {
    if (rangoInvalido) { setDatos([]); setError("La fecha «Desde» no puede ser posterior a «Hasta»."); return; }
    if (rangoExcedido) { setDatos([]); setError(msgExcedido); return; }
    setCargando(true); setError("");
    try {
      const filas = await listarLineasSolicitudes({ desde: filtros.desde, hasta: filtros.hasta, estado: filtros.estado });
      // 28-oct: columna Adjunto → adjuntos vigentes de cada solicitud (una consulta por cada 200 solicitudes)
      let adj = {};
      try { adj = await listarAdjuntos(filas.map(f => f.solicitud_id)); } catch { adj = {}; }
      filas.forEach(f => { f.adjuntos = adj[f.solicitud_id] || []; });
      setDatos(filas); setPagina(1);
      // La selección solo conserva lo que sigue visible y Radicado
      const vigentes = new Set(filas.filter(f => f.estado_codigo === "RADICADA").map(f => f.solicitud_id));
      setSel(prev => new Set([...prev].filter(id => vigentes.has(id))));
    }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [filtros, rangoInvalido, rangoExcedido, msgExcedido]);

  const cargarLotes = useCallback(async () => {
    if (!veBloques || rangoInvalido || rangoExcedido) { setLotes([]); return; }
    setCargandoLotes(true);
    try { setLotes(await listarLotes({ desde: filtros.desde, hasta: filtros.hasta })); }
    catch (e) { aviso("⚠ " + e.message); }
    finally { setCargandoLotes(false); }
  }, [filtros.desde, filtros.hasta, veBloques, rangoInvalido, rangoExcedido]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (verLotes) cargarLotes(); }, [verLotes, cargarLotes]);

  // ── Solicitudes (encabezados) armadas desde las líneas ──
  const solicitudes = useMemo(() => {
    const m = new Map();
    datos.forEach(l => {
      const s = m.get(l.solicitud_id) || {
        id: l.solicitud_id, numero: l.numero, estado_codigo: l.estado_codigo, estado_nombre: l.estado_nombre,
        area_solicitante: l.area_solicitante, solicitante_nombre: l.solicitante_nombre, solicitante_correo: l.solicitante_correo,
        radicada_at: l.radicada_at, origen: l.origen, lote_numero: l.lote_numero, total_lineas: 0, total_unidades: 0,
      };
      s.total_lineas += 1; s.total_unidades += Number(l.cantidad || 0);
      m.set(l.solicitud_id, s);
    });
    return m;
  }, [datos]);

  // ── Filtros por columna y página visible ──
  const filtradas = useMemo(() => filtrarLineas(datos, filtrosCol), [datos, filtrosCol]);
  const hayFiltrosCol = Object.values(filtrosCol).some(v => String(v || "").trim());
  // Al cambiar filtros, filas por página o datos se vuelve a la página 1
  const filtrarCol = (key, valor) => { setFiltrosCol(f => ({ ...f, [key]: valor })); setPagina(1); };
  const cambiarPorPagina = (n) => { setPorPagina(n); setPagina(1); };
  const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaActual = Math.min(pagina, paginas);
  const visibles = useMemo(
    () => filtradas.slice((paginaActual - 1) * porPagina, paginaActual * porPagina),
    [filtradas, paginaActual, porPagina]);

  const resumen = useMemo(() => ({
    solicitudes: new Set(filtradas.map(f => f.solicitud_id)).size,
    lineas: filtradas.length,
    unidades: filtradas.reduce((a, f) => a + Number(f.cantidad || 0), 0),
  }), [filtradas]);

  const verHistorial = async (solicitudId) => {
    const sol = solicitudes.get(solicitudId);
    setHistorial({ sol, eventos: null });
    try { const eventos = await obtenerEventos(solicitudId); setHistorial({ sol, eventos }); }
    catch (e) { setHistorial(null); aviso("⚠ " + e.message); }
  };

  // ── Selección (por solicitud: marcar una línea marca toda su solicitud) ──
  // "Marcar todas" toma las Radicadas que cumplen los filtros, en TODAS las páginas.
  const seleccionables = useMemo(() => {
    const ids = new Set(filtradas.filter(f => f.estado_codigo === "RADICADA").map(f => f.solicitud_id));
    return [...ids].map(id => solicitudes.get(id));
  }, [filtradas, solicitudes]);
  const seleccionadas  = useMemo(() => [...sel].map(id => solicitudes.get(id)).filter(Boolean), [sel, solicitudes]);
  const todasMarcadas  = seleccionables.length > 0 && seleccionables.every(s => sel.has(s.id));
  const totalSel = useMemo(() => ({
    lineas: seleccionadas.reduce((a, s) => a + Number(s.total_lineas || 0), 0),
    unidades: seleccionadas.reduce((a, s) => a + Number(s.total_unidades || 0), 0),
  }), [seleccionadas]);

  const marcar = (id, on) => setSel(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const marcarTodas = (on) => setSel(prev => {
    const n = new Set(prev);
    seleccionables.forEach(s => { if (on) n.add(s.id); else n.delete(s.id); });
    return n;
  });

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
    setBajandoLote(l.id);
    try {
      const lineas = await obtenerLineasLote(l.id);
      if (!lineas.length) { aviso("⚠ Este bloque no tiene líneas disponibles."); return; }
      generarExcelLote({ id: l.id, numero: l.numero, procesadoAt: l.procesado_at, procesadoPor: l.procesado_por, comentario: l.comentario }, lineas);
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setBajandoLote(null); }
  };

  const confirmarReversion = async () => {
    if (!motivo.trim()) { aviso("⚠ Escriba el motivo de la reversión"); return; }
    setRevirtiendo(true);
    try {
      const r = await revertirLote({ loteId: reversion.id, motivo });
      aviso(`✓ ${reversion.numero} revertido: ${plural(r?.solicitudes_revertidas, "solicitud volvió", "solicitudes volvieron")} a Radicada`);
      setReversion(null); setMotivo("");
      cargar(); cargarLotes();
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setRevirtiendo(false); }
  };

  const campo = { height: 36, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box" };
  const th = { padding: "8px 8px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap", background: "#F7FCF9" };
  const tdC = { padding: "7px 8px", fontSize: 12, color: "#1a2e27", borderBottom: "1px solid #F0F5F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const filtroInput = { width: "100%", height: 26, padding: "0 6px", fontSize: 11, border: "1px solid #D4E5DE", borderRadius: 6, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box" };
  const ANCHO_CASILLA = 46, ANCHO_ACCIONES = puedeOperar ? 214 : 132;
  const anchoTabla = (puedeOperar ? ANCHO_CASILLA : 0) + COLUMNAS_LINEAS.reduce((a, c) => a + c.w, 0) + ANCHO_ACCIONES;
  // La casilla queda fija a la izquierda al desplazar la tabla
  const fijaIzq = (fondo) => ({ position: "sticky", left: 0, zIndex: 1, background: fondo, boxShadow: "1px 0 0 #E2EDE9" });
  const btnFila = { height: 26, padding: "0 8px", fontSize: 11, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };

  return (
    <div style={{ paddingBottom: sel.size > 0 ? 110 : 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>{esSolicitante ? "Mis solicitudes" : "Solicitudes radicadas"}</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>
            {plural(resumen.solicitudes, "solicitud", "solicitudes")} · {plural(resumen.lineas, "línea", "líneas")} · {num(resumen.unidades)} unidades{hayFiltrosCol ? " (filtrado)" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {hayFiltrosCol && <button onClick={() => { setFiltrosCol({}); setPagina(1); }} style={{ ...campo, cursor: "pointer", color: "#B45309", borderColor: "#FCD9A0", fontWeight: 600 }}>Limpiar filtros</button>}
          <button onClick={() => { cargar(); if (verLotes) cargarLotes(); }} style={{ ...campo, cursor: "pointer", color: "#0F6E56", fontWeight: 600 }}>↻ Actualizar</button>
        </div>
      </div>

      {/* Rango y estado (consultan la base) */}
      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, padding: isMobile ? 12 : "14px 18px", marginBottom: 14,
        display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 2fr", gap: 10, alignItems: "end" }}>
        <label style={lbl}>Desde <span style={{ color: "#9CB8AE", fontWeight: 400 }}>(mes/día/año)</span><input type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} style={campo} /></label>
        <label style={lbl}>Hasta <span style={{ color: "#9CB8AE", fontWeight: 400 }}>(mes/día/año)</span><input type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} style={campo} /></label>
        <label style={lbl}>Estado
          <select value={filtros.estado} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))} style={campo}>
            <option value="">Todos</option>
            {Object.entries(ESTADO_UI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <div style={{ fontSize: 11, color: "#6B8F80", gridColumn: isMobile ? "span 2" : "auto", lineHeight: 1.4 }}>
          Carga el día de hoy; máximo <b>{maxDias} días</b> por consulta (más: menú <b>Histórico</b>). Filtre cada columna en la fila «Filtrar…»; use <b>*</b> como comodín (ej. <b>bell*group</b>).
        </div>
      </div>

      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#C0392B" }}>{error}</div>}

      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden" }}>
        {/* Encabezado de la lista: cuántas radicadas hay para marcar */}
        {puedeOperar && !cargando && datos.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "#F7FCF9", borderBottom: "1px solid #E2EDE9", fontSize: 11.5, color: "#44574F" }}>
            {seleccionables.length === 0
              ? "No hay solicitudes Radicadas en esta lista."
              : sel.size > 0
                ? <><b>{plural(sel.size, "solicitud marcada", "solicitudes marcadas")}</b> · la casilla del encabezado marca las {num(seleccionables.length)} radicadas que cumplen los filtros (todas las páginas).</>
                : <>Marque con la casilla de la izquierda las solicitudes a procesar. La del encabezado marca las {num(seleccionables.length)} radicadas que cumplen los filtros.</>}
          </div>
        )}

        {cargando && <div style={{ padding: 20, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
        {!cargando && !error && datos.length === 0 && <div style={{ padding: 24, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>
          {filtros.estado === "RADICADA" ? "No hay solicitudes Radicadas pendientes en el rango seleccionado." : "No hay solicitudes en el rango seleccionado."}
        </div>}

        {!cargando && datos.length > 0 && (
          <>
            {/* Tabla con TODOS los campos de "Excel desde PDF", una fila por línea */}
            <div style={{ overflow: "auto", maxHeight: "62vh" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: anchoTabla, minWidth: "100%" }}>
                <colgroup>
                  {puedeOperar && <col style={{ width: ANCHO_CASILLA }} />}
                  {COLUMNAS_LINEAS.map(c => <col key={c.key} style={{ width: c.w }} />)}
                  <col style={{ width: ANCHO_ACCIONES }} />
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
                  <tr>
                    {puedeOperar && (
                      <th style={{ ...th, ...fijaIzq("#F7FCF9"), padding: "2px 7px" }}>
                        <Casilla marcada={todasMarcadas} parcial={seleccionables.some(s => sel.has(s.id))} deshabilitada={seleccionables.length === 0}
                          onChange={marcarTodas} titulo="Marcar o desmarcar todas las solicitudes Radicadas que cumplen los filtros" />
                      </th>
                    )}
                    {COLUMNAS_LINEAS.map(c => <th key={c.key} style={{ ...th, textAlign: c.num ? "right" : c.centro ? "center" : "left" }}>{c.titulo}</th>)}
                    <th style={{ ...th, textAlign: "center" }}>Acciones</th>
                  </tr>
                  {/* Filtros por columna */}
                  <tr>
                    {puedeOperar && <th style={{ ...th, ...fijaIzq("#F7FCF9"), borderBottom: "1px solid #E2EDE9" }} />}
                    {COLUMNAS_LINEAS.map(c => (
                      <th key={c.key} style={{ ...th, padding: "0 6px 6px", borderBottom: "1px solid #E2EDE9" }}>
                        {c.key === "estado" ? (
                          <select value={filtrosCol.estado || ""} onChange={e => filtrarCol("estado", e.target.value)} style={filtroInput}>
                            <option value="">Todos</option>
                            {Object.values(ESTADO_UI).map(v => <option key={v.label} value={v.label}>{v.label}</option>)}
                          </select>
                        ) : (
                          <input value={filtrosCol[c.key] || ""} placeholder="Filtrar…" title="Contiene el texto · use * como comodín"
                            onChange={e => filtrarCol(c.key, e.target.value)} style={filtroInput} />
                        )}
                      </th>
                    ))}
                    <th style={{ ...th, borderBottom: "1px solid #E2EDE9" }} />
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 && (
                    <tr><td colSpan={COLUMNAS_LINEAS.length + (puedeOperar ? 2 : 1)} style={{ ...tdC, textAlign: "center", color: "#9CB8AE", padding: 18 }}>Ninguna línea cumple los filtros.</td></tr>
                  )}
                  {visibles.map((f, i) => {
                    const est = uiEstado(f.estado_codigo, f.estado_nombre);
                    const esRadicada = f.estado_codigo === "RADICADA";
                    const marcada = sel.has(f.solicitud_id);
                    const primeraDeSolicitud = i === 0 || visibles[i - 1].solicitud_id !== f.solicitud_id;
                    const fondo = marcada ? "#EAF7F1" : primeraDeSolicitud ? "#fff" : "#FCFEFD";
                    const bordeSup = primeraDeSolicitud && i > 0 ? "2px solid #DCEAE4" : undefined;
                    return (
                      <tr key={f.linea_id} style={{ background: fondo }}>
                        {puedeOperar && (
                          <td style={{ ...tdC, ...fijaIzq(fondo), padding: "0 7px", borderTop: bordeSup }}>
                            <Casilla marcada={marcada} deshabilitada={!esRadicada} onChange={on => marcar(f.solicitud_id, on)}
                              titulo={esRadicada ? `Marcar ${f.numero} (todas sus líneas) para procesar` : `${f.numero} ya está ${est.label}`} />
                          </td>
                        )}
                        {COLUMNAS_LINEAS.map(c => {
                          const v = valorCelda(f, c.key);
                          if (c.key === "adjuntos") return (
                            <td key={c.key} style={{ ...tdC, borderTop: bordeSup, textAlign: "center", overflow: "visible" }}>
                              <AdjuntosBoton adjuntos={f.adjuntos || []} numero={f.numero} onError={aviso} />
                            </td>
                          );
                          if (c.key === "estado") return (
                            <td key={c.key} style={{ ...tdC, borderTop: bordeSup }}><span title={f.lote_numero ? `Bloque ${f.lote_numero}` : ""} style={{ fontSize: 11, fontWeight: 600, color: est.color, background: est.bg, padding: "2px 9px", borderRadius: 20 }}>{est.label}</span></td>
                          );
                          return (
                            <td key={c.key} title={String(v)} style={{ ...tdC, borderTop: bordeSup, textAlign: c.num ? "right" : "left", fontWeight: c.fuerte ? 700 : 400, color: c.fuerte ? "#0F6E56" : (v === "" ? "#C9D6D0" : "#1a2e27") }}>
                              {c.num ? num(v) : (v === "" ? "—" : v)}
                            </td>
                          );
                        })}
                        <td style={{ ...tdC, borderTop: bordeSup, textAlign: "center", overflow: "visible" }}>
                          {primeraDeSolicitud && (
                            <span style={{ display: "inline-flex", gap: 5 }}>
                              <button onClick={() => verHistorial(f.solicitud_id)} title={`Línea de tiempo de ${f.numero}`} style={btnFila}>🕑</button>
                              {puedeOperar && esRadicada && (
                                <button onClick={() => abrirBloque([solicitudes.get(f.solicitud_id)])} title={`Procesar solo ${f.numero}`}
                                  style={{ ...btnFila, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" }}>Procesar</button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginador total={filtradas.length} pagina={paginaActual} porPagina={porPagina}
              onPagina={setPagina} onPorPagina={cambiarPorPagina} unidad="líneas" />
          </>
        )}
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
                              <button onClick={() => descargarLote(l)} disabled={bajandoLote === l.id} style={{ ...btnSec, padding: "5px 10px", fontSize: 11 }}>{bajandoLote === l.id ? "…" : "⬇ Excel"}</button>
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

      {/* ── Línea de tiempo de una solicitud ── */}
      {historial && (
        <div onClick={() => setHistorial(null)} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27" }}>Línea de tiempo · {historial.sol?.numero}</div>
            <div style={{ fontSize: 12, color: "#6B8F80", marginBottom: 12 }}>
              {historial.sol?.area_solicitante} · {historial.sol?.solicitante_nombre} · {plural(historial.sol?.total_lineas, "línea", "líneas")}
              {historial.sol?.lote_numero ? ` · Bloque ${historial.sol.lote_numero}` : ""}
            </div>
            {!historial.eventos && <div style={{ fontSize: 12, color: "#6B8F80" }}>Cargando…</div>}
            {historial.eventos && historial.eventos.map((ev, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid #F0F5F3", fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, color: uiEstado(ev.estado_nuevo).color, minWidth: 92 }}>{uiEstado(ev.estado_nuevo).label}</span>
                <span style={{ color: "#44574F" }}>{fechaHoraBogota(ev.created_at)}{ev.comentario ? ` · ${ev.comentario}` : ""}</span>
              </div>))}
            <div style={{ textAlign: "right", marginTop: 14 }}>
              <button onClick={() => setHistorial(null)} style={btnSec}>Cerrar</button>
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
const tdL = { padding: "8px 10px", color: "#1a2e27", whiteSpace: "nowrap" };
const btnSec = { padding: "7px 14px", fontSize: 12, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer" };

