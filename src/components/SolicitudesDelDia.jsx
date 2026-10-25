// ── SolicitudesDelDia.jsx ────────────────────────────────────────────────
// Tabla dentro de la pantalla Despachos con las solicitudes que se van
// radicando. Por defecto muestra las de HOY; los filtros permiten consultar
// un rango de fechas. Se recarga sola cada vez que se radica una solicitud
// (prop `recarga`). La lectura respeta los permisos del usuario:
//  · solicitante → ve las suyas   · operador / consulta / admin → ve todas
// UNA FILA POR SOLICITUD (resumen). El detalle de las líneas va en el Excel
// que se descarga: fase 6 → UN solo archivo con el formato de la plantilla
// (Plantilla_Pedido.xlsx: Entrega, Nit, Nombre, Dirección, Teléfono, Ciudad,
// Departamento, Material, Cantidad, Observaciones), venga de PDF, Excel o manual.
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listarSolicitudes, obtenerLineas } from "../services/solicitudesService";
import { normalizarLinea, descargarExcelPlantilla } from "../services/excelDespachoService";
import { listarAdjuntos } from "../services/adjuntosService";
import AdjuntosBoton from "./AdjuntosBoton";
import Paginador from "./Paginador";
import { AREAS, MOTIVOS, etiquetaArea, etiquetaMotivo, coincide } from "../utils/tablaLineas";

// Paginación de esta tabla: arranca en 5 y aparece al superar 5 solicitudes
const OPCIONES_HOY = [5, 10, 15, 30, 50, 75, 100];
const ORIGEN_TXT = (sol) => sol.origen === "PDF" ? `PDF${sol.numero_pedido_origen ? " · " + sol.numero_pedido_origen : ""}` : sol.origen === "EXCEL" ? "Plantilla Excel" : "Manual";
import { fechaHoraBogota, horaBogota, isoFechaBogota } from "../utils/fechas";

const ESTADO_UI = {
  RADICADA:  { label: "Radicada",  color: "#2563EB", bg: "#EFF6FF" },
  PROCESADA: { label: "Procesada", color: "#0F6E56", bg: "#E1F5EE" },
  ANULADA:   { label: "Anulada",   color: "#C0392B", bg: "#FFF0EE" },   // solo históricas
};

const hoy = () => isoFechaBogota(new Date());
const num = (n) => Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 });

export default function SolicitudesDelDia({ isMobile, recarga = 0, showToast }) {
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [bajando, setBajando] = useState(null);
  const [adjuntos, setAdjuntos] = useState({});   // solicitud_id → adjuntos (📎)
  // Filtros de consulta y paginación
  const [filtros, setFiltros] = useState({});
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(5);
  const filtrar = (k, v) => { setFiltros(f => ({ ...f, [k]: v })); setPagina(1); };

  const esHoy = desde === hoy() && hasta === hoy();
  const rangoInvalido = Boolean(desde && hasta && desde > hasta);

  const cargar = useCallback(async () => {
    if (rangoInvalido) { setDatos([]); setError("La fecha «Desde» no puede ser posterior a «Hasta»."); return; }
    setCargando(true); setError("");
    try {
      const filas = await listarSolicitudes({ desde, hasta, limite: 500 });
      setDatos(filas);
      try { setAdjuntos(await listarAdjuntos(filas.map(f => f.id))); } catch { setAdjuntos({}); }
    }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [desde, hasta, rangoInvalido]);

  // Carga inicial, al cambiar el rango y cada vez que se radica una solicitud
  useEffect(() => { cargar(); }, [cargar, recarga]);

  const totales = useMemo(() => ({
    solicitudes: datos.length,
    lineas: datos.reduce((s, d) => s + Number(d.total_lineas || 0), 0),
    unidades: datos.reduce((s, d) => s + Number(d.total_unidades || 0), 0),
  }), [datos]);

  // Filtros: texto "contiene" (con * como comodín); Área, Motivo y Estado por lista
  const valorFiltro = (sol, k) => k === "hora" ? (esHoy ? horaBogota(sol.radicada_at) : fechaHoraBogota(sol.radicada_at))
    : k === "origen" ? ORIGEN_TXT(sol) : sol[k] ?? "";
  const filtradas = datos.filter(sol =>
    ["numero", "hora", "solicitante_nombre", "origen"].every(k => coincide(valorFiltro(sol, k), filtros[k]))
    && (!filtros.area || sol.area_solicitante === filtros.area)
    && (!filtros.proceso || sol.proceso === filtros.proceso)
    && (!filtros.estado || sol.estado_codigo === filtros.estado));
  const hayFiltros = Object.values(filtros).some(v => String(v || "").trim());
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtradas.length / porPagina)));
  const visibles = filtradas.slice((paginaActual - 1) * porPagina, paginaActual * porPagina);

  const verHoy = () => { setDesde(hoy()); setHasta(hoy()); };

  // Excel de la solicitud con el formato de la plantilla (todas sus líneas)
  const descargarExcel = async (sol) => {
    setBajando(sol.id);
    try {
      const lineas = await obtenerLineas(sol.id);
      const enc = { numero: sol.numero, area: sol.area_solicitante, solicitante: sol.solicitante_nombre,
        correo: sol.solicitante_correo, radicadaAt: sol.radicada_at };
      descargarExcelPlantilla({ area: sol.area_solicitante, numero: sol.numero, lineas: lineas.map(l => normalizarLinea(l, enc)) });
    } catch (e) {
      if (showToast) showToast("⚠ " + e.message);
    } finally { setBajando(null); }
  };

  const inputFecha = { height: 34, padding: "0 8px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none" };
  const btn = { height: 34, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
  const filtroInput = { width: "100%", height: 26, padding: "0 6px", fontSize: 11, border: "1px solid #D4E5DE", borderRadius: 6, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box", fontWeight: 400, textTransform: "none", letterSpacing: 0 };
  const th = { padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #E2EDE9", background: "#F7FCF9" };
  const td = { padding: "8px 10px", fontSize: 12.5, color: "#1a2e27", borderBottom: "1px solid #F0F5F3", whiteSpace: "nowrap" };

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2EDE9", overflow: "hidden", marginTop: 16 }}>
      {/* Encabezado + filtros */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid #E2EDE9" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>
            {esHoy ? "Solicitudes de hoy" : "Solicitudes del rango"}
          </div>
          <div style={{ fontSize: 11, color: "#6B8F80" }}>
            {cargando ? "Cargando…" : `${totales.solicitudes} solicitud${totales.solicitudes !== 1 ? "es" : ""} · ${num(totales.lineas)} línea${totales.lineas !== 1 ? "s" : ""} · ${num(totales.unidades)} unidades`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6B8F80" }}>
            Desde
            <input type="date" value={desde} max={hasta || undefined} onChange={e => setDesde(e.target.value)} style={inputFecha} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6B8F80" }}>
            Hasta
            <input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} style={inputFecha} />
          </label>
          <button onClick={verHoy} disabled={esHoy} title="Volver a las solicitudes de hoy"
            style={{ ...btn, ...(esHoy ? { background: "#0F6E56", color: "#fff", borderColor: "#0F6E56", cursor: "default" } : {}) }}>Hoy</button>
          {hayFiltros && <button onClick={() => { setFiltros({}); setPagina(1); }} style={{ ...btn, color: "#B45309", borderColor: "#FCD9A0" }}>Limpiar filtros</button>}
          <button onClick={cargar} disabled={cargando} title="Actualizar la tabla" style={{ ...btn, opacity: cargando ? 0.6 : 1 }}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div style={{ padding: "10px 16px", fontSize: 12, color: "#C0392B", background: "#FFF5F5", borderBottom: "1px solid #F5C6C0" }}>⚠ {error}</div>}

      {/* Tabla */}
      {!error && datos.length === 0 && !cargando ? (
        <div style={{ padding: "22px 16px", textAlign: "center", fontSize: 12.5, color: "#9CB8AE" }}>
          {esHoy ? "Aún no hay solicitudes radicadas hoy." : "No hay solicitudes en el rango seleccionado."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 720 : 0 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                <th style={th}>N° solicitud</th>
                <th style={th}>{esHoy ? "Hora" : "Fecha y hora"}</th>
                <th style={th}>Área</th>
                <th style={th}>Motivo</th>
                <th style={th}>Solicitante</th>
                <th style={th}>Origen</th>
                <th style={{ ...th, textAlign: "right" }}>Líneas</th>
                <th style={{ ...th, textAlign: "right" }}>Unidades</th>
                <th style={th}>Estado</th>
                <th style={{ ...th, textAlign: "center" }}>Excel</th>
                <th style={{ ...th, textAlign: "center" }}>Adjuntos</th>
              </tr>
              {/* Filtros de consulta */}
              <tr>
                {[["numero"], ["hora"], ["area", AREAS], ["proceso", MOTIVOS], ["solicitante_nombre"], ["origen"], [null], [null],
                  ["estado", [{ valor: "RADICADA", etiqueta: "Radicada" }, { valor: "PROCESADA", etiqueta: "Procesada" }]], [null], [null]].map(([k, lista], i) => (
                  <th key={i} style={{ ...th, padding: "0 6px 6px" }}>
                    {k && (lista ? (
                      <select value={filtros[k] || ""} onChange={e => filtrar(k, e.target.value)} style={filtroInput}>
                        <option value="">Todos</option>
                        {lista.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                      </select>
                    ) : (
                      <input value={filtros[k] || ""} placeholder="Filtrar…" title="Contiene el texto · use * como comodín" onChange={e => filtrar(k, e.target.value)} style={filtroInput} />
                    ))}
                  </th>))}
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={11} style={{ ...td, textAlign: "center", color: "#9CB8AE", padding: 16 }}>Ninguna solicitud cumple los filtros.</td></tr>
              )}
              {visibles.map(sol => {
                const est = ESTADO_UI[sol.estado_codigo] || { label: sol.estado_nombre || sol.estado_codigo, color: "#6B8F80", bg: "#F2F8F5" };
                return (
                  <tr key={sol.id}>
                    <td style={{ ...td, fontWeight: 700, color: "#0F6E56" }}>{sol.numero}</td>
                    <td style={td}>{esHoy ? horaBogota(sol.radicada_at) : fechaHoraBogota(sol.radicada_at)}</td>
                    <td style={td}>{etiquetaArea(sol.area_solicitante)}</td>
                    <td style={td}>{etiquetaMotivo(sol.proceso) || "—"}</td>
                    <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={sol.solicitante_correo || ""}>{sol.solicitante_nombre}</td>
                    <td style={{ ...td, color: "#6B8F80" }}>{ORIGEN_TXT(sol)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(sol.total_lineas)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(sol.total_unidades)}</td>
                    <td style={td}>
                      <span title={sol.motivo_anulacion || (sol.lote_numero ? `Bloque ${sol.lote_numero}` : "")} style={{ fontSize: 11, fontWeight: 600, color: est.color, background: est.bg, padding: "3px 10px", borderRadius: 20 }}>{est.label}</span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button onClick={() => descargarExcel(sol)} disabled={bajando === sol.id} title={`Descargar el Excel de ${sol.numero} (formato de la plantilla)`}
                        style={{ height: 28, padding: "0 10px", fontSize: 11, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: bajando === sol.id ? "wait" : "pointer" }}>
                        {bajando === sol.id ? "…" : "⬇ .xlsx"}
                      </button>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}><AdjuntosBoton adjuntos={adjuntos[sol.id] || []} numero={sol.numero} onError={showToast} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Paginación: solo cuando hay más de 5 solicitudes */}
      {!error && filtradas.length > 5 && (
        <Paginador total={filtradas.length} pagina={paginaActual} porPagina={porPagina} opciones={OPCIONES_HOY} unidad="solicitudes"
          onPagina={setPagina} onPorPagina={n => { setPorPagina(n); setPagina(1); }} />
      )}
    </div>
  );
}
