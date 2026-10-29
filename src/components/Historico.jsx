// ── Historico.jsx ────────────────────────────────────────────────────────
// Pantalla Histórico (solo supervisor = operador, y administrador).
// Consultas de más de 7 días que no se permiten en la pestaña Solicitudes.
//  · Rango máximo por consulta: parámetro historico_rango_max_dias (31 = 1 mes).
//    Más de un mes → se pide al administrador del sistema (consulta en BD).
//  · Pestaña Solicitudes: una fila por solicitud, filtros por columna,
//    paginación, adjuntos 📎 y exportación a Excel (mismas 4 hojas del bloque).
//  · Pestaña Bloques procesados: re-descarga del Excel de cada bloque.
// No carga nada hasta que el usuario pulsa «Consultar».
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { listarSolicitudesRango, listarLineasSolicitudes, listarLotes, obtenerLineasLote } from "../services/solicitudesService";
import { libroBloque, descargarExcelBloque } from "../services/excelDespachoService";
import { listarAdjuntos } from "../services/adjuntosService";
import { cargarParametros, diasRango, PARAMETROS_DEFECTO } from "../services/parametrosService";
import { coincide, uiEstado, etiquetaMotivo, etiquetaArea, textoConsentimiento } from "../utils/tablaLineas";
import { fechaHoraBogota, isoFechaBogota } from "../utils/fechas";
import Paginador from "./Paginador";
import AdjuntosBoton from "./AdjuntosBoton";

const hace = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return isoFechaBogota(d); };
const num = (n) => Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 });
const ORIGEN = { PDF: "PDF", EXCEL: "Plantilla Excel", MANUAL: "Manual" };

const COL_SOL = [
  { key: "numero", titulo: "N° solicitud", w: 140, fuerte: true },
  { key: "fecha", titulo: "Fecha y hora", w: 130 },
  { key: "estado", titulo: "Estado", w: 100 },
  { key: "area_solicitante", titulo: "Área", w: 110 },
  { key: "proceso", titulo: "Motivo", w: 100 },
  { key: "solicitante_nombre", titulo: "Solicitante", w: 170 },
  { key: "origen", titulo: "Origen", w: 110 },
  { key: "total_lineas", titulo: "Líneas", w: 70, num: true },
  { key: "total_unidades", titulo: "Unidades", w: 90, num: true },
  { key: "lote_numero", titulo: "Bloque", w: 140 },
  { key: "consentimiento", titulo: "Consentimiento", w: 150 },   // 29-oct
];
const valorSol = (s, k) => k === "fecha" ? fechaHoraBogota(s.radicada_at)
  : k === "estado" ? uiEstado(s.estado_codigo, s.estado_nombre).label
  : k === "proceso" ? etiquetaMotivo(s.proceso)
  : k === "area_solicitante" ? etiquetaArea(s.area_solicitante)
  : k === "origen" ? (ORIGEN[s.origen] || s.origen || "")
  : k === "consentimiento" ? textoConsentimiento(s.consentimiento_at)
  : s[k] ?? "";

const campo = { height: 36, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box" };
const btn = { height: 36, padding: "0 14px", fontSize: 12.5, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
const btnPri = { ...btn, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" };
const th = { padding: "8px 8px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap", background: "#F7FCF9" };
const td = { padding: "7px 8px", fontSize: 12, color: "#1a2e27", borderBottom: "1px solid #F0F5F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 };

export default function Historico() {
  const [tab, setTab] = useState("solicitudes");
  const [maxDias, setMaxDias] = useState(PARAMETROS_DEFECTO.historico_rango_max_dias);
  const [maxDiasSol, setMaxDiasSol] = useState(PARAMETROS_DEFECTO.solicitudes_rango_max_dias);
  const [desde, setDesde] = useState(() => hace(6));
  const [hasta, setHasta] = useState(() => isoFechaBogota(new Date()));
  const [estado, setEstado] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [consultado, setConsultado] = useState(null);   // { desde, hasta } de la última consulta
  const [sols, setSols] = useState([]);
  const [adjuntos, setAdjuntos] = useState({});
  const [lotes, setLotes] = useState([]);
  const [filtros, setFiltros] = useState({});
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [exportando, setExportando] = useState(false);
  const [bajando, setBajando] = useState(null);

  useEffect(() => {
    cargarParametros().then(p => { setMaxDias(Number(p.historico_rango_max_dias) || 31); setMaxDiasSol(Number(p.solicitudes_rango_max_dias) || 7); }).catch(() => {});
  }, []);
  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 4500); };

  const dias = desde && hasta ? diasRango(desde, hasta) : 0;
  const validar = () => {
    if (!desde || !hasta) return "Seleccione las fechas Desde y Hasta.";
    if (desde > hasta) return "La fecha «Desde» no puede ser posterior a «Hasta».";
    if (dias > maxDias) return `El histórico permite consultar máximo ${maxDias} días (un mes) por consulta. La información de más de un mes debe solicitarla al administrador del sistema, que la consulta directamente en la base de datos.`;
    return "";
  };

  const consultar = async () => {
    const msg = validar();
    if (msg) { setError(msg); return; }
    setCargando(true); setError(""); setFiltros({}); setPagina(1);
    try {
      if (tab === "solicitudes") {
        const filas = await listarSolicitudesRango({ desde, hasta, estado });
        setSols(filas);
        try { setAdjuntos(await listarAdjuntos(filas.map(f => f.id))); } catch { setAdjuntos({}); }
      } else {
        setLotes(await listarLotes({ desde, hasta, limite: 1000 }));
      }
      setConsultado({ desde, hasta, tab });
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  };

  const filtradas = useMemo(() => sols.filter(s => COL_SOL.every(c => coincide(valorSol(s, c.key), filtros[c.key]))), [sols, filtros]);
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / porPagina)));
  const visibles = filtradas.slice((paginaActual - 1) * porPagina, paginaActual * porPagina);
  const totales = useMemo(() => ({ lineas: filtradas.reduce((a, s) => a + Number(s.total_lineas || 0), 0), unidades: filtradas.reduce((a, s) => a + Number(s.total_unidades || 0), 0) }), [filtradas]);

  // Excel con las 4 hojas (DESPACHO, CARGA A WMS, CARGA LIBRO 1, TABLERO CONTROL) de las solicitudes filtradas
  const exportar = async () => {
    if (!consultado || !filtradas.length) return;
    setExportando(true);
    try {
      const ids = new Set(filtradas.map(s => s.id));
      const lineas = (await listarLineasSolicitudes({ desde: consultado.desde, hasta: consultado.hasta, estado, tope: 50000 }))
        .filter(l => ids.has(l.solicitud_id));
      if (!lineas.length) { aviso("⚠ No hay líneas para exportar."); return; }
      XLSX.writeFile(libroBloque(lineas, { conConsentimiento: true }), `historico_solicitudes_${consultado.desde}_a_${consultado.hasta}.xlsx`);
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setExportando(false); }
  };

  const bajarLote = async (l) => {
    setBajando(l.id);
    try {
      const lineas = await obtenerLineasLote(l.id);
      if (!lineas.length) { aviso("⚠ Este bloque no tiene líneas."); return; }
      descargarExcelBloque(l.numero, lineas);
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setBajando(null); }
  };

  const anchoSol = COL_SOL.reduce((a, c) => a + c.w, 0) + 80;

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>Histórico</div>
        <div style={{ fontSize: 12, color: "#6B8F80" }}>Consulta de solicitudes y bloques procesados de periodos anteriores</div>
      </div>

      {/* Mensaje fijo de la pantalla */}
      <div style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", borderRadius: 12, padding: "12px 16px", marginBottom: 14, fontSize: 12.5, color: "#92400E", lineHeight: 1.55 }}>
        <b>Pantalla de histórico.</b> Las consultas de más de {maxDiasSol} días cargan mucha información y es probable que el sistema tarde <b>varios minutos</b>.
        Cada consulta permite máximo <b>{maxDias} días (un mes)</b>. La información de <b>más de un mes</b> debe solicitarla al <b>administrador del sistema</b>, que corre la consulta directamente en la base de datos.
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["solicitudes", "Solicitudes"], ["bloques", "Bloques procesados"]].map(([k, t]) => (
          <button key={k} onClick={() => { setTab(k); setError(""); setConsultado(null); }}
            style={{ ...btn, ...(tab === k ? { background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" } : {}) }}>{t}</button>
        ))}
      </div>

      {/* Rango */}
      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, padding: "14px 18px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={lbl}>Desde <span style={{ color: "#9CB8AE", fontWeight: 400 }}>(mes/día/año)</span><input type="date" value={desde} max={hasta || undefined} onChange={e => setDesde(e.target.value)} style={campo} /></label>
        <label style={lbl}>Hasta <span style={{ color: "#9CB8AE", fontWeight: 400 }}>(mes/día/año)</span><input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} style={campo} /></label>
        {tab === "solicitudes" && (
          <label style={lbl}>Estado
            <select value={estado} onChange={e => setEstado(e.target.value)} style={{ ...campo, minWidth: 140 }}>
              <option value="">Todos</option><option value="RADICADA">Radicada</option><option value="PROCESADA">Procesada</option>
            </select>
          </label>
        )}
        <button onClick={consultar} disabled={cargando} style={{ ...btnPri, opacity: cargando ? 0.7 : 1, cursor: cargando ? "wait" : "pointer" }}>{cargando ? "Consultando…" : "🔍 Consultar"}</button>
        <span style={{ fontSize: 12, color: dias > maxDias ? "#C0392B" : "#6B8F80", alignSelf: "center" }}>{dias > 0 ? `${dias} día${dias !== 1 ? "s" : ""} seleccionado${dias !== 1 ? "s" : ""} (máximo ${maxDias})` : ""}</span>
      </div>

      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "#C0392B", lineHeight: 1.5 }}>⚠ {error}</div>}
      {cargando && <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, padding: 20, fontSize: 13, color: "#6B8F80" }}>Consultando el histórico… puede tardar varios minutos si el rango es amplio.</div>}

      {!cargando && consultado && consultado.tab === "solicitudes" && tab === "solicitudes" && (
        <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderBottom: "1px solid #E2EDE9", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#6B8F80" }}>
              <b style={{ color: "#1a2e27" }}>{num(filtradas.length)} solicitudes</b> · {num(totales.lineas)} líneas · {num(totales.unidades)} unidades · del {consultado.desde} al {consultado.hasta}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {Object.values(filtros).some(v => String(v || "").trim()) && <button onClick={() => { setFiltros({}); setPagina(1); }} style={{ ...btn, color: "#B45309", borderColor: "#FCD9A0" }}>Limpiar filtros</button>}
              <button onClick={exportar} disabled={exportando || !filtradas.length} title="Un archivo con las hojas DESPACHO, CARGA A WMS, CARGA LIBRO 1 y TABLERO CONTROL"
                style={{ ...btn, opacity: exportando ? 0.6 : 1 }}>{exportando ? "Exportando…" : "⬇ Exportar a Excel (4 hojas)"}</button>
            </div>
          </div>
          <div style={{ overflow: "auto", maxHeight: "62vh" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: anchoSol, minWidth: "100%" }}>
              <colgroup>{COL_SOL.map(c => <col key={c.key} style={{ width: c.w }} />)}<col style={{ width: 80 }} /></colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>{COL_SOL.map(c => <th key={c.key} style={{ ...th, textAlign: c.num ? "right" : "left" }}>{c.titulo}</th>)}<th style={{ ...th, textAlign: "center" }}>Adjuntos</th></tr>
                <tr>{COL_SOL.map(c => (
                  <th key={c.key} style={{ ...th, padding: "0 6px 6px", borderBottom: "1px solid #E2EDE9" }}>
                    <input value={filtros[c.key] || ""} placeholder="Filtrar…" onChange={e => { setFiltros(f => ({ ...f, [c.key]: e.target.value })); setPagina(1); }}
                      style={{ ...campo, width: "100%", height: 26, fontSize: 11, padding: "0 6px" }} />
                  </th>))}<th style={{ ...th, borderBottom: "1px solid #E2EDE9" }} /></tr>
              </thead>
              <tbody>
                {visibles.length === 0 && <tr><td colSpan={COL_SOL.length + 1} style={{ ...td, textAlign: "center", color: "#9CB8AE", padding: 18 }}>No hay solicitudes con esos criterios.</td></tr>}
                {visibles.map(s => {
                  const est = uiEstado(s.estado_codigo, s.estado_nombre);
                  return (
                    <tr key={s.id}>
                      {COL_SOL.map(c => {
                        const v = valorSol(s, c.key);
                        if (c.key === "estado") return <td key={c.key} style={td}><span style={{ fontSize: 11, fontWeight: 600, color: est.color, background: est.bg, padding: "2px 9px", borderRadius: 20 }}>{est.label}</span></td>;
                        return <td key={c.key} title={String(v)} style={{ ...td, textAlign: c.num ? "right" : "left", fontWeight: c.fuerte ? 700 : 400, color: c.fuerte ? "#0F6E56" : (v === "" ? "#C9D6D0" : "#1a2e27") }}>{c.num ? num(v) : (v === "" ? "—" : v)}</td>;
                      })}
                      <td style={{ ...td, textAlign: "center", overflow: "visible" }}><AdjuntosBoton adjuntos={adjuntos[s.id] || []} numero={s.numero} onError={aviso} /></td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
          <Paginador total={filtradas.length} pagina={paginaActual} porPagina={porPagina} onPagina={setPagina} onPorPagina={n => { setPorPagina(n); setPagina(1); }} unidad="solicitudes" />
        </div>
      )}

      {!cargando && consultado && consultado.tab === "bloques" && tab === "bloques" && (
        <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "auto" }}>
          {lotes.length === 0 && <div style={{ padding: 20, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>No hay bloques procesados en el rango.</div>}
          {lotes.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
              <thead><tr>{["Bloque", "Procesado el", "Por", "Solicitudes", "Líneas", "Unidades", "Comentario / estado", ""].map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 3 && i <= 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>{lotes.map(l => {
                const revertido = Boolean(l.revertido_at);
                return (
                  <tr key={l.id} style={{ opacity: revertido ? 0.6 : 1 }}>
                    <td style={{ ...td, fontWeight: 700, color: "#0F6E56" }}>{l.numero}</td>
                    <td style={td}>{fechaHoraBogota(l.procesado_at)}</td>
                    <td style={td}>{l.procesado_por}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(l.total_solicitudes)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(l.total_lineas)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(l.total_unidades)}</td>
                    <td style={{ ...td, whiteSpace: "normal", color: revertido ? "#C0392B" : "#44574F" }}>{revertido ? `Revertido el ${fechaHoraBogota(l.revertido_at)}: ${l.motivo_reversion}` : (l.comentario || "")}</td>
                    <td style={{ ...td, textAlign: "right" }}>{!revertido && <button onClick={() => bajarLote(l)} disabled={bajando === l.id} style={{ ...btn, height: 28, fontSize: 11 }}>{bajando === l.id ? "…" : "⬇ Excel"}</button>}</td>
                  </tr>);
              })}</tbody>
            </table>
          )}
        </div>
      )}

      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}
