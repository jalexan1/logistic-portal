// ── SolicitudesDelDia.jsx ────────────────────────────────────────────────
// Tabla dentro de la pantalla Despachos con lo que se va radicando.
// Fase 3: UNA FILA POR LÍNEA con todos los campos de la plantilla de despacho
// (AREA, SOLICITANTE, CORREO, ENTREGA, NIT, NOMBRE, DIRECCIÓN, CIUDAD,
// DEPARTAMENTO, SKU, EAN, CANTIDAD, UM, ITEM, BODEGA), barra de desplazamiento
// horizontal y filtros por columna (con comodín *).
// Por defecto muestra HOY; Desde/Hasta consultan un rango. Se recarga sola
// cada vez que se radica una solicitud (prop `recarga`).
// Permisos: solicitante → sus líneas · operador / consulta / admin → todas.
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listarLineasSolicitudes } from "../services/solicitudesService";
import { normalizarLinea, descargarArchivosDespacho } from "../services/excelDespachoService";
import { isoFechaBogota } from "../utils/fechas";
import { COLUMNAS_LINEAS, ESTADO_UI, uiEstado, valorCelda, filtrarLineas } from "../utils/tablaLineas";

const COLUMNAS = COLUMNAS_LINEAS;
const hoy = () => isoFechaBogota(new Date());
const num = (n) => Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 });

export default function SolicitudesDelDia({ isMobile, recarga = 0, showToast }) {
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [bajando, setBajando] = useState(null);
  const [filtros, setFiltros] = useState({});

  const esHoy = desde === hoy() && hasta === hoy();
  const rangoInvalido = Boolean(desde && hasta && desde > hasta);
  const hayFiltros = Object.values(filtros).some(v => String(v || "").trim());

  const cargar = useCallback(async () => {
    if (rangoInvalido) { setDatos([]); setError("La fecha «Desde» no puede ser posterior a «Hasta»."); return; }
    setCargando(true); setError("");
    try { setDatos(await listarLineasSolicitudes({ desde, hasta })); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [desde, hasta, rangoInvalido]);

  // Carga inicial, al cambiar el rango y cada vez que se radica una solicitud
  useEffect(() => { cargar(); }, [cargar, recarga]);

  const filtradas = useMemo(() => filtrarLineas(datos, filtros), [datos, filtros]);

  const totales = useMemo(() => ({
    solicitudes: new Set(filtradas.map(f => f.solicitud_id)).size,
    lineas: filtradas.length,
    unidades: filtradas.reduce((s, f) => s + Number(f.cantidad || 0), 0),
  }), [filtradas]);

  const verHoy = () => { setDesde(hoy()); setHasta(hoy()); };

  // Los 3 archivos de la solicitud (todas sus líneas, aunque haya filtros)
  const descargar = async (f) => {
    setBajando(f.solicitud_id);
    try {
      const lineas = datos.filter(d => d.solicitud_id === f.solicitud_id).map(d => normalizarLinea(d));
      await descargarArchivosDespacho({ area: f.area_solicitante, numero: f.numero, lineas });
    } catch (e) {
      if (showToast) showToast("⚠ " + e.message);
    } finally { setBajando(null); }
  };

  const inputFecha = { height: 34, padding: "0 8px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none" };
  const btn = { height: 34, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
  const th = { padding: "8px 8px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap", background: "#F7FCF9" };
  const td = { padding: "7px 8px", fontSize: 12, color: "#1a2e27", borderBottom: "1px solid #F0F5F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const filtroInput = { width: "100%", height: 26, padding: "0 6px", fontSize: 11, border: "1px solid #D4E5DE", borderRadius: 6, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box" };
  const anchoTabla = COLUMNAS.reduce((a, c) => a + c.w, 0) + 80;

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2EDE9", overflow: "hidden", marginTop: 16 }}>
      {/* Encabezado + rango de fechas */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid #E2EDE9" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>
            {esHoy ? "Solicitudes de hoy" : "Solicitudes del rango"}
          </div>
          <div style={{ fontSize: 11, color: "#6B8F80" }}>
            {cargando ? "Cargando…" : `${num(totales.solicitudes)} solicitud${totales.solicitudes !== 1 ? "es" : ""} · ${num(totales.lineas)} línea${totales.lineas !== 1 ? "s" : ""} · ${num(totales.unidades)} unidades${hayFiltros ? " (filtrado)" : ""}`}
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
          {hayFiltros && <button onClick={() => setFiltros({})} style={{ ...btn, color: "#B45309", borderColor: "#FCD9A0" }}>Limpiar filtros</button>}
          <button onClick={cargar} disabled={cargando} title="Actualizar la tabla" style={{ ...btn, opacity: cargando ? 0.6 : 1 }}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div style={{ padding: "10px 16px", fontSize: 12, color: "#C0392B", background: "#FFF5F5", borderBottom: "1px solid #F5C6C0" }}>⚠ {error}</div>}

      {/* Tabla con barra horizontal: todos los campos de la plantilla */}
      {!error && datos.length === 0 && !cargando ? (
        <div style={{ padding: "22px 16px", textAlign: "center", fontSize: 12.5, color: "#9CB8AE" }}>
          {esHoy ? "Aún no hay solicitudes radicadas hoy." : "No hay solicitudes en el rango seleccionado."}
        </div>
      ) : (
        <div style={{ overflowX: "scroll", overflowY: "auto", maxHeight: 440 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: anchoTabla, minWidth: "100%" }}>
            <colgroup>
              {COLUMNAS.map(c => <col key={c.key} style={{ width: c.w }} />)}
              <col style={{ width: 80 }} />
            </colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                {COLUMNAS.map(c => <th key={c.key} style={{ ...th, textAlign: c.num ? "right" : "left" }}>{c.titulo}</th>)}
                <th style={{ ...th, textAlign: "center" }}>Excel</th>
              </tr>
              {/* Filtros por columna */}
              <tr>
                {COLUMNAS.map(c => (
                  <th key={c.key} style={{ ...th, padding: "0 6px 6px", borderBottom: "1px solid #E2EDE9" }}>
                    {c.key === "estado" ? (
                      <select value={filtros.estado || ""} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))} style={filtroInput}>
                        <option value="">Todos</option>
                        {Object.values(ESTADO_UI).map(v => <option key={v.label} value={v.label}>{v.label}</option>)}
                      </select>
                    ) : (
                      <input value={filtros[c.key] || ""} placeholder="Filtrar…" title="Contiene el texto · use * como comodín"
                        onChange={e => setFiltros(f => ({ ...f, [c.key]: e.target.value }))} style={filtroInput} />
                    )}
                  </th>
                ))}
                <th style={{ ...th, borderBottom: "1px solid #E2EDE9" }} />
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={COLUMNAS.length + 1} style={{ ...td, textAlign: "center", color: "#9CB8AE", padding: 18 }}>Ninguna línea cumple los filtros.</td></tr>
              )}
              {filtradas.map((f, i) => {
                const est = uiEstado(f.estado_codigo, f.estado_nombre);
                const primeraDeSolicitud = i === 0 || filtradas[i - 1].solicitud_id !== f.solicitud_id;
                return (
                  <tr key={f.linea_id} style={{ background: primeraDeSolicitud ? "#fff" : "#FCFEFD" }}>
                    {COLUMNAS.map(c => {
                      const v = valorCelda(f, c.key);
                      if (c.key === "estado") return (
                        <td key={c.key} style={td}><span title={f.lote_numero ? `Bloque ${f.lote_numero}` : ""} style={{ fontSize: 11, fontWeight: 600, color: est.color, background: est.bg, padding: "2px 9px", borderRadius: 20 }}>{est.label}</span></td>
                      );
                      return (
                        <td key={c.key} title={String(v)} style={{ ...td, textAlign: c.num ? "right" : "left", fontWeight: c.fuerte ? 700 : 400, color: c.fuerte ? "#0F6E56" : (v === "" ? "#C9D6D0" : "#1a2e27") }}>
                          {c.num ? num(v) : (v === "" ? "—" : v)}
                        </td>
                      );
                    })}
                    <td style={{ ...td, textAlign: "center" }}>
                      {primeraDeSolicitud && (
                        <button onClick={() => descargar(f)} disabled={bajando === f.solicitud_id} title={`Descargar despacho_, CARGA A WMS_ y CARGA LIBRO 1_ de ${f.numero}`}
                          style={{ height: 26, padding: "0 8px", fontSize: 11, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: bajando === f.solicitud_id ? "wait" : "pointer" }}>
                          {bajando === f.solicitud_id ? "…" : "⬇ .xlsx"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isMobile && datos.length > 0 && (
        <div style={{ padding: "6px 16px", fontSize: 11, color: "#9CB8AE", borderTop: "1px solid #F0F5F3" }}>
          Desplace la tabla a la derecha para ver todos los campos. Filtros: escriba parte del texto o use * como comodín (ej. <b>PTC*2025</b>).
        </div>
      )}
    </div>
  );
}
