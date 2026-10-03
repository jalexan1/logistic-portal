// ── SolicitudesDelDia.jsx ────────────────────────────────────────────────
// Tabla dentro de la pantalla Despachos con las solicitudes que se van
// radicando. Por defecto muestra las de HOY; los filtros permiten consultar
// un rango de fechas. Se recarga sola cada vez que se radica una solicitud
// (prop `recarga`). La lectura respeta los permisos del usuario:
//  · solicitante → ve las suyas   · operador / consulta / admin → ve todas
// Para cambiar estados o ver el detalle completo está la pestaña Solicitudes.
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { listarSolicitudes, obtenerLineas } from "../services/solicitudesService";
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

  const esHoy = desde === hoy() && hasta === hoy();
  const rangoInvalido = Boolean(desde && hasta && desde > hasta);

  const cargar = useCallback(async () => {
    if (rangoInvalido) { setDatos([]); setError("La fecha «Desde» no puede ser posterior a «Hasta»."); return; }
    setCargando(true); setError("");
    try { setDatos(await listarSolicitudes({ desde, hasta, limite: 500 })); }
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

  const verHoy = () => { setDesde(hoy()); setHasta(hoy()); };

  const descargarExcel = async (sol) => {
    setBajando(sol.id);
    try {
      const lineas = await obtenerLineas(sol.id);
      const headers = ["Entrega","Destinat.","Nombre destinatario de mercancías","Lugar-destinatario","Material","Cantidad entrega","UM","item","bodega"];
      const rows = lineas.map(l => [l.entrega, l.destinatario_nit, l.destinatario_nombre, l.destinatario_ciudad, l.material, Number(l.cantidad), l.um, l.item, l.bodega]);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws["!cols"] = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];
      XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
      XLSX.writeFile(wb, `despacho_${(sol.area_solicitante || "envio").replace(/\s+/g, "_")}_${sol.numero}.xlsx`);
    } catch (e) {
      if (showToast) showToast("⚠ " + e.message);
    } finally { setBajando(null); }
  };

  const inputFecha = { height: 34, padding: "0 8px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none" };
  const btn = { height: 34, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
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
        <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 720 : 0 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                <th style={th}>N° solicitud</th>
                <th style={th}>{esHoy ? "Hora" : "Fecha y hora"}</th>
                <th style={th}>Área</th>
                <th style={th}>Solicitante</th>
                <th style={th}>Origen</th>
                <th style={{ ...th, textAlign: "right" }}>Líneas</th>
                <th style={{ ...th, textAlign: "right" }}>Unidades</th>
                <th style={th}>Estado</th>
                <th style={{ ...th, textAlign: "center" }}>Excel</th>
              </tr>
            </thead>
            <tbody>
              {datos.map(sol => {
                const est = ESTADO_UI[sol.estado_codigo] || { label: sol.estado_nombre || sol.estado_codigo, color: "#6B8F80", bg: "#F2F8F5" };
                return (
                  <tr key={sol.id}>
                    <td style={{ ...td, fontWeight: 700, color: "#0F6E56" }}>{sol.numero}</td>
                    <td style={td}>{esHoy ? horaBogota(sol.radicada_at) : fechaHoraBogota(sol.radicada_at)}</td>
                    <td style={td}>{sol.area_solicitante}</td>
                    <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={sol.solicitante_correo || ""}>{sol.solicitante_nombre}</td>
                    <td style={{ ...td, color: "#6B8F80" }}>{sol.origen === "PDF" ? `PDF${sol.numero_pedido_origen ? " · " + sol.numero_pedido_origen : ""}` : "Manual"}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(sol.total_lineas)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{num(sol.total_unidades)}</td>
                    <td style={td}>
                      <span title={sol.motivo_anulacion || (sol.lote_numero ? `Bloque ${sol.lote_numero}` : "")} style={{ fontSize: 11, fontWeight: 600, color: est.color, background: est.bg, padding: "3px 10px", borderRadius: 20 }}>{est.label}</span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button onClick={() => descargarExcel(sol)} disabled={bajando === sol.id} title={`Descargar de nuevo el Excel de ${sol.numero}`}
                        style={{ height: 28, padding: "0 10px", fontSize: 11, fontWeight: 600, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: bajando === sol.id ? "wait" : "pointer" }}>
                        {bajando === sol.id ? "…" : "⬇ .xlsx"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
