// ── Articulos.jsx ────────────────────────────────────────────────────────
// Maestros → Artículos (supervisor = operador, y admin).
// Maestro Item / EAN (core.item_ean): el EAN se usa al cargar pedidos (PDF y
// Excel) y en los archivos CARGA A WMS / DESPACHO.
// CRUD como el de Clientes: crear, editar, eliminar (inactivar o borrar
// definitivo), reactivar; filtros por columna y paginación.
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth/authContext";
import { listarArticulos, guardarArticulo, cambiarActivoArticulo, borrarArticulo } from "../services/articulosService";
import { coincide } from "../utils/tablaLineas";
import { fechaHoraBogota } from "../utils/fechas";
import Paginador from "./Paginador";
import CargaMasivaArticulos from "./CargaMasivaArticulos";
import { descargarPlantillaArticulos } from "../services/plantillaArticulosExcel";

const COLUMNAS = [
  { key: "item",        titulo: "Item (SKU)",  w: 150, fuerte: true },
  { key: "ean",         titulo: "EAN",         w: 170 },
  { key: "descripcion", titulo: "Descripción", w: 380 },
  { key: "estado",      titulo: "Estado",      w: 100 },
  { key: "modificado",  titulo: "Modificado",  w: 140 },
];
const valor = (a, k) => k === "estado" ? (a.activo ? "Activo" : "Inactivo")
  : k === "modificado" ? (a.updated_at ? fechaHoraBogota(a.updated_at) : fechaHoraBogota(a.created_at))
  : a[k] ?? "";

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

export default function Articulos() {
  const { roles } = useAuth();
  const esSupervisor = ["operador", "admin"].includes(roles?.DESPACHOS);
  const [datos, setDatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [filtros, setFiltros] = useState({});
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [edicion, setEdicion] = useState(null);   // { original|null, d, faltan, error, guardando }
  const [eliminar, setEliminar] = useState(null); // { a, opcion, error, trabajando }
  const [cargaMasiva, setCargaMasiva] = useState(false);   // 28-oct: plantilla ITEM | EAN | DESCRIPCION
  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 4000); };

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setDatos(await listarArticulos()); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { if (esSupervisor) cargar(); }, [cargar, esSupervisor]);

  const filtrados = useMemo(() => datos.filter(a => COLUMNAS.every(c => coincide(valor(a, c.key), filtros[c.key]))), [datos, filtros]);
  const hayFiltros = Object.values(filtros).some(v => String(v || "").trim());
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filtrados.length / porPagina)));
  const visibles = filtrados.slice((paginaActual - 1) * porPagina, paginaActual * porPagina);
  const filtrar = (k, v) => { setFiltros(f => ({ ...f, [k]: v })); setPagina(1); };

  if (!esSupervisor) return (
    <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, padding: 24, fontSize: 13, color: "#6B8F80" }}>
      El maestro de artículos solo lo gestionan el supervisor (operador) y el administrador.
    </div>
  );

  const guardar = async () => {
    const r = edicion;
    const faltan = { item: !String(r.d.item || "").trim(), ean: !String(r.d.ean || "").trim() };
    if (faltan.item || faltan.ean) { setEdicion({ ...r, faltan, error: "Item (SKU) y EAN son obligatorios." }); return; }
    setEdicion({ ...r, guardando: true, error: "" });
    try {
      await guardarArticulo({ ...r.d, id: r.original?.id ?? null, version: r.original?.version ?? null });
      setEdicion(null); aviso(r.original ? `✓ Artículo ${r.d.item} actualizado` : `✓ Artículo ${r.d.item} creado`); cargar();
    } catch (e) { setEdicion({ ...r, guardando: false, error: e.message }); }
  };
  const reactivar = async (a) => {
    try { await cambiarActivoArticulo({ id: a.id, activo: true }); aviso(`✓ ${a.item} reactivado`); cargar(); }
    catch (e) { aviso("⚠ " + e.message); }
  };
  const confirmarEliminar = async () => {
    const r = eliminar;
    setEliminar({ ...r, trabajando: true, error: "" });
    try {
      if (r.opcion === "borrar") { await borrarArticulo(r.a.id); aviso(`${r.a.item} borrado definitivamente`); }
      else { await cambiarActivoArticulo({ id: r.a.id, activo: false }); aviso(`${r.a.item} inactivado (se puede reactivar)`); }
      setEliminar(null); cargar();
    } catch (e) { setEliminar({ ...r, trabajando: false, error: e.message }); }
  };

  const ancho = COLUMNAS.reduce((s, c) => s + c.w, 0) + 200;
  const est = (k) => ({ ...campo, ...(edicion?.faltan?.[k] ? { background: "#FFF3BF", borderColor: "#E5B935" } : {}) });

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>Maestro de artículos</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>Item (SKU) y código EAN que se usan al cargar pedidos · {datos.filter(a => a.activo).length.toLocaleString("es-CO")} activos · {datos.filter(a => !a.activo).length.toLocaleString("es-CO")} inactivos</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={descargarPlantillaArticulos} title="Plantilla Excel: ITEM | EAN | DESCRIPCION" style={{ ...btn, height: 36 }}>⬇ Plantilla artículos</button>
          <button onClick={() => setCargaMasiva(true)} title="Cargar o actualizar muchos artículos desde Excel" style={{ ...btn, height: 36 }}>⬆ Carga masiva</button>
          <button onClick={() => setEdicion({ original: null, d: {}, faltan: {}, error: "", guardando: false })} style={{ ...btnPri, height: 36 }}>➕ Nuevo artículo</button>
          <button onClick={cargar} disabled={cargando} style={{ ...btn, height: 36 }}>↻ Actualizar</button>
        </div>
      </div>
      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#C0392B" }}>{error}</div>}

      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderBottom: "1px solid #E2EDE9", flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: "#6B8F80" }}>{filtrados.length.toLocaleString("es-CO")} artículo{filtrados.length !== 1 ? "s" : ""}{hayFiltros ? " (filtrado)" : ""} · filtre cada columna; use * como comodín</div>
          {hayFiltros && <button onClick={() => { setFiltros({}); setPagina(1); }} style={{ ...btn, color: "#B45309", borderColor: "#FCD9A0" }}>Limpiar filtros</button>}
        </div>
        <div style={{ overflow: "auto", maxHeight: "62vh" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: ancho, minWidth: "100%" }}>
            <colgroup>{COLUMNAS.map(c => <col key={c.key} style={{ width: c.w }} />)}<col style={{ width: 200 }} /></colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>{COLUMNAS.map(c => <th key={c.key} style={th}>{c.titulo}</th>)}<th style={{ ...th, textAlign: "center" }}>Acciones</th></tr>
              <tr>{COLUMNAS.map(c => (
                <th key={c.key} style={{ ...th, padding: "0 6px 6px", borderBottom: "1px solid #E2EDE9" }}>
                  {c.key === "estado"
                    ? <select value={filtros.estado || ""} onChange={e => filtrar("estado", e.target.value)} style={{ ...campo, height: 26, fontSize: 11, padding: "0 6px" }}><option value="">Todos</option><option>Activo</option><option>Inactivo</option></select>
                    : <input value={filtros[c.key] || ""} placeholder="Filtrar…" onChange={e => filtrar(c.key, e.target.value)} style={{ ...campo, height: 26, fontSize: 11, padding: "0 6px" }} />}
                </th>))}<th style={{ ...th, borderBottom: "1px solid #E2EDE9" }} /></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={COLUMNAS.length + 1} style={{ ...td, padding: 18, color: "#6B8F80" }}>Cargando…</td></tr>}
              {!cargando && visibles.length === 0 && <tr><td colSpan={COLUMNAS.length + 1} style={{ ...td, textAlign: "center", color: "#9CB8AE", padding: 18 }}>Ningún artículo cumple los filtros.</td></tr>}
              {!cargando && visibles.map(a => (
                <tr key={a.id} style={{ opacity: a.activo ? 1 : 0.6 }}>
                  {COLUMNAS.map(c => {
                    const v = valor(a, c.key);
                    if (c.key === "estado") return <td key={c.key} style={td}><span style={{ fontSize: 11, fontWeight: 600, color: a.activo ? "#0F6E56" : "#6B7280", background: a.activo ? "#E1F5EE" : "#F3F4F6", padding: "2px 9px", borderRadius: 20 }}>{v}</span></td>;
                    return <td key={c.key} title={String(v)} style={{ ...td, fontWeight: c.fuerte ? 700 : 400, color: c.fuerte ? "#0F6E56" : (v === "" ? "#C9D6D0" : "#1a2e27") }}>{v === "" ? "—" : v}</td>;
                  })}
                  <td style={{ ...td, textAlign: "center", overflow: "visible" }}>
                    <span style={{ display: "inline-flex", gap: 5 }}>
                      <button onClick={() => setEdicion({ original: a, d: { ...a }, faltan: {}, error: "", guardando: false })} style={{ ...btn, height: 28, fontSize: 11 }}>Editar</button>
                      {!a.activo && <button onClick={() => reactivar(a)} style={{ ...btn, height: 28, fontSize: 11 }}>Reactivar</button>}
                      <button onClick={() => setEliminar({ a, opcion: a.activo ? "inactivar" : "borrar", error: "", trabajando: false })} style={{ ...btnRojo, height: 28, fontSize: 11 }}>Eliminar</button>
                    </span>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <Paginador total={filtrados.length} pagina={paginaActual} porPagina={porPagina} onPagina={setPagina} onPorPagina={n => { setPorPagina(n); setPagina(1); }} unidad="artículos" />
      </div>

      {cargaMasiva && <CargaMasivaArticulos onCerrar={() => setCargaMasiva(false)} onCargado={(m) => { aviso(m); cargar(); }} />}

      {edicion && (
        <Modal titulo={edicion.original ? `Editar artículo ${edicion.original.item}` : "Nuevo artículo"} onCerrar={() => !edicion.guardando && setEdicion(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <label style={lbl}>Item (SKU) *<input value={edicion.d.item || ""} onChange={e => setEdicion(r => ({ ...r, d: { ...r.d, item: e.target.value.toUpperCase() } }))} placeholder="PTC9121" style={{ ...est("item"), textTransform: "uppercase" }} /></label>
            <label style={lbl}>EAN *<input value={edicion.d.ean || ""} onChange={e => setEdicion(r => ({ ...r, d: { ...r.d, ean: e.target.value } }))} placeholder="7709268279632" style={est("ean")} /></label>
          </div>
          <label style={lbl}>Descripción<input value={edicion.d.descripcion || ""} onChange={e => setEdicion(r => ({ ...r, d: { ...r.d, descripcion: e.target.value } }))} style={campo} /></label>
          <div style={{ fontSize: 11, color: "#9CB8AE", marginTop: 8 }}>El Item es el SKU sin el año: al cargar pedidos, «PTC9121-2026» toma el EAN de «PTC9121». No se permiten Items ni EAN repetidos.</div>
          {edicion.error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#C0392B" }}>⚠ {edicion.error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={() => setEdicion(null)} disabled={edicion.guardando} style={btn}>Cancelar</button>
            <button onClick={guardar} disabled={edicion.guardando} style={btnPri}>{edicion.guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </Modal>
      )}

      {eliminar && (
        <Modal titulo={`Eliminar ${eliminar.a.item}`} onCerrar={() => !eliminar.trabajando && setEliminar(null)} ancho={500}>
          <div style={{ fontSize: 13, color: "#44574F", marginBottom: 12 }}>¿Qué desea hacer con este artículo?</div>
          {[
            ["inactivar", "Inactivarlo", "Deja de usarse para completar el EAN al cargar pedidos. Se puede reactivar cuando quiera.", "#0F6E56", eliminar.a.activo],
            ["borrar", "Borrarlo de la base de datos", "Se elimina definitivamente y NO se podrá recuperar. Las solicitudes ya radicadas conservan su SKU y EAN.", "#C0392B", true],
          ].filter(o => o[4]).map(([k, t, d, color]) => (
            <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1.5px solid ${eliminar.opcion === k ? color : "#E2EDE9"}`, background: eliminar.opcion === k ? (k === "borrar" ? "#FFF5F5" : "#F0FBF6") : "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer" }}>
              <input type="radio" name="opcionArt" checked={eliminar.opcion === k} onChange={() => setEliminar(r => ({ ...r, opcion: k, error: "" }))}
                style={{ width: 16, height: 16, marginTop: 2, borderRadius: 8, border: `2px solid ${color}`, background: eliminar.opcion === k ? color : "#fff", boxShadow: eliminar.opcion === k ? "inset 0 0 0 3px #fff" : "none", flexShrink: 0 }} />
              <span><b style={{ color }}>{t}</b><br /><span style={{ fontSize: 12, color: "#44574F" }}>{d}</span></span>
            </label>))}
          {eliminar.opcion === "borrar" && <div style={{ fontSize: 12, fontWeight: 600, color: "#C0392B", margin: "4px 0 6px" }}>⚠ Esta acción no se puede deshacer.</div>}
          {eliminar.error && <div style={{ fontSize: 12.5, color: "#C0392B", marginTop: 6 }}>⚠ {eliminar.error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button onClick={() => setEliminar(null)} disabled={eliminar.trabajando} style={btn}>Cancelar</button>
            <button onClick={confirmarEliminar} disabled={eliminar.trabajando} style={eliminar.opcion === "borrar" ? { ...btn, background: "#C0392B", color: "#fff", borderColor: "#C0392B" } : btnPri}>
              {eliminar.trabajando ? "Procesando…" : eliminar.opcion === "borrar" ? "Borrar definitivamente" : "Inactivar"}
            </button>
          </div>
        </Modal>
      )}
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}
