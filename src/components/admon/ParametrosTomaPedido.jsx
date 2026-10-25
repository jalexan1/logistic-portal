// ── ParametrosTomaPedido.jsx ─────────────────────────────────────────────
// Admon → Parámetros TomaPedido (solo administrador).
// Lee y guarda core.parametros (aplicación TOMAPEDIDO). Cada cambio queda en
// la auditoría de la base. Pantalla pensada para ir creciendo con más
// parámetros: se agregan en la base (SQL) y aparecen aquí solos.
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import { listarParametros, guardarParametro } from "../../services/parametrosService";
import { fechaHoraBogota } from "../../utils/fechas";

const aTexto = (p) => (p.tipo === "lista" ? (Array.isArray(p.valor) ? p.valor.join(", ") : "") : String(p.valor ?? ""));

export default function ParametrosTomaPedido() {
  const [filas, setFilas] = useState([]);
  const [editado, setEditado] = useState({});      // clave → texto digitado
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setFilas(await listarParametros("TOMAPEDIDO")); setEditado({}); }
    catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (p) => {
    const txt = editado[p.clave];
    const valor = p.tipo === "lista"
      ? txt.split(",").map(t => t.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
      : Number(String(txt).replace(",", "."));
    setGuardando(p.clave);
    try { await guardarParametro("TOMAPEDIDO", p.clave, valor); aviso(`✓ «${p.etiqueta}» guardado`); await cargar(); }
    catch (e) { aviso("⚠ " + e.message); }
    finally { setGuardando(null); }
  };

  const campo = { height: 36, padding: "0 10px", fontSize: 13, border: "1px solid #D4E5DE", borderRadius: 8, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>Parámetros TomaPedido</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>Configuración del Portal de Despachos. Solo el administrador puede modificarla; cada cambio queda auditado.</div>
        </div>
        <button onClick={cargar} disabled={cargando} style={{ height: 36, padding: "0 14px", fontSize: 12.5, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer" }}>↻ Actualizar</button>
      </div>
      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "#C0392B" }}>⚠ {error}{/does not exist|no existe|parametros/i.test(error) ? " — ¿Ya se ejecutó el SQL 024 en Supabase?" : ""}</div>}
      <div style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden" }}>
        {cargando && <div style={{ padding: 18, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
        {!cargando && filas.map(p => {
          const valorTxt = editado[p.clave] ?? aTexto(p);
          const cambio = editado[p.clave] !== undefined && editado[p.clave] !== aTexto(p);
          return (
            <div key={p.clave} style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.4fr) minmax(180px, 1fr) auto", gap: 14, alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #F0F5F3" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1a2e27" }}>{p.etiqueta}</div>
                <div style={{ fontSize: 11.5, color: "#6B8F80", lineHeight: 1.45 }}>{p.descripcion}</div>
                <div style={{ fontSize: 10.5, color: "#9CB8AE", marginTop: 2 }}>
                  {p.tipo === "numero" && p.minimo != null ? `Rango permitido: ${p.minimo} a ${p.maximo} ${p.unidad || ""} · ` : ""}{p.updated_at ? `Modificado ${fechaHoraBogota(p.updated_at)}` : "Valor inicial"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input value={valorTxt} onChange={e => setEditado(x => ({ ...x, [p.clave]: e.target.value }))}
                  inputMode={p.tipo === "numero" ? "decimal" : "text"} placeholder={p.tipo === "lista" ? "zip, jpg, png" : ""}
                  style={{ ...campo, ...(cambio ? { borderColor: "#F59E0B", background: "#FFFBEB" } : {}) }} />
                {p.unidad && <span style={{ fontSize: 12, color: "#6B8F80", whiteSpace: "nowrap" }}>{p.unidad}</span>}
              </div>
              <button onClick={() => guardar(p)} disabled={!cambio || guardando === p.clave}
                style={{ height: 36, padding: "0 16px", fontSize: 12.5, fontWeight: 600, border: "none", borderRadius: 8, background: cambio ? "#0F6E56" : "#E2EDE9", color: cambio ? "#fff" : "#9CB8AE", cursor: cambio ? "pointer" : "default" }}>
                {guardando === p.clave ? "Guardando…" : "Guardar"}
              </button>
            </div>);
        })}
      </div>
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13 }}>{toast}</div>}
    </div>
  );
}
