// ── CargaMasivaClientes.jsx ──────────────────────────────────────────────
// Maestros → Clientes → «⬆ Carga masiva».
//  1. El supervisor elige el Excel (plantilla o archivo de clientes).
//  2. Se limpia (nombre sin * ni comillas, teléfono sin '+57, dos teléfonos →
//     Teléfono 2) y se SIMULA en la base: qué se crea, qué se actualiza y qué
//     NO se carga y por qué. No cambia nada todavía.
//  3. «Confirmar carga» aplica. Se puede descargar el reporte de no cargados.
// La carga es idempotente (NIT como llave): repetirla no duplica clientes.
// ─────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { leerPlantillaClientes, descargarPlantillaClientes, descargarReporteCarga } from "../services/plantillaClientesExcel";
import { cargarClientesMasivo } from "../services/clientesMaestroService";

const ACCION = {
  CREAR:       { label: "Se crea",        color: "#0F6E56", bg: "#E1F5EE" },
  ACTUALIZAR:  { label: "Se actualiza",   color: "#1D4ED8", bg: "#EFF6FF" },
  SIN_CAMBIOS: { label: "Sin cambios",    color: "#6B7280", bg: "#F3F4F6" },
  DUPLICADO:   { label: "Repetida",       color: "#6B7280", bg: "#F3F4F6" },
  NO_CARGADO:  { label: "No se carga",    color: "#C0392B", bg: "#FFF0EE" },
};
const btn = { height: 36, padding: "0 14px", fontSize: 12.5, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
const btnPri = { ...btn, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" };

export default function CargaMasivaClientes({ onCerrar, onCargado }) {
  const [archivo, setArchivo] = useState("");
  const [filas, setFilas] = useState([]);
  const [resultado, setResultado] = useState(null);   // filas devueltas por la base
  const [aplicado, setAplicado] = useState(false);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState("");
  const [ver, setVer] = useState("NO_CARGADO");

  const conteo = useMemo(() => {
    const c = {}; (resultado || []).forEach(r => { c[r.accion] = (c[r.accion] || 0) + 1; }); return c;
  }, [resultado]);
  const visibles = (resultado || []).filter(r => !ver || r.accion === ver);

  const elegir = async (file) => {
    if (!file) return;
    setError(""); setResultado(null); setAplicado(false); setArchivo(file.name);
    setTrabajando("simular");
    try {
      const leidas = leerPlantillaClientes(await file.arrayBuffer());
      setFilas(leidas);
      const r = await cargarClientesMasivo(leidas, false);   // SIMULACIÓN
      setResultado(r);
      setVer(r.some(x => x.accion === "NO_CARGADO") ? "NO_CARGADO" : "");
    } catch (e) { setError(e.message); setFilas([]); }
    finally { setTrabajando(""); }
  };

  const confirmar = async () => {
    setTrabajando("aplicar"); setError("");
    try {
      const r = await cargarClientesMasivo(filas, true);
      setResultado(r); setAplicado(true);
      const c = {}; r.forEach(x => { c[x.accion] = (c[x.accion] || 0) + 1; });
      onCargado(`✓ Carga masiva: ${c.CREAR || 0} creados · ${c.ACTUALIZAR || 0} actualizados · ${c.NO_CARGADO || 0} no cargados`);
    } catch (e) { setError(e.message); }
    finally { setTrabajando(""); }
  };

  const porCargar = (conteo.CREAR || 0) + (conteo.ACTUALIZAR || 0);

  return (
    <div onClick={() => !trabajando && onCerrar()} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 900, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #E2EDE9" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27" }}>⬆ Carga masiva de clientes</div>
            <div style={{ fontSize: 11.5, color: "#6B8F80" }}>NIT como llave · no duplica · si el NIT existe con otro nombre, no se carga y sale en el reporte</div>
          </div>
          <button onClick={onCerrar} disabled={!!trabajando} aria-label="Cerrar" style={{ width: 32, height: 32, border: "1px solid #E2EDE9", borderRadius: 8, background: "#fff", color: "#6B8F80", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>

        <div style={{ padding: "14px 20px", overflow: "auto" }}>
          {/* Paso 1: archivo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <label style={{ ...btnPri, display: "inline-flex", alignItems: "center", cursor: trabajando || aplicado ? "default" : "pointer", opacity: aplicado ? 0.5 : 1 }}>
              📄 Seleccionar Excel
              <input type="file" accept=".xlsx,.xls" disabled={!!trabajando || aplicado} style={{ display: "none" }} onChange={e => elegir(e.target.files[0])} />
            </label>
            <button onClick={descargarPlantillaClientes} style={btn}>⬇ Descargar plantilla</button>
            <span style={{ fontSize: 12, color: "#44574F" }}>{archivo ? <>Archivo: <b>{archivo}</b> · {filas.length} filas</> : "Columnas: NIT, NOMBRE, DIRECCION, TELEFONO, CIUDAD, DEPARTAMENTO, TELEFONO 2 (opcional)"}</span>
          </div>
          {trabajando === "simular" && <div style={{ fontSize: 13, color: "#6B8F80", padding: "8px 0" }}>Leyendo y comparando con el maestro…</div>}
          {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: "#C0392B" }}>⚠ {error}</div>}

          {/* Paso 2: resultado de la simulación / carga */}
          {resultado && (
            <>
              <div style={{ background: aplicado ? "#ECFDF5" : "#FFFBEB", border: `1px solid ${aplicado ? "#A7F3D0" : "#FCD9A0"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: aplicado ? "#065F46" : "#92400E" }}>
                {aplicado ? <><b>Carga realizada.</b> Descargue el reporte de los NIT que no se cargaron para corregirlos.</>
                  : <><b>Simulación:</b> todavía no se ha cargado nada. Revise el resultado y pulse «Confirmar carga».</>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {[["", "Todas", resultado.length], ...Object.keys(ACCION).filter(k => conteo[k]).map(k => [k, ACCION[k].label, conteo[k]])].map(([k, t, n]) => (
                  <button key={k || "todas"} onClick={() => setVer(k)}
                    style={{ ...btn, height: 32, ...(ver === k ? { background: k ? ACCION[k].color : "#1a2e27", color: "#fff", borderColor: "transparent" } : {}) }}>{t}: {n.toLocaleString("es-CO")}</button>))}
              </div>
              <div style={{ border: "1px solid #E2EDE9", borderRadius: 10, overflow: "auto", maxHeight: "42vh" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
                  <thead style={{ position: "sticky", top: 0 }}><tr>
                    {["Fila", "NIT", "Nombre", "Resultado", "Detalle"].map(h => <th key={h} style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", background: "#F7FCF9", borderBottom: "1px solid #E2EDE9" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{visibles.slice(0, 1000).map(r => {
                    const a = ACCION[r.accion] || ACCION.SIN_CAMBIOS;
                    return (
                      <tr key={r.fila} style={{ borderBottom: "1px solid #F0F5F3" }}>
                        <td style={{ padding: "6px 8px", color: "#6B8F80" }}>{r.fila}</td>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.nit}</td>
                        <td style={{ padding: "6px 8px" }}>{r.nombre}</td>
                        <td style={{ padding: "6px 8px" }}><span style={{ fontSize: 11, fontWeight: 600, color: a.color, background: a.bg, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>{a.label}</span></td>
                        <td style={{ padding: "6px 8px", color: "#44574F" }}>{r.detalle}</td>
                      </tr>);
                  })}</tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "12px 20px", borderTop: "1px solid #E2EDE9" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {resultado && conteo.NO_CARGADO > 0 && <button onClick={() => descargarReporteCarga(resultado, { soloNoCargados: true })} style={{ ...btn, color: "#C0392B", borderColor: "#F5C6C0" }}>⬇ NIT no cargados ({conteo.NO_CARGADO})</button>}
            {resultado && <button onClick={() => descargarReporteCarga(resultado)} style={btn}>⬇ Reporte completo</button>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCerrar} disabled={!!trabajando} style={btn}>{aplicado ? "Cerrar" : "Cancelar"}</button>
            {resultado && !aplicado && (
              <button onClick={confirmar} disabled={!!trabajando || porCargar === 0} style={{ ...btnPri, opacity: porCargar === 0 ? 0.5 : 1 }}>
                {trabajando === "aplicar" ? "Cargando…" : `Confirmar carga (${porCargar.toLocaleString("es-CO")})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
