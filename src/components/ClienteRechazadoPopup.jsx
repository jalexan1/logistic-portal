// ── ClienteRechazadoPopup.jsx ────────────────────────────────────────────
// 06-nov (req. 3 y 4): el supervisor RECHAZÓ el cliente (sigue activo) y
// marcó qué datos están mal. Cuando alguien radica con ese NIT (manual,
// plantilla Excel o PDF, o lo elige con la lupa) se le muestra:
//   · la nota de la revisión (quién y cuándo),
//   · los campos que debe corregir, en amarillo.
// Al guardar, el cliente vuelve a PENDIENTE de revisión y se puede radicar
// de inmediato (despachos.fn_corregir_cliente_rechazado, SQL 034).
// Sin corregir no se puede radicar (la base también lo bloquea).
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { BD_CLIENTES } from "../services/clientesService";
import { corregirClienteRechazado } from "../services/clientesMaestroService";
import { cargarCiudades, departamentoDeCiudad } from "../services/maestrosService";
import { fechaHoraBogota } from "../utils/fechas";
import { CAMPOS_CLIENTE_REVISION as CAMPOS, nombreCampos } from "../utils/tablaLineas";


const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const tel = (v) => String(v ?? "").replace(/[^0-9+]/g, "");

export default function ClienteRechazadoPopup({ nit, onCorregido, onCerrar }) {
  const c = BD_CLIENTES[String(nit).trim()] || {};
  const marcados = useMemo(() => {
    const m = new Set(c.campos_corregir || []);
    if (m.has("CIUDAD") || m.has("DEPARTAMENTO")) { m.add("CIUDAD"); m.add("DEPARTAMENTO"); }
    return m;
  }, [c.campos_corregir]);
  const todos = marcados.size === 0;          // rechazado sin campos marcados (flujo anterior): revisar todo
  const editable = (k) => { const x = CAMPOS.find(y => y.k === k); return Boolean(x) && (todos || marcados.has(x.codigo)); };

  const [d, setD] = useState({ nombre: c.nombre || "", direccion: c.direccion || "", telefono: c.telefono || "", ciudad: c.ciudad || "", departamento: c.departamento || "" });
  const [error, setError] = useState("");
  const [faltan, setFaltan] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { cargarCiudades().catch(() => {}); }, []);

  const cambiar = (k, v) => {
    setD(prev => {
      const n = { ...prev, [k]: v };
      if (k === "ciudad") { const dep = departamentoDeCiudad(v); if (dep) n.departamento = dep; }
      return n;
    });
    setFaltan(f => ({ ...f, [k]: false })); setError("");
  };

  const guardar = async (e) => {
    e.preventDefault();
    const vacios = Object.fromEntries(CAMPOS.map(x => [x.k, !String(d[x.k] || "").trim()]));
    if (Object.values(vacios).some(Boolean)) { setFaltan(vacios); setError("Complete los campos marcados."); return; }
    const igual = (k) => k === "telefono" ? tel(d[k]) === tel(c[k]) : norm(d[k]) === norm(c[k]);
    if (!todos) {
      const sinCambio = CAMPOS.filter(x => marcados.has(x.codigo) && x.k !== "departamento" && igual(x.k)
        && !(x.k === "ciudad" && !igual("departamento")));
      if (sinCambio.length) {
        setFaltan(Object.fromEntries(sinCambio.map(x => [x.k, true])));
        setError(`Debe corregir: ${sinCambio.map(x => x.titulo).join(", ")} (sigue igual al dato rechazado).`);
        return;
      }
    } else if (CAMPOS.every(x => igual(x.k))) {
      setError("No cambió ningún dato. Corrija lo que indica la nota de la revisión."); return;
    }
    setGuardando(true); setError("");
    try { onCorregido(await corregirClienteRechazado({ nit, ...d })); }
    catch (err) { setError(err.message); }
    finally { setGuardando(false); }
  };

  const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6B8F80", fontWeight: 500 };
  const input = (k) => {
    const marcado = editable(k) && !todos;
    return {
      height: 38, padding: "0 10px", fontSize: 13, borderRadius: 8, outline: "none", boxSizing: "border-box", width: "100%", textTransform: "uppercase",
      border: `1px solid ${faltan[k] || marcado ? "#E5B935" : "#D4E5DE"}`,
      background: !editable(k) ? "#F2F8F5" : faltan[k] || marcado ? "#FFF3BF" : "#fff",
      color: editable(k) ? "#1a2e27" : "#6B8F80",
    };
  };
  const etiqueta = (k, titulo) => <>{titulo} *{editable(k) && !todos && <b style={{ color: "#B45309" }}> · corregir</b>}</>;

  return (
    <div onClick={() => !guardando && onCerrar()} style={{ position: "fixed", inset: 0, zIndex: 3100, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form role="dialog" aria-modal="true" onSubmit={guardar} onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, maxHeight: "90vh", overflow: "auto", boxShadow: "0 28px 70px rgba(0,0,0,0.25)" }}>
        <div style={{ background: "#FFF0EE", borderBottom: "1px solid #F5C6C0", padding: "16px 22px", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "#C0392B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0 }}>!</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#9B1C1C" }}>Actualice los datos del cliente antes de radicar</div>
            <div style={{ fontSize: 12, color: "#9B4545" }}>{c.nombre || "Cliente"} · NIT {nit} fue <b>rechazado</b> por el supervisor.</div>
          </div>
        </div>

        <div style={{ padding: "14px 22px 4px" }}>
          <div style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>Nota de la revisión</div>
            <div style={{ fontSize: 13.5, color: "#1a2e27", fontWeight: 600 }}>{c.nota_revision || "Sin nota"}</div>
            <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>
              {[c.revisado_por_nombre && `Revisó: ${c.revisado_por_nombre}`, c.revisado_at && fechaHoraBogota(c.revisado_at)].filter(Boolean).join(" · ")}
              {!todos && <> · Debe corregir: <b>{nombreCampos([...marcados])}</b></>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
            <label style={lbl}>NIT<input value={nit} readOnly style={{ ...input("x"), background: "#F2F8F5", color: "#6B8F80", border: "1px solid #D4E5DE" }} /></label>
            <label style={lbl}>{etiqueta("nombre", "Nombre")}<input value={d.nombre} readOnly={!editable("nombre")} onChange={e => cambiar("nombre", e.target.value)} style={input("nombre")} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
            <label style={lbl}>{etiqueta("direccion", "Dirección")}<input value={d.direccion} readOnly={!editable("direccion")} onChange={e => cambiar("direccion", e.target.value)} placeholder="CRA 45 # 35 27" style={input("direccion")} /></label>
            <label style={lbl}>{etiqueta("telefono", "Teléfono")}<input value={d.telefono} inputMode="tel" readOnly={!editable("telefono")} onChange={e => cambiar("telefono", e.target.value)} placeholder="3001234567" style={input("telefono")} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={lbl}>{etiqueta("ciudad", "Ciudad")}<input value={d.ciudad} readOnly={!editable("ciudad")} onChange={e => cambiar("ciudad", e.target.value)} style={input("ciudad")} /></label>
            <label style={lbl}>{etiqueta("departamento", "Departamento")}<input value={d.departamento} readOnly={!editable("departamento")} onChange={e => cambiar("departamento", e.target.value)} style={input("departamento")} /></label>
          </div>
          <div style={{ fontSize: 11.5, color: "#6B8F80", marginTop: 10, lineHeight: 1.5 }}>
            Al guardar, el cliente queda <b>pendiente de revisión</b> del supervisor y puede radicar con él de inmediato. Los datos corregidos se aplican a todas las líneas con este NIT.
          </div>
          {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#C0392B", background: "#FFF5F5", border: "1px solid #F5C6C0", borderRadius: 8, padding: "8px 12px" }}>⚠ {error}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px 18px" }}>
          <button type="button" onClick={onCerrar} disabled={guardando} style={{ height: 40, padding: "0 16px", borderRadius: 10, background: "#fff", color: "#6B8F80", border: "1px solid #E2EDE9", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Ahora no</button>
          <button type="submit" disabled={guardando} style={{ height: 40, padding: "0 18px", borderRadius: 10, background: "#0F6E56", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: guardando ? "wait" : "pointer" }}>{guardando ? "Guardando…" : "Actualizar cliente y continuar"}</button>
        </div>
      </form>
    </div>
  );
}
