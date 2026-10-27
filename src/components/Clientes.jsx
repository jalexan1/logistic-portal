// ── Clientes.jsx ─────────────────────────────────────────────────────────
// Maestro de clientes (destinatarios). Solo supervisor (rol operador) y admin.
//
//  1. «Clientes por revisar»: los creados desde la pantalla Despachos (popup).
//     El supervisor los revisa, puede corregir datos y deja una NOTA:
//       · Aprobar  → sale de esta tabla y pasa a la tabla de clientes.
//       · Rechazar → queda inactivo (ej. duplicado) y sale de las búsquedas.
//  2. «Clientes»: todo el maestro con filtros por columna, paginación y CRUD:
//     crear, editar, inactivar / reactivar y eliminar. Al eliminar se pregunta:
//       · Inactivar  (se puede recuperar), o
//       · Borrar definitivamente (no se puede recuperar; la base no lo permite
//         si el cliente ya tiene solicitudes).
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth/authContext";
import {
  listarClientes, guardarCliente, revisarCliente, cambiarActivoCliente, borrarCliente,
} from "../services/clientesMaestroService";
import { cargarCiudades, departamentoDeCiudad } from "../services/maestrosService";
import { cargarDestinatarios } from "../services/clientesService";
import { coincide } from "../utils/tablaLineas";
import CargaMasivaClientes from "./CargaMasivaClientes";
import { descargarPlantillaClientes } from "../services/plantillaClientesExcel";
import { fechaHoraBogota } from "../utils/fechas";
import Paginador from "./Paginador";

const ORIGEN = { MAESTRO: "Carga inicial", DESPACHOS: "Despachos", CLIENTES: "Pantalla Clientes", CARGA_MASIVA: "Carga masiva" };
const estadoCliente = (c) =>
  c.estado_revision === "RECHAZADO" ? { label: "Rechazado", color: "#C0392B", bg: "#FFF0EE" }
  : !c.activo ? { label: "Inactivo", color: "#6B7280", bg: "#F3F4F6" }
  : { label: "Activo", color: "#0F6E56", bg: "#E1F5EE" };

const COLUMNAS = [
  { key: "nit",          titulo: "NIT",          w: 120 },
  { key: "nombre",       titulo: "Nombre",       w: 260, fuerte: true },
  { key: "direccion",    titulo: "Dirección",    w: 220 },
  { key: "telefono",     titulo: "Teléfono",     w: 120 },
  { key: "ciudad",       titulo: "Ciudad",       w: 130 },
  { key: "departamento", titulo: "Departamento", w: 140 },
  { key: "telefono_2",   titulo: "Teléfono 2",   w: 120 },
  { key: "estado",       titulo: "Estado",       w: 100 },
  { key: "origen",       titulo: "Origen",       w: 130 },
  { key: "revision",     titulo: "Revisión",     w: 240 },
];
const valor = (c, key) =>
  key === "estado" ? estadoCliente(c).label
  : key === "origen" ? (ORIGEN[c.origen] || c.origen || "")
  : key === "revision" ? (c.revisado_at ? `${c.revisado_por_nombre || ""} · ${c.nota_revision || ""}` : "")
  : c[key] ?? "";

const campo = { height: 36, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box", width: "100%" };
const btn = { height: 34, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
const btnPri = { ...btn, background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" };
const btnRojo = { ...btn, color: "#C0392B", borderColor: "#F5C6C0" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 };
const th = { padding: "8px 8px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap", background: "#F7FCF9" };
const td = { padding: "7px 8px", fontSize: 12, color: "#1a2e27", borderBottom: "1px solid #F0F5F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

function Modal({ titulo, children, onCerrar, ancho = 560 }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);
  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: ancho, maxHeight: "90vh", overflow: "auto", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #E2EDE9" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27" }}>{titulo}</div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 32, height: 32, border: "1px solid #E2EDE9", borderRadius: 8, background: "#fff", color: "#6B8F80", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        <div style={{ padding: "16px 20px 18px" }}>{children}</div>
      </div>
    </div>
  );
}

// Campos del cliente (crear, editar y revisar)
function CamposCliente({ d, setD, faltan = {} }) {
  const cambiar = (k, v) => setD(prev => {
    const n = { ...prev, [k]: v };
    if (k === "ciudad") { const dep = departamentoDeCiudad(v); if (dep) n.departamento = dep; }
    return n;
  });
  const est = (k) => ({ ...campo, textTransform: "uppercase", ...(faltan[k] ? { background: "#FFF3BF", borderColor: "#E5B935" } : {}) });
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
        <label style={lbl}>NIT *<input value={d.nit || ""} onChange={e => cambiar("nit", e.target.value)} style={est("nit")} /></label>
        <label style={lbl}>Nombre *<input value={d.nombre || ""} onChange={e => cambiar("nombre", e.target.value)} style={est("nombre")} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={lbl}>Dirección *<input value={d.direccion || ""} onChange={e => cambiar("direccion", e.target.value)} style={est("direccion")} /></label>
        <label style={lbl}>Teléfono *<input value={d.telefono || ""} inputMode="tel" onChange={e => cambiar("telefono", e.target.value)} style={est("telefono")} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <label style={lbl}>Ciudad *<input value={d.ciudad || ""} onChange={e => cambiar("ciudad", e.target.value)} style={est("ciudad")} /></label>
        <label style={lbl}>Departamento *<input value={d.departamento || ""} onChange={e => cambiar("departamento", e.target.value)} style={est("departamento")} /></label>
        <label style={lbl}>Teléfono 2 <span style={{ color: "#9CB8AE", fontWeight: 400 }}>(opcional)</span><input value={d.telefono_2 || ""} inputMode="tel" onChange={e => cambiar("telefono_2", e.target.value)} style={campo} /></label>
      </div>
    </>
  );
}
const REQUERIDOS = ["nit", "nombre", "direccion", "telefono", "ciudad", "departamento"];
const faltantes = (d) => Object.fromEntries(REQUERIDOS.map(k => [k, !String(d[k] || "").trim()]));
const cambioDatos = (a, b) => ["nit", "nombre", "direccion", "telefono", "ciudad", "departamento", "telefono_2"]
  .some(k => String(a[k] || "").trim().toUpperCase() !== String(b[k] || "").trim().toUpperCase());

export default function Clientes() {
  const { roles } = useAuth();
  const esSupervisor = ["operador", "admin"].includes(roles?.DESPACHOS);

  const [datos, setDatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [filtros, setFiltros] = useState({});
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);

  const [revision, setRevision] = useState(null);   // { original, d, nota, faltan, error, guardando }
  const [edicion, setEdicion] = useState(null);     // { original|null, d, faltan, error, guardando }
  const [eliminar, setEliminar] = useState(null);   // { c, opcion, error, trabajando }
  const [cargaMasiva, setCargaMasiva] = useState(false);

  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 4000); };

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setDatos(await listarClientes()); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { if (esSupervisor) { cargar(); cargarCiudades().catch(() => {}); } }, [cargar, esSupervisor]);

  // Después de cualquier cambio: recargar la tabla y el maestro que usa Despachos
  const refrescar = async (msg) => { aviso(msg); await cargar(); cargarDestinatarios({ forzar: true }).catch(() => {}); };

  const pendientes = useMemo(() => datos.filter(c => c.estado_revision === "PENDIENTE")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [datos]);
  const maestro = useMemo(() => datos.filter(c => c.estado_revision !== "PENDIENTE"), [datos]);
  const filtrados = useMemo(() => maestro.filter(c => COLUMNAS.every(col => coincide(valor(c, col.key), filtros[col.key]))), [maestro, filtros]);
  const hayFiltros = Object.values(filtros).some(v => String(v || "").trim());
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtrados.length / porPagina)));
  const visibles = filtrados.slice((paginaActual - 1) * porPagina, paginaActual * porPagina);
  const filtrar = (k, v) => { setFiltros(f => ({ ...f, [k]: v })); setPagina(1); };

  if (!esSupervisor) return (
    <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, padding: 24, fontSize: 13, color: "#6B8F80" }}>
      El maestro de clientes solo lo gestionan el supervisor (operador) y el administrador.
    </div>
  );

  // ── Revisar (aprobar / rechazar) ──
  const abrirRevision = (c) => setRevision({ original: c, d: { ...c }, nota: "", faltan: {}, error: "", guardando: false });
  const confirmarRevision = async (aprobar) => {
    const r = revision;
    if (!r.nota.trim()) { setRevision({ ...r, error: "Escriba la nota de la revisión (qué se verificó o por qué se rechaza)." }); return; }
    const f = faltantes(r.d);
    if (aprobar && Object.values(f).some(Boolean)) { setRevision({ ...r, faltan: f, error: "Complete los campos marcados en amarillo antes de aprobar." }); return; }
    setRevision({ ...r, guardando: true, error: "" });
    try {
      if (aprobar && cambioDatos(r.d, r.original)) await guardarCliente({ ...r.d, id: r.original.id, version: r.original.version });
      await revisarCliente({ id: r.original.id, aprobar, nota: r.nota });
      setRevision(null);
      await refrescar(aprobar ? `✓ ${r.d.nombre} aprobado: pasó a la tabla de clientes` : `${r.d.nombre} rechazado: quedó inactivo`);
    } catch (e) { setRevision({ ...r, guardando: false, error: e.message }); }
  };

  // ── Crear / editar ──
  const guardarEdicion = async () => {
    const r = edicion;
    const f = faltantes(r.d);
    if (Object.values(f).some(Boolean)) { setEdicion({ ...r, faltan: f, error: "Complete los campos marcados en amarillo." }); return; }
    setEdicion({ ...r, guardando: true, error: "" });
    try {
      await guardarCliente({ ...r.d, id: r.original?.id ?? null, version: r.original?.version ?? null });
      setEdicion(null);
      await refrescar(r.original ? `✓ Cliente ${r.d.nombre} actualizado` : `✓ Cliente ${r.d.nombre} creado`);
    } catch (e) { setEdicion({ ...r, guardando: false, error: e.message }); }
  };

  // ── Inactivar / reactivar / borrar ──
  const reactivar = async (c) => {
    try { await cambiarActivoCliente({ id: c.id, activo: true }); await refrescar(`✓ ${c.nombre} reactivado`); }
    catch (e) { aviso("⚠ " + e.message); }
  };
  const confirmarEliminar = async () => {
    const r = eliminar;
    setEliminar({ ...r, trabajando: true, error: "" });
    try {
      if (r.opcion === "borrar") { await borrarCliente(r.c.id); setEliminar(null); await refrescar(`${r.c.nombre} borrado definitivamente`); }
      else { await cambiarActivoCliente({ id: r.c.id, activo: false }); setEliminar(null); await refrescar(`${r.c.nombre} inactivado (se puede reactivar)`); }
    } catch (e) { setEliminar({ ...r, trabajando: false, error: e.message }); }
  };

  const anchoTabla = COLUMNAS.reduce((a, c) => a + c.w, 0) + 250;

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>Maestro de clientes</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>
            {pendientes.length} por revisar · {maestro.filter(c => c.activo).length.toLocaleString("es-CO")} activos · {maestro.filter(c => !c.activo).length.toLocaleString("es-CO")} inactivos
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={descargarPlantillaClientes} title="Plantilla Excel: NIT, NOMBRE, DIRECCION, TELEFONO, CIUDAD, DEPARTAMENTO, TELEFONO 2" style={{ ...btn, height: 36 }}>⬇ Plantilla clientes</button>
          <button onClick={() => setCargaMasiva(true)} style={{ ...btn, height: 36 }}>⬆ Carga masiva</button>
          <button onClick={() => setEdicion({ original: null, d: {}, faltan: {}, error: "", guardando: false })} style={{ ...btnPri, height: 36 }}>➕ Nuevo cliente</button>
          <button onClick={cargar} disabled={cargando} style={{ ...btn, height: 36 }}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#C0392B" }}>{error}</div>}

      {/* ── 1. Clientes por revisar ── */}
      <div style={{ background: "#fff", border: `1.5px solid ${pendientes.length ? "#F59E0B" : "#E2EDE9"}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: pendientes.length ? "#FFFBEB" : "#fff", borderBottom: "1px solid #E2EDE9" }}>
          <span style={{ minWidth: 26, height: 26, borderRadius: 13, background: pendientes.length ? "#F59E0B" : "#C9D6D0", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px" }}>{pendientes.length}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2e27" }}>Clientes por revisar (creados en Despachos)</div>
            <div style={{ fontSize: 11, color: "#6B8F80" }}>Revise los datos, deje una nota y apruebe: el cliente pasa a la tabla de clientes. Si está duplicado o mal creado, recházelo.</div>
          </div>
        </div>
        {cargando && <div style={{ padding: 16, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
        {!cargando && pendientes.length === 0 && <div style={{ padding: 18, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>No hay clientes pendientes de revisión.</div>}
        {!cargando && pendientes.length > 0 && (
          <div style={{ overflow: "auto", maxHeight: 320 }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 1100 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}><tr>
                {["NIT", "Nombre", "Dirección", "Ciudad", "Departamento", "Creado por", "Creado el", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{pendientes.map(c => (
                <tr key={c.id}>
                  <td style={td}>{c.nit}</td>
                  <td style={{ ...td, fontWeight: 700, color: "#0F6E56", maxWidth: 260 }} title={c.nombre}>{c.nombre}</td>
                  <td style={{ ...td, maxWidth: 220 }} title={c.direccion || ""}>{c.direccion || "—"}</td>
                  <td style={td}>{c.ciudad || "—"}</td>
                  <td style={td}>{c.departamento || "—"}</td>
                  <td style={td}>{c.creado_por_nombre || "—"}</td>
                  <td style={td}>{fechaHoraBogota(c.created_at)}</td>
                  <td style={{ ...td, textAlign: "right" }}><button onClick={() => abrirRevision(c)} style={btnPri}>Revisar</button></td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 2. Clientes ── */}
      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderBottom: "1px solid #E2EDE9", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2e27" }}>Clientes</div>
            <div style={{ fontSize: 11, color: "#6B8F80" }}>{filtrados.length.toLocaleString("es-CO")} cliente{filtrados.length !== 1 ? "s" : ""}{hayFiltros ? " (filtrado)" : ""} · filtre cada columna; use * como comodín</div>
          </div>
          {hayFiltros && <button onClick={() => { setFiltros({}); setPagina(1); }} style={{ ...btn, color: "#B45309", borderColor: "#FCD9A0" }}>Limpiar filtros</button>}
        </div>
        <div style={{ overflow: "auto", maxHeight: "62vh" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: anchoTabla, minWidth: "100%" }}>
            <colgroup>{COLUMNAS.map(c => <col key={c.key} style={{ width: c.w }} />)}<col style={{ width: 250 }} /></colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>{COLUMNAS.map(c => <th key={c.key} style={th}>{c.titulo}</th>)}<th style={{ ...th, textAlign: "center" }}>Acciones</th></tr>
              <tr>
                {COLUMNAS.map(c => (
                  <th key={c.key} style={{ ...th, padding: "0 6px 6px", borderBottom: "1px solid #E2EDE9" }}>
                    {c.key === "estado" ? (
                      <select value={filtros.estado || ""} onChange={e => filtrar("estado", e.target.value)} style={{ ...campo, height: 26, fontSize: 11, padding: "0 6px" }}>
                        <option value="">Todos</option><option>Activo</option><option>Inactivo</option><option>Rechazado</option>
                      </select>
                    ) : (
                      <input value={filtros[c.key] || ""} placeholder="Filtrar…" onChange={e => filtrar(c.key, e.target.value)}
                        style={{ ...campo, height: 26, fontSize: 11, padding: "0 6px" }} />
                    )}
                  </th>))}
                <th style={{ ...th, borderBottom: "1px solid #E2EDE9" }} />
              </tr>
            </thead>
            <tbody>
              {!cargando && visibles.length === 0 && <tr><td colSpan={COLUMNAS.length + 1} style={{ ...td, textAlign: "center", color: "#9CB8AE", padding: 18 }}>Ningún cliente cumple los filtros.</td></tr>}
              {visibles.map(c => {
                const est = estadoCliente(c);
                return (
                  <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.65 }}>
                    {COLUMNAS.map(col => {
                      const v = valor(c, col.key);
                      if (col.key === "estado") return <td key={col.key} style={td}><span style={{ fontSize: 11, fontWeight: 600, color: est.color, background: est.bg, padding: "2px 9px", borderRadius: 20 }}>{est.label}</span></td>;
                      return <td key={col.key} title={String(v)} style={{ ...td, fontWeight: col.fuerte ? 700 : 400, color: col.fuerte ? "#0F6E56" : (v === "" ? "#C9D6D0" : "#1a2e27") }}>{v === "" ? "—" : v}</td>;
                    })}
                    <td style={{ ...td, textAlign: "center", overflow: "visible" }}>
                      <span style={{ display: "inline-flex", gap: 5 }}>
                        <button onClick={() => setEdicion({ original: c, d: { ...c }, faltan: {}, error: "", guardando: false })} style={{ ...btn, height: 28, fontSize: 11 }}>Editar</button>
                        {c.activo
                          ? <button onClick={() => setEliminar({ c, opcion: "inactivar", error: "", trabajando: false })} style={{ ...btnRojo, height: 28, fontSize: 11 }}>Eliminar</button>
                          : <>
                              <button onClick={() => reactivar(c)} style={{ ...btn, height: 28, fontSize: 11 }}>Reactivar</button>
                              <button onClick={() => setEliminar({ c, opcion: "borrar", error: "", trabajando: false })} style={{ ...btnRojo, height: 28, fontSize: 11 }}>Eliminar</button>
                            </>}
                      </span>
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
        <Paginador total={filtrados.length} pagina={paginaActual} porPagina={porPagina}
          onPagina={setPagina} onPorPagina={n => { setPorPagina(n); setPagina(1); }} unidad="clientes" />
      </div>

      {/* ── Ventana: revisar ── */}
      {revision && (
        <Modal titulo={`Revisar cliente creado en Despachos`} onCerrar={() => !revision.guardando && setRevision(null)} ancho={620}>
          <div style={{ fontSize: 12, color: "#6B8F80", marginBottom: 12 }}>
            Creado por <b>{revision.original.creado_por_nombre || "—"}</b> el {fechaHoraBogota(revision.original.created_at)}. Puede corregir los datos antes de aprobar.
          </div>
          <CamposCliente d={revision.d} setD={(fn) => setRevision(r => ({ ...r, d: typeof fn === "function" ? fn(r.d) : fn }))} faltan={revision.faltan} />
          <label style={{ ...lbl, marginTop: 12 }}>Nota de la revisión *
            <textarea value={revision.nota} onChange={e => setRevision(r => ({ ...r, nota: e.target.value }))} rows={3}
              placeholder="Ej.: Verificado con el RUT y la orden de compra. / Duplicado de BELLPROF GROUP S.A.S."
              style={{ ...campo, height: "auto", padding: 10, fontFamily: "inherit", resize: "vertical" }} />
          </label>
          {revision.error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#C0392B" }}>⚠ {revision.error}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={() => confirmarRevision(false)} disabled={revision.guardando} style={btnRojo}>Rechazar (queda inactivo)</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setRevision(null)} disabled={revision.guardando} style={btn}>Cancelar</button>
              <button onClick={() => confirmarRevision(true)} disabled={revision.guardando} style={btnPri}>{revision.guardando ? "Guardando…" : "✓ Aprobar"}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Ventana: crear / editar ── */}
      {edicion && (
        <Modal titulo={edicion.original ? `Editar cliente` : "Nuevo cliente"} onCerrar={() => !edicion.guardando && setEdicion(null)}>
          <CamposCliente d={edicion.d} setD={(fn) => setEdicion(r => ({ ...r, d: typeof fn === "function" ? fn(r.d) : fn }))} faltan={edicion.faltan} />
          {edicion.error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#C0392B" }}>⚠ {edicion.error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={() => setEdicion(null)} disabled={edicion.guardando} style={btn}>Cancelar</button>
            <button onClick={guardarEdicion} disabled={edicion.guardando} style={btnPri}>{edicion.guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </Modal>
      )}

      {/* ── Ventana: eliminar (inactivar o borrar) ── */}
      {eliminar && (
        <Modal titulo={`Eliminar ${eliminar.c.nombre}`} onCerrar={() => !eliminar.trabajando && setEliminar(null)} ancho={500}>
          <div style={{ fontSize: 13, color: "#44574F", marginBottom: 12 }}>¿Qué desea hacer con este cliente?</div>
          {[
            ["inactivar", "Inactivarlo", "Deja de aparecer en las búsquedas de Despachos. Se puede reactivar cuando quiera.", "#0F6E56", eliminar.c.activo],
            ["borrar", "Borrarlo de la base de datos", "Se elimina definitivamente y NO se podrá recuperar. Si el cliente ya tiene solicitudes, no se permite.", "#C0392B", true],
          ].filter(o => o[4]).map(([k, t, d, color]) => (
            <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1.5px solid ${eliminar.opcion === k ? color : "#E2EDE9"}`, background: eliminar.opcion === k ? (k === "borrar" ? "#FFF5F5" : "#F0FBF6") : "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer" }}>
              <input type="radio" name="opcion" checked={eliminar.opcion === k} onChange={() => setEliminar(r => ({ ...r, opcion: k, error: "" }))}
                style={{ width: 16, height: 16, marginTop: 2, borderRadius: 8, border: `2px solid ${color}`, background: eliminar.opcion === k ? color : "#fff", boxShadow: eliminar.opcion === k ? "inset 0 0 0 3px #fff" : "none", flexShrink: 0 }} />
              <span><b style={{ color }}>{t}</b><br /><span style={{ fontSize: 12, color: "#44574F" }}>{d}</span></span>
            </label>))}
          {eliminar.opcion === "borrar" && <div style={{ fontSize: 12, fontWeight: 600, color: "#C0392B", margin: "4px 0 6px" }}>⚠ Esta acción no se puede deshacer.</div>}
          {eliminar.error && <div style={{ fontSize: 12.5, color: "#C0392B", marginTop: 6 }}>⚠ {eliminar.error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button onClick={() => setEliminar(null)} disabled={eliminar.trabajando} style={btn}>Cancelar</button>
            <button onClick={confirmarEliminar} disabled={eliminar.trabajando}
              style={eliminar.opcion === "borrar" ? { ...btn, background: "#C0392B", color: "#fff", borderColor: "#C0392B" } : btnPri}>
              {eliminar.trabajando ? "Procesando…" : eliminar.opcion === "borrar" ? "Borrar definitivamente" : "Inactivar"}
            </button>
          </div>
        </Modal>
      )}

      {cargaMasiva && <CargaMasivaClientes onCerrar={() => setCargaMasiva(false)} onCargado={(msg) => refrescar(msg)} />}

      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13, fontWeight: 500, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}
