// ── BuscadorMaestro.jsx ──────────────────────────────────────────────────
// Popup de búsqueda (lupa) sobre un maestro, con filtros por campo y comodines.
//   tipo="destinatario" → maestro de clientes (core.destinatarios)
//   tipo="item"         → core.item_ean (Item, EAN, descripción)
// "*" o "%" = cualquier texto en medio (ej. "bell*group"); siempre busca "contiene".
// Al elegir una fila llama onElegir(fila) y se cierra.
// Fase 4: resultados paginados (5, 10, 15, 30, 70, 100, 150 · arranca en 10).
// Fase 5 (clientes):
//   · Si se escribe el NOMBRE, la búsqueda es por PARECIDO: no importan tildes,
//     mayúsculas, "S.A.S"/"SAS" ni pequeños errores de digitación. Si hay varios
//     parecidos se ordenan del más al menos parecido para elegir el correcto.
//   · Si no aparece el cliente, se ofrece «Crear cliente nuevo» (NIT, nombre,
//     dirección, ciudad, departamento). Queda PENDIENTE de revisión del
//     supervisor y se puede usar de inmediato.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { buscarDestinatarios, buscarItems, cargarCiudades, departamentoDeCiudad } from "../services/maestrosService";
import { buscarClientesParecidos, crearClienteDespachos } from "../services/clientesMaestroService";
import Paginador from "./Paginador";

const OPCIONES_POPUP = [5, 10, 15, 30, 70, 100, 150];
const LIMITE = 500;   // máximo de resultados por búsqueda

const contiene = (valor, filtro) => {
  const f = String(filtro || "").trim().toLowerCase().replace(/%/g, "*");
  if (!f) return true;
  const v = String(valor ?? "").toLowerCase();
  const re = new RegExp(f.split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
  return re.test(v);
};

// Clientes: con nombre → búsqueda por parecido (y NIT / ciudad como filtro adicional);
// sin nombre → búsqueda normal por NIT / ciudad.
async function buscarClientes(f, limite) {
  const nombre = String(f.nombre || "").replace(/[*%]/g, " ").trim();
  if (nombre.length >= 2) {
    const filas = await buscarClientesParecidos(nombre, limite);
    return { filas: filas.filter(r => contiene(r.nit, f.nit) && contiene(r.ciudad, f.ciudad)), parecido: true };
  }
  return { filas: await buscarDestinatarios(f, limite), parecido: false };
}

const CONFIG = {
  destinatario: {
    titulo: "Buscar cliente / destinatario",
    filtros: [["nit", "NIT"], ["nombre", "Nombre"], ["ciudad", "Ciudad"]],
    columnas: [["nit", "NIT", 110], ["nombre", "Nombre", 250], ["direccion", "Dirección", 190], ["ciudad", "Ciudad", 110], ["departamento", "Departamento", 120]],
    buscar: buscarClientes,
  },
  item: {
    titulo: "Buscar ítem / EAN",
    filtros: [["item", "Item (SKU)"], ["ean", "EAN"], ["descripcion", "Descripción"]],
    columnas: [["item", "Item (SKU)", 120], ["ean", "EAN", 140], ["descripcion", "Descripción", 340]],
    buscar: async (f, limite) => ({ filas: await buscarItems(f, limite), parecido: false }),
  },
};

const campo = { height: 34, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box", width: "100%" };
const btnPrimario = { height: 36, padding: "0 16px", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 8, background: "#0F6E56", color: "#fff", cursor: "pointer" };
const btnSecundario = { height: 36, padding: "0 14px", fontSize: 13, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer" };

// ── Formulario «Crear cliente nuevo» ─────────────────────────────────────
function CrearCliente({ inicial, onCreado, onVolver }) {
  const [d, setD] = useState({ nit: "", nombre: "", direccion: "", ciudad: "", departamento: "", ...inicial });
  const [error, setError] = useState("");
  const [faltan, setFaltan] = useState({});
  const [guardando, setGuardando] = useState(false);
  const primero = useRef(null);
  useEffect(() => { cargarCiudades().catch(() => {}); primero.current?.focus(); }, []);

  const cambiar = (k, v) => {
    setD(prev => {
      const n = { ...prev, [k]: v };
      // El departamento se deduce de la ciudad (se puede corregir a mano)
      if (k === "ciudad") { const dep = departamentoDeCiudad(v); if (dep) n.departamento = dep; }
      return n;
    });
    setFaltan(f => ({ ...f, [k]: false }));
  };

  const guardar = async (e) => {
    e.preventDefault();
    const req = ["nit", "nombre", "direccion", "ciudad", "departamento"];
    const f = Object.fromEntries(req.map(k => [k, !String(d[k] || "").trim()]));
    if (Object.values(f).some(Boolean)) { setFaltan(f); setError("Complete los campos marcados en amarillo."); return; }
    setGuardando(true); setError("");
    try { onCreado(await crearClienteDespachos(d)); }
    catch (err) { setError(err.message); }
    finally { setGuardando(false); }
  };

  const etiqueta = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 };
  const input = (k) => ({ ...campo, height: 38, textTransform: "uppercase", ...(faltan[k] ? { background: "#FFF3BF", borderColor: "#E5B935" } : {}) });

  return (
    <form onSubmit={guardar} style={{ padding: "16px 18px", overflow: "auto" }}>
      <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#1E3A8A", marginBottom: 14, lineHeight: 1.5 }}>
        El cliente quedará <b>pendiente de revisión</b> por el supervisor, pero puede radicar con él de inmediato.
        Verifique bien los datos: el registro queda a su nombre.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
        <label style={etiqueta}>NIT *<input ref={primero} value={d.nit} onChange={e => cambiar("nit", e.target.value)} placeholder="Sin puntos ni guion" style={input("nit")} /></label>
        <label style={etiqueta}>Nombre *<input value={d.nombre} onChange={e => cambiar("nombre", e.target.value)} style={input("nombre")} /></label>
      </div>
      <label style={{ ...etiqueta, marginBottom: 10 }}>Dirección *<input value={d.direccion} onChange={e => cambiar("direccion", e.target.value)} placeholder="CRA 45 # 35 27" style={input("direccion")} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={etiqueta}>Ciudad *<input value={d.ciudad} onChange={e => cambiar("ciudad", e.target.value)} placeholder="MEDELLÍN" style={input("ciudad")} /></label>
        <label style={etiqueta}>Departamento *<input value={d.departamento} onChange={e => cambiar("departamento", e.target.value)} placeholder="Se llena con la ciudad" style={input("departamento")} /></label>
      </div>
      {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#C0392B", background: "#FFF5F5", border: "1px solid #F5C6C0", borderRadius: 8, padding: "8px 12px" }}>⚠ {error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onVolver} disabled={guardando} style={btnSecundario}>← Volver a la búsqueda</button>
        <button type="submit" disabled={guardando} style={{ ...btnPrimario, opacity: guardando ? 0.7 : 1, cursor: guardando ? "wait" : "pointer" }}>{guardando ? "Creando…" : "Crear cliente y usarlo"}</button>
      </div>
    </form>
  );
}

export default function BuscadorMaestro({ tipo, inicial = {}, onElegir, onCerrar, permitirCrear = true, datosCrear = null }) {
  const cfg = CONFIG[tipo];
  const esCliente = tipo === "destinatario";
  const [filtros, setFiltros] = useState(() => Object.fromEntries(cfg.filtros.map(([k]) => [k, inicial[k] || ""])));
  const [filas, setFilas] = useState([]);
  const [parecido, setParecido] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [creando, setCreando] = useState(false);
  const primero = useRef(null);

  const buscar = async (f = filtros) => {
    setCargando(true); setError("");
    try { const r = await cfg.buscar(f, LIMITE); setFilas(r.filas); setParecido(r.parecido); setPagina(1); }
    catch (e) { setError(e.message); setFilas([]); }
    finally { setCargando(false); setBuscado(true); }
  };

  // Búsqueda inicial con lo que traía la celda
  useEffect(() => { buscar(); primero.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);

  // Página visible de los resultados
  const paginaActual = Math.min(pagina, Math.max(1, Math.ceil(filas.length / porPagina)));
  const visibles = filas.slice((paginaActual - 1) * porPagina, paginaActual * porPagina);
  const columnas = esCliente && parecido ? [...cfg.columnas, ["similitud", "Parecido", 84]] : cfg.columnas;
  const puedeCrear = esCliente && permitirCrear && buscado && !cargando;

  const elegir = (f) => { onElegir(f); onCerrar(); };

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 920, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #E2EDE9" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27" }}>{creando ? "➕ Crear cliente nuevo" : `🔍 ${cfg.titulo}`}</div>
            {!creando && <div style={{ fontSize: 11, color: "#6B8F80" }}>
              {esCliente
                ? <>Escriba el nombre o parte de él: también encuentra nombres <b>parecidos</b> (tildes, S.A.S, errores de digitación). Enter para buscar.</>
                : <>Escriba parte del texto; use * para saltar palabras (ej. <b>bell*group</b>). Enter para buscar.</>}
            </div>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ width: 32, height: 32, border: "1px solid #E2EDE9", borderRadius: 8, background: "#fff", color: "#6B8F80", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>

        {creando ? (
          <CrearCliente inicial={{ nit: filtros.nit || "", nombre: filtros.nombre || "", ciudad: filtros.ciudad || "", departamento: departamentoDeCiudad(filtros.ciudad),
              // Datos que ya trae el pedido (ej. plantilla Excel): el formulario queda prellenado
              ...Object.fromEntries(Object.entries(datosCrear || {}).filter(([, v]) => String(v || "").trim())) }}
            onVolver={() => setCreando(false)}
            onCreado={(c) => elegir(c)} />
        ) : (
          <>
            <form onSubmit={e => { e.preventDefault(); buscar(); }}
              style={{ display: "grid", gridTemplateColumns: `repeat(${cfg.filtros.length}, 1fr) auto`, gap: 8, padding: "12px 18px", alignItems: "end" }}>
              {cfg.filtros.map(([k, etiqueta], i) => (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 }}>
                  {etiqueta}
                  <input ref={i === 0 ? primero : null} value={filtros[k]} onChange={e => setFiltros(f => ({ ...f, [k]: e.target.value }))} style={campo} />
                </label>
              ))}
              <button type="submit" style={{ ...btnPrimario, height: 34 }}>Buscar</button>
            </form>

            {/* Aviso de parecidos: elegir el correcto */}
            {esCliente && parecido && !cargando && filas.length > 0 && (
              <div style={{ margin: "0 18px 10px", background: filas.length > 1 ? "#FFFBEB" : "#ECFDF5", border: `1px solid ${filas.length > 1 ? "#FCD9A0" : "#A7F3D0"}`, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: filas.length > 1 ? "#92400E" : "#065F46" }}>
                {filas.length > 1
                  ? <>Se encontraron <b>{filas.length} clientes parecidos</b>. Revise NIT, dirección y ciudad y <b>seleccione el correcto</b>.</>
                  : <>Se encontró <b>1 cliente parecido</b> que ya existe. Verifique los datos y selecciónelo.</>}
              </div>
            )}

            <div style={{ overflow: "auto", flex: 1, borderTop: "1px solid #E2EDE9" }}>
              {error && <div style={{ padding: 14, fontSize: 12, color: "#C0392B" }}>⚠ {error}</div>}
              {cargando && <div style={{ padding: 14, fontSize: 13, color: "#6B8F80" }}>Buscando…</div>}
              {!cargando && !error && filas.length === 0 && (
                <div style={{ padding: "22px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 13, color: "#6B8F80", marginBottom: puedeCrear ? 12 : 0 }}>
                    {esCliente ? "No se encontró ningún cliente con ese nombre ni parecido." : "Sin resultados. Ajuste los filtros o use * como comodín."}
                  </div>
                  {puedeCrear && <button onClick={() => setCreando(true)} style={btnPrimario}>➕ Crear cliente nuevo</button>}
                </div>
              )}
              {!cargando && filas.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead style={{ position: "sticky", top: 0 }}>
                    <tr>{columnas.map(([k, t, w]) => <th key={k} style={{ minWidth: w, textAlign: k === "similitud" ? "right" : "left", padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: ".06em", background: "#F7FCF9", borderBottom: "1px solid #E2EDE9" }}>{t}</th>)}</tr>
                  </thead>
                  <tbody>{visibles.map((f, i) => (
                    <tr key={i} onClick={() => elegir(f)} style={{ cursor: "pointer", borderBottom: "1px solid #F0F5F3" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#EAF7F1"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                      {columnas.map(([k]) => {
                        if (k === "similitud") return <td key={k} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: Number(f.similitud) >= 0.9 ? "#0F6E56" : "#B45309" }}>{Math.round(Number(f.similitud) * 100)}%</td>;
                        return (
                          <td key={k} style={{ padding: "8px 10px", color: f[k] ? "#1a2e27" : "#C9D6D0" }}>
                            {f[k] || "—"}
                            {k === "nombre" && f.estado_revision === "PENDIENTE" && <span title="Creado en Despachos, pendiente de revisión del supervisor" style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "#B45309", background: "#FFF7E6", border: "1px solid #FCD9A0", borderRadius: 20, padding: "1px 7px" }}>Pendiente</span>}
                          </td>);
                      })}
                    </tr>))}</tbody>
                </table>
              )}
            </div>
            {!cargando && filas.length > 0 && (
              <Paginador total={filas.length} pagina={paginaActual} porPagina={porPagina} opciones={OPCIONES_POPUP} unidad="resultados"
                onPagina={setPagina} onPorPagina={n => { setPorPagina(n); setPagina(1); }} />
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 18px", fontSize: 11, color: "#9CB8AE", borderTop: "1px solid #E2EDE9", minHeight: 36 }}>
              <span>{filas.length >= LIMITE ? `Se muestran los primeros ${LIMITE} resultados: afine la búsqueda.` : "Clic en una fila para usarla."}</span>
              {puedeCrear && filas.length > 0 && (
                <button onClick={() => setCreando(true)} style={{ border: "none", background: "transparent", color: "#0F6E56", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                  ¿Ninguno es el correcto? Crear cliente nuevo
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
