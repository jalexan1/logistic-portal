import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  guardarInventario,
  obtenerHistorialInventario,
  eliminarInventario,
  actualizarInventario,
} from "../services/storageService";

// ── Helpers ──
const pad = n => String(n).padStart(2, "0");
const generateFecha = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; };
const generateHora  = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const PASILLOS = [
  { value: "IL", label: "IL — I Izquierdo", desc: "I Izquierdo" },
  { value: "IR", label: "IR — I Derecho",   desc: "I Derecho"   },
  { value: "JR", label: "JR — J Derecho",   desc: "J Derecho"   },
  { value: "JL", label: "JL — J Izquierdo", desc: "J Izquierdo" },
];
const TOTAL_CEDI = 600;

const EMPTY_FORM = () => ({
  fecha: generateFecha(), hora: generateHora(),
  pasillo: "", posOcupadas: "", posVacias: "",
  usuario: "", observaciones: "",
});

const getEstado   = (pct) => {
  if (pct >= 90) return { label: "CRÍTICO", color: "#C0392B", bg: "#FFF0EE", dot: "#C0392B" };
  if (pct >= 85) return { label: "ALERTA",  color: "#D97706", bg: "#FFFBEB", dot: "#D97706" };
  if (pct >= 60) return { label: "BIEN",    color: "#0F6E56", bg: "#E1F5EE", dot: "#22C55E" };
  return               { label: "BAJO",     color: "#3B82F6", bg: "#EFF6FF", dot: "#3B82F6" };
};
const getBarColor = (pct) => pct >= 90 ? "#C0392B" : pct >= 85 ? "#F59E0B" : pct >= 60 ? "#22C55E" : "#3B82F6";

function calcResumen(historial) {
  const latest = {};
  historial.forEach(r => { if (!latest[r.pasillo]) latest[r.pasillo] = r; });
  const ocupadas = Object.values(latest).reduce((s, r) => s + (parseInt(r.posOcupadas) || 0), 0);
  const pct      = TOTAL_CEDI > 0 ? Math.round((ocupadas / TOTAL_CEDI) * 10000) / 100 : 0;
  return { ocupadas, pct, latest };
}

// ── Botón de sección colapsable ──────────────────────────────────────────
function SectionHeader({ icon, title, count, open, onToggle, rightSlot }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: open ? "1px solid #E2EDE9" : "none", cursor: "pointer", userSelect: "none" }}
      onClick={onToggle}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2e27" }}>{title}</span>
        {count != null && count > 0 && (
          <span style={{ fontSize: 11, color: "#0F6E56", background: "#E1F5EE", padding: "1px 7px", borderRadius: 10, fontWeight: 600 }}>{count}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {rightSlot}
        <span style={{ fontSize: 11, color: "#9CB8AE", background: "#F2F8F5", padding: "3px 10px", borderRadius: 7, border: "1px solid #E2EDE9", fontWeight: 500 }}>
          {open ? "▲ Ocultar" : "▼ Mostrar"}
        </span>
      </div>
    </div>
  );
}

// ── Tarjeta KPI por pasillo (−30% tamaño) ────────────────────────────────
function PasilloKPICard({ pasillo, registro }) {
  const ocu      = parseInt(registro?.posOcupadas) || 0;
  const vac      = parseInt(registro?.posVacias)   || 0;
  const total    = ocu + vac;
  const pct      = total > 0 ? Math.round((ocu / total) * 100) : 0;
  const pctCedi  = Math.round((ocu / TOTAL_CEDI) * 1000) / 10;
  const estado   = getEstado(pct);
  const barColor = getBarColor(pct);
  const p        = PASILLOS.find(p => p.value === pasillo);

  if (!registro) return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2EDE9", padding: "12px 14px", flex: "1 1 140px", minWidth: 130, opacity: 0.5 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#9CB8AE" }}>{pasillo}</div>
      <div style={{ fontSize: 10, color: "#9CB8AE", marginBottom: 8 }}>{p?.desc}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#C5DDD4" }}>—</div>
      <div style={{ fontSize: 10, color: "#9CB8AE" }}>sin datos</div>
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: `1.5px solid ${estado.dot === "#22C55E" ? "#C5DDD4" : estado.dot + "44"}`, padding: "12px 14px", flex: "1 1 140px", minWidth: 130 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: estado.dot, display: "inline-block" }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: "#1a2e27" }}>{pasillo}</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, color: estado.color, background: estado.bg, padding: "1px 6px", borderRadius: 5 }}>✓ {estado.label}</span>
      </div>
      <div style={{ fontSize: 10, color: "#6B8F80", marginBottom: 8 }}>{p?.desc}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: estado.dot === "#22C55E" ? "#0F6E56" : estado.color, lineHeight: 1, marginBottom: 2 }}>{ocu}</div>
      <div style={{ fontSize: 9, color: "#9CB8AE", marginBottom: 6 }}>pos. ocupadas · {pctCedi}% del CEDI</div>
      <div style={{ height: 5, background: "#E2EDE9", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.5s ease" }} />
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #F0F7F4", paddingTop: 8, marginBottom: 6 }}>
        {[
          { val: ocu,  label: "OCUP.", color: "#3B82F6" },
          { val: total > 0 ? pct + "%" : "—", label: "%", color: "#0F6E56" },
          { val: vac,  label: "VAC.",  color: "#6B8F80" },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 8, color: "#9CB8AE", fontWeight: 600, letterSpacing: "0.05em" }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#9CB8AE", textAlign: "center", borderTop: "1px solid #F0F7F4", paddingTop: 6 }}>
        📅 {registro.fecha} · {registro.hora}
        {registro.usuario && <> · 👤 {registro.usuario}</>}
      </div>
    </div>
  );
}

// ── Tabla consolidada ────────────────────────────────────────────────────
function TablaConsolidada({ historial, onEliminar, onEditar, isMobile }) {
  if (historial.length === 0) return (
    <div style={{ textAlign: "center", padding: "36px 0" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
      <div style={{ fontSize: 14, color: "#6B8F80", fontWeight: 500 }}>Sin registros aún</div>
      <div style={{ fontSize: 12, color: "#9CB8AE", marginTop: 4 }}>Los registros guardados aparecerán aquí</div>
    </div>
  );

  // ── Vista móvil: cards apiladas ──
  if (isMobile) return (
    <div>
      {historial.map((r, idx) => {
        const ocu    = parseInt(r.posOcupadas) || 0;
        const vac    = parseInt(r.posVacias)   || 0;
        const total  = ocu + vac;
        const pct    = total > 0 ? Math.round((ocu / total) * 100) : 0;
        const estado = getEstado(pct);
        const p      = PASILLOS.find(p => p.value === r.pasillo);
        return (
          <div key={idx} style={{ border: "1px solid #E2EDE9", borderRadius: 10, padding: "12px 14px", marginBottom: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#1a2e27" }}>{r.pasillo}</span>
                <span style={{ fontSize: 11, color: "#6B8F80", marginLeft: 6 }}>{p?.desc}</span>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: estado.color, background: estado.bg, padding: "2px 7px", borderRadius: 5 }}>● {estado.label}</span>
            </div>
            <div style={{ fontSize: 11, color: "#9CB8AE", marginBottom: 6 }}>📅 {r.fecha} · {r.hora}{r.usuario ? ` · 👤 ${r.usuario}` : ""}</div>
            <div style={{ display: "flex", gap: 14, fontSize: 12, marginBottom: 6 }}>
              <span><strong style={{ color: "#3B82F6" }}>{ocu}</strong> ocupadas</span>
              <span><strong style={{ color: "#6B8F80" }}>{vac}</strong> vacías</span>
              <span><strong style={{ color: estado.color }}>{pct}%</strong></span>
            </div>
            <div style={{ height: 5, background: "#E2EDE9", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: getBarColor(pct), borderRadius: 2 }} />
            </div>
            {r.observaciones && <div style={{ fontSize: 11, color: "#9CB8AE", fontStyle: "italic", marginBottom: 8 }}>"{r.observaciones}"</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onEditar(r, idx)} style={{ flex: 1, height: 32, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✎ Editar</button>
              <button onClick={() => onEliminar(idx)} style={{ flex: 1, height: 32, border: "1px solid #F5C6C0", borderRadius: 7, background: "#FFF5F5", color: "#C0392B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>× Eliminar</button>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Vista desktop: tabla ──
  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #E2EDE9" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820, fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#1a2e27" }}>
            {["#","FECHA","HORA","PASILLO","DESCRIPCIÓN","OCUPADAS","VACÍAS","% OCUP.","VISUAL","ESTADO","USUARIO","OBSERVACIONES",""].map((h, i) => (
              <th key={i} style={{ padding: "9px 10px", fontSize: 9, color: "#9CB8AE", fontWeight: 700, letterSpacing: "0.07em", textAlign: i >= 5 && i <= 8 ? "center" : "left", whiteSpace: "nowrap", borderBottom: "2px solid #0F6E56" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {historial.map((r, idx) => {
            const ocu    = parseInt(r.posOcupadas) || 0;
            const vac    = parseInt(r.posVacias)   || 0;
            const total  = ocu + vac;
            const pct    = total > 0 ? Math.round((ocu / total) * 100) : 0;
            const estado = getEstado(pct);
            const p      = PASILLOS.find(p => p.value === r.pasillo);
            const even   = idx % 2 === 0;
            return (
              <tr key={idx} style={{ background: even ? "#fff" : "#FAFCFB", borderBottom: "1px solid #F0F7F4", transition: "background 0.12s" }}
                onMouseEnter={e => e.currentTarget.style.background = "#F2F8F5"}
                onMouseLeave={e => e.currentTarget.style.background = even ? "#fff" : "#FAFCFB"}
              >
                <td style={{ padding: "8px 10px", color: "#9CB8AE", fontSize: 10 }}>{idx + 1}</td>
                <td style={{ padding: "8px 10px", fontWeight: 600, color: "#1a2e27", whiteSpace: "nowrap" }}>{r.fecha}</td>
                <td style={{ padding: "8px 10px", color: "#6B8F80", whiteSpace: "nowrap" }}>{r.hora}</td>
                <td style={{ padding: "8px 10px", fontWeight: 800, fontSize: 13, color: "#1a2e27" }}>{r.pasillo}</td>
                <td style={{ padding: "8px 10px", color: "#6B8F80", whiteSpace: "nowrap" }}>{p?.desc || "—"}</td>
                <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: "#3B82F6" }}>{ocu}</td>
                <td style={{ padding: "8px 10px", textAlign: "center", color: "#6B8F80", fontWeight: 600 }}>{vac}</td>
                <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: estado.color }}>{pct}%</td>
                <td style={{ padding: "8px 16px 8px 10px", minWidth: 100 }}>
                  <div style={{ height: 5, background: "#E2EDE9", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: getBarColor(pct), borderRadius: 2 }} />
                  </div>
                </td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: estado.color, background: estado.bg, padding: "2px 7px", borderRadius: 5 }}>● {estado.label}</span>
                </td>
                <td style={{ padding: "8px 10px", color: "#6B8F80", fontWeight: 500, whiteSpace: "nowrap" }}>{r.usuario || "—"}</td>
                <td style={{ padding: "8px 10px", color: "#9CB8AE", fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.observaciones || "—"}</td>
                <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    <button onClick={() => onEditar(r, idx)} title="Editar"
                      style={{ width: 26, height: 26, border: "1px solid #D4E5DE", borderRadius: 5, background: "#fff", color: "#6B8F80", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#E1F5EE"; e.currentTarget.style.color = "#0F6E56"; e.currentTarget.style.borderColor = "#0F6E56"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#6B8F80"; e.currentTarget.style.borderColor = "#D4E5DE"; }}
                    >✎</button>
                    <button onClick={() => onEliminar(idx)} title="Eliminar"
                      style={{ width: 26, height: 26, border: "1px solid #F5C6C0", borderRadius: 5, background: "#fff", color: "#C0392B", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#FFF0EE"; e.currentTarget.style.borderColor = "#C0392B"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#F5C6C0"; }}
                    >×</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── COMPONENTE PRINCIPAL ──
// ══════════════════════════════════════════════════════
export default function InventarioPasillos({ isMobile }) {
  const [form, setForm]                   = useState(EMPTY_FORM());
  const [errors, setErrors]               = useState({});
  const [historial, setHistorial]         = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [toast, setToast]                 = useState({ visible: false, message: "" });
  const [guardando, setGuardando]         = useState(false);
  const [successPop, setSuccessPop]       = useState(false);
  const [lastRegistro, setLastRegistro]   = useState(null);
  const [editIdx, setEditIdx]             = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── Secciones colapsables ──
  const [showTabla, setShowTabla]     = useState(true);
  const [showResumen, setShowResumen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      if (editIdx === null) setForm(p => ({ ...p, hora: generateHora(), fecha: generateFecha() }));
    }, 60000);
    return () => clearInterval(t);
  }, [editIdx]);

  useEffect(() => { cargarHistorial(); }, []);

  const cargarHistorial = async () => {
    setLoadingHistorial(true);
    try { const data = await obtenerHistorialInventario(); setHistorial(data); }
    catch (_) { setHistorial([]); }
    finally { setLoadingHistorial(false); }
  };

  const showToast = (msg) => {
    setToast({ visible: true, message: msg });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3500);
  };

  const updateField = (key, val) => {
    setForm(p => ({ ...p, [key]: val }));
    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
  };

  const validateForm = () => {
    const e = {};
    if (!form.pasillo)                                        e.pasillo     = true;
    if (form.posOcupadas === "" || form.posOcupadas === null) e.posOcupadas = true;
    if (form.posVacias   === "" || form.posVacias   === null) e.posVacias   = true;
    if (parseInt(form.posOcupadas) < 0)                       e.posOcupadas = true;
    if (parseInt(form.posVacias)   < 0)                       e.posVacias   = true;
    if (!form.usuario.trim())                                 e.usuario     = true;
    return e;
  };

  const handleGuardar = async () => {
    const e = validateForm();
    if (Object.keys(e).length > 0) { setErrors(e); showToast("⚠ Completa los campos requeridos"); return; }
    setGuardando(true);
    const datos = {
      fecha: form.fecha, hora: form.hora, pasillo: form.pasillo,
      posOcupadas: parseInt(form.posOcupadas) || 0,
      posVacias:   parseInt(form.posVacias)   || 0,
      usuario:     form.usuario.trim().toUpperCase(),
      observaciones: form.observaciones.trim(),
    };

    if (editIdx !== null) {
      // Actualizar en BD
      const nuevoHistorial = historial.map((r, i) => i === editIdx ? datos : r);
      await actualizarInventario(nuevoHistorial);
      setHistorial(nuevoHistorial);
      setEditIdx(null);
      showToast("✓ Registro actualizado");
    } else {
      const result = await guardarInventario(datos);
      const nuevoHistorial = [datos, ...historial];
      setHistorial(nuevoHistorial);
      setLastRegistro(datos);
      setSuccessPop(true);
      if (!result.ok) showToast("⚠ Guardado localmente (sin conexión a BD)");
    }
    setGuardando(false);
  };

  const handleEditar = (registro, idx) => {
    setForm({
      fecha: registro.fecha, hora: registro.hora, pasillo: registro.pasillo,
      posOcupadas: String(registro.posOcupadas), posVacias: String(registro.posVacias),
      usuario: registro.usuario || "", observaciones: registro.observaciones || "",
    });
    setEditIdx(idx); setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("✎ Editando registro — modifica y presiona Actualizar");
  };

  const handleCancelarEdicion = () => { setForm(EMPTY_FORM()); setEditIdx(null); setErrors({}); };
  const handleEliminar        = (idx) => setConfirmDelete(idx);

  // ── Eliminar: persiste en BD ──
  const confirmarEliminar = async () => {
    const nuevoHistorial = historial.filter((_, i) => i !== confirmDelete);
    setHistorial(nuevoHistorial);         // optimistic UI
    setConfirmDelete(null);
    showToast("🗑 Eliminando registro…");
    const result = await eliminarInventario(nuevoHistorial);
    if (result.ok) {
      showToast("✓ Registro eliminado correctamente");
    } else {
      showToast("⚠ Eliminado en pantalla (sin conexión a BD)");
    }
  };

  const handleNuevoRegistro = () => { setForm(EMPTY_FORM()); setErrors({}); setSuccessPop(false); setEditIdx(null); };

  const exportarExcel = () => {
    if (historial.length === 0) { showToast("⚠ No hay registros para exportar"); return; }
    const wb = XLSX.utils.book_new();
    const headers = ["Fecha","Hora","Pasillo","Descripción","Pos. Ocupadas","Pos. Vacías","Total","% Ocupación","Estado","Usuario","Observaciones"];
    const rows = historial.map(r => {
      const t = (r.posOcupadas||0)+(r.posVacias||0);
      const pct = t > 0 ? Math.round(((r.posOcupadas||0)/t)*100) : 0;
      const p = PASILLOS.find(p => p.value === r.pasillo);
      return [r.fecha, r.hora, r.pasillo, p?.desc||"", r.posOcupadas, r.posVacias, t, `${pct}%`, getEstado(pct).label, r.usuario||"", r.observaciones||""];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{wch:12},{wch:8},{wch:6},{wch:14},{wch:13},{wch:11},{wch:7},{wch:10},{wch:9},{wch:18},{wch:28}];
    XLSX.utils.book_append_sheet(wb, ws, "Inventario Pasillos");
    const d = new Date();
    XLSX.writeFile(wb, `inventario_${pad(d.getDate())}${pad(d.getMonth()+1)}${d.getFullYear()}.xlsx`);
    showToast("✓ Excel exportado");
  };

  // ── Estilos base reutilizables ──
  const inputBase     = { width:"100%", height:40, padding:"0 12px", fontSize:14, border:"1px solid #D4E5DE", borderRadius:9, background:"#fff", color:"#1a2e27", outline:"none", boxSizing:"border-box", WebkitAppearance:"none", transition:"border-color 0.2s, box-shadow 0.2s" };
  const inputError    = { ...inputBase, border:"1px solid #E74C3C", background:"#FFF5F5" };
  const inputReadonly = { ...inputBase, background:"#F2F8F5", color:"#5A7A6E", border:"1px solid #E2EDE9", cursor:"default", fontWeight:500 };
  const lbl           = (key) => ({ fontSize:12, color:errors[key]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 });

  const total    = (parseInt(form.posOcupadas)||0)+(parseInt(form.posVacias)||0);
  const ocupPct  = total > 0 ? Math.round(((parseInt(form.posOcupadas)||0)/total)*100) : null;
  const modoEd   = editIdx !== null;
  const resumen  = calcResumen(historial);
  const estGlobal = getEstado(resumen.pct);

  // ── Grid responsive para formulario ──
  const gridForm1 = isMobile ? "1fr 1fr" : "1fr 1fr 2fr";
  const gridForm2 = isMobile ? "1fr 1fr" : "1fr 1fr 2fr";

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* ══════════════════════════════════════════
          1. FORMULARIO — siempre visible arriba
      ══════════════════════════════════════════ */}
      {modoEd && (
        <div style={{ background:"#FFFBEB", border:"1px solid #F6D860", borderRadius:10, padding:"10px 14px", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <span style={{ fontSize:13, color:"#92600A", fontWeight:600 }}>✎ Modo edición — registro #{editIdx+1}</span>
          <button onClick={handleCancelarEdicion}
            style={{ fontSize:12, color:"#92600A", background:"none", border:"1px solid #F6D860", borderRadius:7, padding:"4px 12px", cursor:"pointer" }}
            onMouseEnter={e=>e.currentTarget.style.background="#FEF3C7"}
            onMouseLeave={e=>e.currentTarget.style.background="none"}
          >Cancelar edición</button>
        </div>
      )}

      <div style={{ background:"#fff", borderRadius:14, border:`1px solid ${modoEd?"#F6D860":"#E2EDE9"}`, padding:isMobile?"14px":"18px 22px", marginBottom:16 }}>
        {/* Header formulario */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em" }}>
            {modoEd ? "✎ Actualizar registro" : "+ Nuevo registro de posiciones"}
          </div>
          {ocupPct !== null && (
            <span style={{ fontSize:13, fontWeight:800, color:ocupPct>=90?"#C0392B":ocupPct>=70?"#D97706":"#0F6E56", background:ocupPct>=90?"#FFF5F5":ocupPct>=70?"#FFFBEB":"#E1F5EE", padding:"2px 10px", borderRadius:20 }}>
              Ocupación: {ocupPct}%
            </span>
          )}
        </div>

        {/* Fila 1: Fecha · Hora · Pasillo */}
        <div style={{ display:"grid", gridTemplateColumns:gridForm1, gap:12, marginBottom:12 }}>
          <div>
            <label style={lbl("fecha")}>Fecha <span style={{ fontSize:10, color:"#9CB8AE" }}>auto</span></label>
            <input type="text" value={form.fecha} readOnly style={inputReadonly} />
          </div>
          <div>
            <label style={lbl("hora")}>Hora <span style={{ fontSize:10, color:"#9CB8AE" }}>auto</span></label>
            <input type="text" value={form.hora} readOnly style={inputReadonly} />
          </div>
          <div style={{ gridColumn: isMobile ? "span 2" : "span 1" }}>
            <label style={lbl("pasillo")}>Pasillo *</label>
            <select value={form.pasillo} onChange={e=>updateField("pasillo",e.target.value)}
              style={{ ...(errors.pasillo?inputError:inputBase), cursor:"pointer", backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' stroke='%236B8F80' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat:"no-repeat", backgroundPosition:"right 12px center", paddingRight:36 }}
              onFocus={e=>{e.target.style.borderColor="#0F6E56";e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)";}}
              onBlur={e=>{e.target.style.borderColor=errors.pasillo?"#E74C3C":"#D4E5DE";e.target.style.boxShadow="none";}}
            >
              <option value="">— Selecciona un pasillo —</option>
              {PASILLOS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {/* Fila 2: Ocupadas · Vacías · Usuario */}
        <div style={{ display:"grid", gridTemplateColumns:gridForm2, gap:12, marginBottom:12 }}>
          <div>
            <label style={lbl("posOcupadas")}>Pos. Ocupadas *</label>
            <input type="number" min="0" value={form.posOcupadas} onChange={e=>updateField("posOcupadas",e.target.value)} placeholder="0"
              style={{ ...(errors.posOcupadas?inputError:inputBase), textAlign:"center" }}
              onFocus={e=>{e.target.style.borderColor="#0F6E56";e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)";}}
              onBlur={e=>{e.target.style.borderColor=errors.posOcupadas?"#E74C3C":"#D4E5DE";e.target.style.boxShadow="none";}}
            />
          </div>
          <div>
            <label style={lbl("posVacias")}>Pos. Vacías *</label>
            <input type="number" min="0" value={form.posVacias} onChange={e=>updateField("posVacias",e.target.value)} placeholder="0"
              style={{ ...(errors.posVacias?inputError:inputBase), textAlign:"center" }}
              onFocus={e=>{e.target.style.borderColor="#0F6E56";e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)";}}
              onBlur={e=>{e.target.style.borderColor=errors.posVacias?"#E74C3C":"#D4E5DE";e.target.style.boxShadow="none";}}
            />
          </div>
          <div style={{ gridColumn: isMobile ? "span 2" : "span 1" }}>
            <label style={lbl("usuario")}>Usuario *</label>
            <input type="text" value={form.usuario} onChange={e=>updateField("usuario",e.target.value.toUpperCase())} placeholder="NOMBRE DEL OPERARIO"
              style={{ ...(errors.usuario?inputError:inputBase), textTransform:"uppercase" }}
              onFocus={e=>{e.target.style.borderColor="#0F6E56";e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)";}}
              onBlur={e=>{e.target.style.borderColor=errors.usuario?"#E74C3C":"#D4E5DE";e.target.style.boxShadow="none";}}
            />
          </div>
        </div>

        {/* Barra ocupación en tiempo real */}
        {total > 0 && (
          <div style={{ background:"#F7FCF9", borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={{ fontSize:12, color:"#6B8F80", fontWeight:500 }}>Total: {total} posiciones</span>
              <span style={{ fontSize:12, fontWeight:700, color:ocupPct>=90?"#C0392B":ocupPct>=70?"#D97706":"#0F6E56" }}>{ocupPct}% ocupado</span>
            </div>
            <div style={{ height:7, background:"#E2EDE9", borderRadius:3, overflow:"hidden" }}>
              <div style={{ width:`${ocupPct}%`, height:"100%", background:getBarColor(ocupPct), borderRadius:3, transition:"width 0.4s ease" }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:5, fontSize:11, color:"#9CB8AE" }}>
              <span>{parseInt(form.posOcupadas)||0} ocupadas</span>
              <span>{parseInt(form.posVacias)||0} vacías</span>
            </div>
          </div>
        )}

        {/* Observaciones */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>
            Observaciones <span style={{ fontSize:10, color:"#9CB8AE" }}>opcional</span>
          </label>
          <textarea value={form.observaciones} onChange={e=>updateField("observaciones",e.target.value)}
            placeholder="Ej: Posiciones 3-7 bloqueadas…" rows={2}
            style={{ ...inputBase, height:"auto", padding:"10px 12px", resize:"vertical", lineHeight:1.5 }}
            onFocus={e=>{e.target.style.borderColor="#0F6E56";e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)";}}
            onBlur={e=>{e.target.style.borderColor="#D4E5DE";e.target.style.boxShadow="none";}}
          />
        </div>

        <button onClick={handleGuardar} disabled={guardando}
          style={{ width:"100%", height:46, borderRadius:10, background:guardando?"#6B8F80":modoEd?"#D97706":"#0F6E56", color:"#fff", border:"none", fontSize:14, fontWeight:700, cursor:guardando?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"background 0.2s" }}
          onMouseEnter={e=>{if(!guardando)e.currentTarget.style.background=modoEd?"#B45309":"#085041";}}
          onMouseLeave={e=>{if(!guardando)e.currentTarget.style.background=modoEd?"#D97706":"#0F6E56";}}
        >
          {guardando ? <><span>⏳</span> Guardando...</>
            : modoEd  ? <><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="white" strokeWidth="1.4" strokeLinejoin="round"/></svg>Actualizar registro</>
            : <><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 10.5V13a.5.5 0 0 1-.5.5H3A.5.5 0 0 1 2.5 13V10.5M8 2v8M5.5 7.5 8 10l2.5-2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Guardar registro</>
          }
        </button>
      </div>

      {/* ══════════════════════════════════════════
          2. TABLA HISTORIAL — colapsable
      ══════════════════════════════════════════ */}
      <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", overflow:"hidden", marginBottom:14 }}>
        <SectionHeader
          icon="📋"
          title="Tabla Consolidada — Historial de Registros"
          count={historial.length}
          open={showTabla}
          onToggle={()=>setShowTabla(v=>!v)}
          rightSlot={
            <div style={{ display:"flex", gap:6 }} onClick={e=>e.stopPropagation()}>
              <button onClick={cargarHistorial}
                style={{ padding:"4px 10px", fontSize:11, border:"1px solid #D4E5DE", borderRadius:6, background:"#fff", color:"#0F6E56", cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background="#F2F8F5"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}
              >↻</button>
              {historial.length > 0 && (
                <button onClick={exportarExcel}
                  style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", fontSize:11, fontWeight:600, border:"none", borderRadius:6, background:"#0F6E56", color:"#fff", cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#085041"}
                  onMouseLeave={e=>e.currentTarget.style.background="#0F6E56"}
                >
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Excel
                </button>
              )}
            </div>
          }
        />
        {showTabla && (
          <div style={{ padding: isMobile ? "12px" : "14px 18px" }}>
            {loadingHistorial
              ? <div style={{ textAlign:"center", padding:"32px 0", color:"#9CB8AE", fontSize:13 }}>Cargando…</div>
              : <TablaConsolidada historial={historial} onEliminar={handleEliminar} onEditar={handleEditar} isMobile={isMobile} />
            }
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          3. RESUMEN KPI — colapsable, −40% tamaño
      ══════════════════════════════════════════ */}
      <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", overflow:"hidden", marginBottom:14 }}>
        <SectionHeader
          icon="📊"
          title={`Resumen de Capacidad Global — ${TOTAL_CEDI} Posiciones CEDI`}
          open={showResumen}
          onToggle={()=>setShowResumen(v=>!v)}
        />
        {showResumen && historial.length === 0 && (
          <div style={{ textAlign:"center", padding:"28px 0", color:"#9CB8AE", fontSize:12 }}>Agrega registros para ver el resumen</div>
        )}
        {showResumen && historial.length > 0 && (
          <div style={{ padding: isMobile ? "12px" : "14px 18px" }}>

            {/* Cards KPI globales — 6 tarjetas compactas (−40%) */}
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(6,1fr)", gap:8, marginBottom:14 }}>
              {[
                { label:"TOTAL CEDI",      val:TOTAL_CEDI,                           sub:`Actualizado ${generateFecha()}`,  color:"#1a2e27", barPct:100,                                   barColor:"#3B82F6" },
                { label:"OCUPADAS",        val:resumen.ocupadas,                     sub:"Pasillos I+J · WMS",              color:"#0F6E56", barPct:(resumen.ocupadas/TOTAL_CEDI)*100,       barColor:"#22C55E" },
                { label:"DISPONIBLES",     val:TOTAL_CEDI-resumen.ocupadas,          sub:"Capacidad libre",                 color:"#6B8F80", barPct:((TOTAL_CEDI-resumen.ocupadas)/TOTAL_CEDI)*100, barColor:"#9CB8AE" },
                { label:"OCUPACIÓN UC%",   val:`${resumen.pct}%`,                    sub:"Meta: 60%–85%",                   color:resumen.pct>=85?"#C0392B":"#0F6E56", barPct:resumen.pct, barColor:getBarColor(resumen.pct) },
                { label:"UMBRAL (85%)",    val:Math.round(TOTAL_CEDI*0.85),          sub:"Límite recomendado",              color:"#D97706", barPct:85,                                    barColor:"#F59E0B" },
                { label:"ESTADO KPI",      val:estGlobal.label,                      sub:resumen.pct>=85?"Sobre umbral":"Dentro del rango", color:estGlobal.color, barPct:resumen.pct, barColor:estGlobal.dot, isEstado:true, dot:estGlobal.dot },
              ].map((k,i) => (
                <div key={i} style={{ background:"#FAFCFB", borderRadius:9, border:"1px solid #E2EDE9", padding:"10px 12px" }}>
                  <div style={{ fontSize:8, fontWeight:700, color:"#9CB8AE", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:4 }}>{k.label}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:3 }}>
                    {k.isEstado && <span style={{ width:8, height:8, borderRadius:"50%", background:k.dot, display:"inline-block" }} />}
                    <span style={{ fontSize:k.isEstado?15:20, fontWeight:900, color:k.color, lineHeight:1 }}>{k.val}</span>
                  </div>
                  <div style={{ fontSize:9, color:"#9CB8AE", marginBottom:6, lineHeight:1.3 }}>{k.sub}</div>
                  <div style={{ height:3, background:"#E2EDE9", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.min(k.barPct,100)}%`, height:"100%", background:k.barColor, borderRadius:2 }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Cards por pasillo (−30%) */}
            <div style={{ fontSize:10, fontWeight:700, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>
              Detalle por Pasillo — Posiciones Ocupadas (Fuente: WMS)
            </div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              {PASILLOS.map(p => (
                <PasilloKPICard key={p.value} pasillo={p.value} registro={resumen.latest[p.value]} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign:"center", fontSize:11, color:"#9CB8AE" }}>Logistics and Services · Inventario de Pasillos</div>
      <div style={{ marginTop:4, textAlign:"center", fontSize:11, color:"#0F6E56", fontWeight:600 }}>Made by Logistics and Services © 2026</div>

      {/* Toast */}
      <div style={{ position:"fixed", bottom:20, left:"50%", transform:`translateX(-50%) translateY(${toast.visible?0:10}px)`, zIndex:1000, background:"#1a2e27", color:"#fff", padding:"10px 20px", borderRadius:24, fontSize:13, fontWeight:500, opacity:toast.visible?1:0, transition:"all 0.25s ease", pointerEvents:"none", whiteSpace:"nowrap", boxShadow:"0 4px 20px rgba(0,0,0,0.2)", maxWidth:"90vw", textAlign:"center" }}>
        {toast.message}
      </div>

      {/* Modal confirmar eliminación */}
      {confirmDelete !== null && (
        <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(10,30,24,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", backdropFilter:"blur(3px)" }}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:340, overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.2)", animation:"popIn 0.22s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ padding:"22px 22px 14px", textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>🗑</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#1a2e27", marginBottom:6 }}>¿Eliminar registro #{confirmDelete+1}?</div>
              <div style={{ fontSize:12, color:"#6B8F80", lineHeight:1.5 }}>
                Pasillo <strong>{historial[confirmDelete]?.pasillo}</strong> · {historial[confirmDelete]?.fecha}<br/>Esta acción se guardará en la base de datos.
              </div>
            </div>
            <div style={{ display:"flex", gap:8, padding:"0 22px 22px" }}>
              <button onClick={()=>setConfirmDelete(null)} style={{ flex:1, height:40, borderRadius:9, background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:13, fontWeight:600, cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.background="#E1F5EE"} onMouseLeave={e=>e.currentTarget.style.background="#F2F8F5"}>Cancelar</button>
              <button onClick={confirmarEliminar} style={{ flex:1, height:40, borderRadius:9, background:"#C0392B", color:"#fff", border:"none", fontSize:13, fontWeight:600, cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.background="#922B21"} onMouseLeave={e=>e.currentTarget.style.background="#C0392B"}>Eliminar</button>
            </div>
          </div>
          <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}

      {/* Popup éxito */}
      {successPop && lastRegistro && (
        <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(10,30,24,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", backdropFilter:"blur(3px)" }}>
          <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:380, overflow:"hidden", boxShadow:"0 28px 70px rgba(0,0,0,0.22)", animation:"popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ background:"#0F6E56", padding:"20px 24px 18px", textAlign:"center" }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8, textAlign:"right" }}>Logistics and Services</div>
              <div style={{ fontSize:28, marginBottom:4 }}>✓</div>
              <div style={{ fontSize:14, color:"#fff", fontWeight:700 }}>Registro guardado</div>
            </div>
            <div style={{ padding:"16px 24px 4px" }}>
              {[
                { label:"Fecha / Hora",     value:`${lastRegistro.fecha} · ${lastRegistro.hora}` },
                { label:"Pasillo",          value:PASILLOS.find(p=>p.value===lastRegistro.pasillo)?.label||lastRegistro.pasillo },
                { label:"Ocupadas / Vacías",value:`${lastRegistro.posOcupadas} / ${lastRegistro.posVacias}` },
                { label:"Usuario",          value:lastRegistro.usuario||"—" },
              ].map(({label,value})=>(
                <div key={label} style={{ textAlign:"center", padding:"8px 0", borderBottom:"1px solid #F0F7F4" }}>
                  <div style={{ fontSize:9, color:"#9CB8AE", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:13, color:"#1a2e27", fontWeight:600 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:"14px 24px 20px", display:"flex", gap:8 }}>
              <button onClick={handleNuevoRegistro} style={{ flex:1, height:42, borderRadius:10, background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:13, fontWeight:600, cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.background="#E1F5EE"} onMouseLeave={e=>e.currentTarget.style.background="#F2F8F5"}>Nuevo</button>
              <button onClick={()=>setSuccessPop(false)} style={{ flex:1, height:42, borderRadius:10, background:"#0F6E56", color:"#fff", border:"none", fontSize:13, fontWeight:600, cursor:"pointer" }} onMouseEnter={e=>e.currentTarget.style.background="#085041"} onMouseLeave={e=>e.currentTarget.style.background="#0F6E56"}>Cerrar</button>
            </div>
          </div>
          <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}
    </div>
  );
}
