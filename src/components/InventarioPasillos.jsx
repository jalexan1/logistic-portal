import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { guardarInventario, obtenerHistorialInventario } from "../services/storageService";

// ── Helpers ──
const pad = n => String(n).padStart(2, "0");
const generateFecha = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
};
const generateHora = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ── Pasillos del WMS ──
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

// ── Helpers de estado KPI ──
const getEstado = (pct) => {
  if (pct >= 90) return { label: "CRÍTICO", color: "#C0392B", bg: "#FFF0EE", dot: "#C0392B" };
  if (pct >= 85) return { label: "ALERTA",  color: "#D97706", bg: "#FFFBEB", dot: "#D97706" };
  if (pct >= 60) return { label: "BIEN",    color: "#0F6E56", bg: "#E1F5EE", dot: "#22C55E" };
  return               { label: "BAJO",     color: "#3B82F6", bg: "#EFF6FF", dot: "#3B82F6" };
};
const getBarColor = (pct) => pct >= 90 ? "#C0392B" : pct >= 85 ? "#F59E0B" : pct >= 60 ? "#22C55E" : "#3B82F6";

// ── Resumen global de los últimos registros por pasillo ──
function calcResumen(historial) {
  // Toma el registro más reciente de cada pasillo
  const latest = {};
  historial.forEach(r => {
    if (!latest[r.pasillo]) latest[r.pasillo] = r;
  });
  const ocupadas = Object.values(latest).reduce((s, r) => s + (parseInt(r.posOcupadas) || 0), 0);
  const vacías   = Object.values(latest).reduce((s, r) => s + (parseInt(r.posVacias)   || 0), 0);
  const pct      = TOTAL_CEDI > 0 ? Math.round((ocupadas / TOTAL_CEDI) * 100 * 100) / 100 : 0;
  return { ocupadas, vacías, pct, latest };
}

// ── Tarjeta de KPI por pasillo (imagen 1) ──
function PasilloKPICard({ pasillo, registro }) {
  const ocu   = parseInt(registro?.posOcupadas) || 0;
  const vac   = parseInt(registro?.posVacias)   || 0;
  const total = ocu + vac;
  const pct   = total > 0 ? Math.round((ocu / total) * 100) : 0;
  const pctCedi = Math.round((ocu / TOTAL_CEDI) * 100 * 10) / 10;
  const estado  = getEstado(pct);
  const barColor = getBarColor(pct);
  const p = PASILLOS.find(p => p.value === pasillo);

  if (!registro) {
    return (
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2EDE9", padding: "18px 20px", flex: "1 1 200px", minWidth: 180, opacity: 0.5 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#9CB8AE" }}>{pasillo}</div>
        <div style={{ fontSize: 11, color: "#9CB8AE", marginBottom: 12 }}>{p?.desc}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#C5DDD4" }}>—</div>
        <div style={{ fontSize: 11, color: "#9CB8AE" }}>sin datos</div>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: `1.5px solid ${estado.dot === "#22C55E" ? "#C5DDD4" : estado.dot + "44"}`, padding: "18px 20px", flex: "1 1 200px", minWidth: 180 }}>
      {/* Header pasillo + estado */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: estado.dot, display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: "#1a2e27" }}>{pasillo}</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: estado.color, background: estado.bg, padding: "2px 8px", borderRadius: 6, letterSpacing: "0.04em" }}>
          ✓ {estado.label}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#6B8F80", marginBottom: 14 }}>{p?.desc}</div>

      {/* Número principal */}
      <div style={{ fontSize: 36, fontWeight: 900, color: estado.dot === "#22C55E" ? "#0F6E56" : estado.color, lineHeight: 1, marginBottom: 4 }}>{ocu}</div>
      <div style={{ fontSize: 11, color: "#9CB8AE", marginBottom: 10 }}>posiciones ocupadas · {pctCedi}% del CEDI</div>

      {/* Barra */}
      <div style={{ height: 6, background: "#E2EDE9", borderRadius: 3, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>

      {/* Stats footer */}
      <div style={{ display: "flex", gap: 0, borderTop: "1px solid #F0F7F4", paddingTop: 12 }}>
        {[
          { val: ocu,  label: "OCUPADAS", color: "#3B82F6" },
          { val: total > 0 ? Math.round(ocu / total * 100) + "%" : "—", label: "OCUP%", color: "#0F6E56" },
          { val: vac,  label: "VACÍAS",   color: "#6B8F80" },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 9, color: "#9CB8AE", fontWeight: 600, letterSpacing: "0.06em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Fecha del registro */}
      <div style={{ marginTop: 10, fontSize: 10, color: "#9CB8AE", textAlign: "center", borderTop: "1px solid #F0F7F4", paddingTop: 8 }}>
        📅 {registro.fecha} · {registro.hora} · <span style={{ color: "#6B8F80" }}>👤 {registro.usuario || "—"}</span>
      </div>
    </div>
  );
}

// ── Tabla consolidada (imagen 2) ──
function TablaConsolidada({ historial, onEliminar, onEditar }) {
  if (historial.length === 0) return null;

  // Agrupar por pasillo — mostrar todos los registros
  return (
    <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid #E2EDE9" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780, fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#1a2e27" }}>
            {["#", "FECHA", "HORA", "PASILLO", "DESCRIPCIÓN", "POS. OCUPADAS", "POS. VACÍAS", "% OCUP.", "OCUPACIÓN VISUAL", "ESTADO", "USUARIO", "OBSERVACIONES", ""].map((h, i) => (
              <th key={i} style={{ padding: "10px 12px", fontSize: 10, color: "#9CB8AE", fontWeight: 700, letterSpacing: "0.07em", textAlign: i >= 5 && i <= 8 ? "center" : "left", whiteSpace: "nowrap", borderBottom: "2px solid #0F6E56" }}>
                {h}
              </th>
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
            const barCol = getBarColor(pct);
            const p      = PASILLOS.find(p => p.value === r.pasillo);
            const isEven = idx % 2 === 0;

            return (
              <tr key={idx}
                style={{ background: isEven ? "#fff" : "#FAFCFB", borderBottom: "1px solid #F0F7F4", transition: "background 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.background = "#F2F8F5"}
                onMouseLeave={e => e.currentTarget.style.background = isEven ? "#fff" : "#FAFCFB"}
              >
                <td style={{ padding: "10px 12px", color: "#9CB8AE", fontSize: 11 }}>{idx + 1}</td>
                <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1a2e27", whiteSpace: "nowrap" }}>{r.fecha}</td>
                <td style={{ padding: "10px 12px", color: "#6B8F80", whiteSpace: "nowrap" }}>{r.hora}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: "#1a2e27" }}>{r.pasillo}</span>
                </td>
                <td style={{ padding: "10px 12px", color: "#6B8F80", whiteSpace: "nowrap" }}>{p?.desc || "—"}</td>
                <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, fontSize: 14, color: "#3B82F6" }}>{ocu}</td>
                <td style={{ padding: "10px 12px", textAlign: "center", color: "#6B8F80", fontWeight: 600 }}>{vac}</td>
                <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700, color: estado.color }}>{pct}%</td>
                <td style={{ padding: "10px 20px 10px 12px", minWidth: 120 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 6, background: "#E2EDE9", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: barCol, borderRadius: 3 }} />
                    </div>
                  </div>
                </td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: estado.color, background: estado.bg, padding: "3px 8px", borderRadius: 6 }}>
                    ● {estado.label}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "#6B8F80", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {r.usuario || "—"}
                </td>
                <td style={{ padding: "10px 12px", color: "#9CB8AE", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.observaciones || "—"}
                </td>
                <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => onEditar(r, idx)} title="Editar"
                      style={{ width: 28, height: 28, border: "1px solid #D4E5DE", borderRadius: 6, background: "#fff", color: "#6B8F80", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#E1F5EE"; e.currentTarget.style.color = "#0F6E56"; e.currentTarget.style.borderColor = "#0F6E56"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#6B8F80"; e.currentTarget.style.borderColor = "#D4E5DE"; }}
                    >✎</button>
                    <button onClick={() => onEliminar(idx)} title="Eliminar"
                      style={{ width: 28, height: 28, border: "1px solid #F5C6C0", borderRadius: 6, background: "#fff", color: "#C0392B", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}
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

// ══════════════════════════════════════════
// ── COMPONENTE PRINCIPAL ──
// ══════════════════════════════════════════
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
      setHistorial(prev => prev.map((r, i) => i === editIdx ? datos : r));
      setEditIdx(null); showToast("✓ Registro actualizado");
    } else {
      const result = await guardarInventario(datos);
      setHistorial(prev => [datos, ...prev]);
      setLastRegistro(datos); setSuccessPop(true);
      if (!result.ok) showToast("⚠ Guardado localmente (sin conexión a BD)");
    }
    setGuardando(false);
  };

  const handleEditar = (registro, idx) => {
    setForm({ fecha: registro.fecha, hora: registro.hora, pasillo: registro.pasillo, posOcupadas: String(registro.posOcupadas), posVacias: String(registro.posVacias), usuario: registro.usuario || "", observaciones: registro.observaciones || "" });
    setEditIdx(idx); setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("✎ Editando registro — modifica y presiona Actualizar");
  };

  const handleCancelarEdicion = () => { setForm(EMPTY_FORM()); setEditIdx(null); setErrors({}); };
  const handleEliminar        = (idx) => setConfirmDelete(idx);
  const confirmarEliminar     = () => { setHistorial(prev => prev.filter((_, i) => i !== confirmDelete)); setConfirmDelete(null); showToast("🗑 Registro eliminado"); };
  const handleNuevoRegistro   = () => { setForm(EMPTY_FORM()); setErrors({}); setSuccessPop(false); setEditIdx(null); };

  const exportarExcel = () => {
    if (historial.length === 0) { showToast("⚠ No hay registros para exportar"); return; }
    const wb = XLSX.utils.book_new();
    const headers = ["Fecha", "Hora", "Pasillo", "Descripción", "Pos. Ocupadas", "Pos. Vacías", "Total", "% Ocupación", "Estado", "Usuario", "Observaciones"];
    const dataRows = historial.map(r => {
      const t   = (r.posOcupadas || 0) + (r.posVacias || 0);
      const pct = t > 0 ? Math.round(((r.posOcupadas || 0) / t) * 100) : 0;
      const p   = PASILLOS.find(p => p.value === r.pasillo);
      return [r.fecha, r.hora, r.pasillo, p?.desc || "", r.posOcupadas, r.posVacias, t, `${pct}%`, getEstado(pct).label, r.usuario || "", r.observaciones || ""];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [{wch:12},{wch:8},{wch:6},{wch:14},{wch:14},{wch:12},{wch:8},{wch:10},{wch:10},{wch:20},{wch:30}];
    XLSX.utils.book_append_sheet(wb, ws, "Inventario Pasillos");
    const d = new Date();
    XLSX.writeFile(wb, `inventario_pasillos_${pad(d.getDate())}${pad(d.getMonth()+1)}${d.getFullYear()}.xlsx`);
    showToast("✓ Excel exportado correctamente");
  };

  const inputBase     = { width: "100%", height: 40, padding: "0 12px", fontSize: 14, border: "1px solid #D4E5DE", borderRadius: 9, background: "#fff", color: "#1a2e27", outline: "none", boxSizing: "border-box", WebkitAppearance: "none", transition: "border-color 0.2s, box-shadow 0.2s" };
  const inputError    = { ...inputBase, border: "1px solid #E74C3C", background: "#FFF5F5" };
  const inputReadonly = { ...inputBase, background: "#F2F8F5", color: "#5A7A6E", border: "1px solid #E2EDE9", cursor: "default", fontWeight: 500 };
  const labelStyle    = (key) => ({ fontSize: 12, color: errors[key] ? "#C0392B" : "#6B8F80", display: "block", marginBottom: 5, fontWeight: 500 });

  const total       = (parseInt(form.posOcupadas) || 0) + (parseInt(form.posVacias) || 0);
  const ocupPct     = total > 0 ? Math.round(((parseInt(form.posOcupadas) || 0) / total) * 100) : null;
  const modoEdicion = editIdx !== null;

  // Calcular resumen global
  const resumen = calcResumen(historial);
  const estadoGlobal = getEstado(resumen.pct);

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* ════════════════════════════════════════════
          RESUMEN GLOBAL KPI — solo si hay historial
      ════════════════════════════════════════════ */}
      {historial.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {/* Título sección */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>Resumen de Capacidad Global — {TOTAL_CEDI} Posiciones CEDI</span>
          </div>

          {/* Cards KPI globales */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "TOTAL POSICIONES CEDI", val: TOTAL_CEDI, sub: `Actualizado ${generateFecha()}`, color: "#1a2e27", barPct: 100, barColor: "#3B82F6" },
              { label: "POSICIONES OCUPADAS",   val: resumen.ocupadas, sub: "Pasillos I+J · WMS real", color: "#0F6E56", barPct: (resumen.ocupadas / TOTAL_CEDI) * 100, barColor: "#22C55E" },
              { label: "POSICIONES DISPONIBLES",val: TOTAL_CEDI - resumen.ocupadas, sub: "Capacidad libre actual", color: "#6B8F80", barPct: ((TOTAL_CEDI - resumen.ocupadas) / TOTAL_CEDI) * 100, barColor: "#9CB8AE" },
              { label: "OCUPACIÓN GLOBAL UC%",  val: `${resumen.pct}%`, sub: "Meta óptima: 60% – 85%", color: resumen.pct >= 85 ? "#C0392B" : "#0F6E56", barPct: resumen.pct, barColor: getBarColor(resumen.pct) },
              { label: "UMBRAL ALERTA (85%)",   val: Math.round(TOTAL_CEDI * 0.85), sub: "Límite máximo recomendado", color: "#D97706", barPct: 85, barColor: "#F59E0B" },
              { label: "ESTADO DEL KPI",        val: estadoGlobal.label, sub: resumen.pct >= 85 ? "Por encima del umbral" : "Dentro del rango · Vigilar tendencia", color: estadoGlobal.color, barPct: resumen.pct, barColor: estadoGlobal.dot, isEstado: true, dot: estadoGlobal.dot },
            ].map((k, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2EDE9", padding: "14px 16px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#9CB8AE", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{k.label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  {k.isEstado && <span style={{ width: 10, height: 10, borderRadius: "50%", background: k.dot, display: "inline-block" }} />}
                  <span style={{ fontSize: k.isEstado ? 20 : 28, fontWeight: 900, color: k.color, lineHeight: 1 }}>{k.val}</span>
                </div>
                <div style={{ fontSize: 10, color: "#9CB8AE", marginBottom: 8, lineHeight: 1.4 }}>{k.sub}</div>
                <div style={{ height: 4, background: "#E2EDE9", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(k.barPct, 100)}%`, height: "100%", background: k.barColor, borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>

          {/* Cards por pasillo */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>📊</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>Detalle por Pasillo — Posiciones Ocupadas (Fuente: WMS)</span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            {PASILLOS.map(p => (
              <PasilloKPICard key={p.value} pasillo={p.value} registro={resumen.latest[p.value]} />
            ))}
          </div>

          {/* Tabla consolidada */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>📋</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>Tabla Consolidada — Historial de Registros</span>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          TABLA DETALLE / HISTORIAL
      ════════════════════════════════════════ */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2EDE9", overflow: "hidden", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #E2EDE9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.07em" }}>Historial de registros</span>
            {historial.length > 0 && <span style={{ fontSize: 11, color: "#0F6E56", background: "#E1F5EE", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>{historial.length}</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={cargarHistorial}
              style={{ padding: "5px 12px", fontSize: 11, border: "1px solid #D4E5DE", borderRadius: 7, background: "#fff", color: "#0F6E56", cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "#F2F8F5"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}
            >↻ Actualizar</button>
            {historial.length > 0 && (
              <button onClick={exportarExcel}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 7, background: "#0F6E56", color: "#fff", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "#085041"}
                onMouseLeave={e => e.currentTarget.style.background = "#0F6E56"}
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Exportar Excel
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: isMobile ? "12px" : "16px 20px" }}>
          {loadingHistorial ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#9CB8AE", fontSize: 13 }}>Cargando historial…</div>
          ) : historial.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
              <div style={{ fontSize: 14, color: "#6B8F80", fontWeight: 500 }}>Sin registros aún</div>
              <div style={{ fontSize: 12, color: "#9CB8AE", marginTop: 4 }}>Los registros guardados aparecerán aquí</div>
            </div>
          ) : (
            <TablaConsolidada historial={historial} onEliminar={handleEliminar} onEditar={handleEditar} />
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════
          FORMULARIO (al final, debajo del historial)
      ════════════════════════════════════════ */}
      {modoEdicion && (
        <div style={{ background: "#FFFBEB", border: "1px solid #F6D860", borderRadius: 10, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: "#92600A", fontWeight: 600 }}>✎ Modo edición — registro #{editIdx + 1}</span>
          <button onClick={handleCancelarEdicion}
            style={{ fontSize: 12, color: "#92600A", background: "none", border: "1px solid #F6D860", borderRadius: 7, padding: "4px 12px", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.background = "#FEF3C7"}
            onMouseLeave={e => e.currentTarget.style.background = "none"}
          >Cancelar edición</button>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${modoEdicion ? "#F6D860" : "#E2EDE9"}`, padding: isMobile ? "14px" : "18px 22px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {modoEdicion ? "✎ Actualizar registro" : "+ Nuevo registro de posiciones"}
          </div>
          {ocupPct !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#6B8F80" }}>Ocupación:</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: ocupPct >= 90 ? "#C0392B" : ocupPct >= 70 ? "#D97706" : "#0F6E56", background: ocupPct >= 90 ? "#FFF5F5" : ocupPct >= 70 ? "#FFFBEB" : "#E1F5EE", padding: "2px 10px", borderRadius: 20 }}>{ocupPct}%</span>
            </div>
          )}
        </div>

        {/* Fila 1: Fecha · Hora · Pasillo */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 2fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle("fecha")}>Fecha <span style={{ fontSize: 10, color: "#9CB8AE" }}>automática</span></label>
            <input type="text" value={form.fecha} readOnly style={inputReadonly} />
          </div>
          <div>
            <label style={labelStyle("hora")}>Hora <span style={{ fontSize: 10, color: "#9CB8AE" }}>automática</span></label>
            <input type="text" value={form.hora} readOnly style={inputReadonly} />
          </div>
          <div>
            <label style={labelStyle("pasillo")}>Pasillo *</label>
            <select value={form.pasillo} onChange={e => updateField("pasillo", e.target.value)}
              style={{ ...(errors.pasillo ? inputError : inputBase), cursor: "pointer", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' stroke='%236B8F80' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 36 }}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e  => { e.target.style.borderColor = errors.pasillo ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            >
              <option value="">— Selecciona un pasillo —</option>
              {PASILLOS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {/* Fila 2: Ocupadas · Vacías · Usuario */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 2fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle("posOcupadas")}>Posiciones Ocupadas *</label>
            <input type="number" min="0" value={form.posOcupadas} onChange={e => updateField("posOcupadas", e.target.value)} placeholder="0"
              style={{ ...(errors.posOcupadas ? inputError : inputBase), textAlign: "center" }}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e  => { e.target.style.borderColor = errors.posOcupadas ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            />
          </div>
          <div>
            <label style={labelStyle("posVacias")}>Posiciones Vacías *</label>
            <input type="number" min="0" value={form.posVacias} onChange={e => updateField("posVacias", e.target.value)} placeholder="0"
              style={{ ...(errors.posVacias ? inputError : inputBase), textAlign: "center" }}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e  => { e.target.style.borderColor = errors.posVacias ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            />
          </div>
          <div>
            <label style={labelStyle("usuario")}>Usuario *</label>
            <input type="text" value={form.usuario} onChange={e => updateField("usuario", e.target.value.toUpperCase())} placeholder="NOMBRE DEL OPERARIO"
              style={{ ...(errors.usuario ? inputError : inputBase), textTransform: "uppercase" }}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e  => { e.target.style.borderColor = errors.usuario ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            />
          </div>
        </div>

        {/* Barra de ocupación en tiempo real */}
        {total > 0 && (
          <div style={{ background: "#F7FCF9", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#6B8F80", fontWeight: 500 }}>Total: {total} posiciones</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: ocupPct >= 90 ? "#C0392B" : ocupPct >= 70 ? "#D97706" : "#0F6E56" }}>{ocupPct}% ocupado</span>
            </div>
            <div style={{ height: 8, background: "#E2EDE9", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${ocupPct}%`, height: "100%", background: getBarColor(ocupPct), borderRadius: 4, transition: "width 0.4s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#9CB8AE" }}>
              <span>{parseInt(form.posOcupadas) || 0} ocupadas</span>
              <span>{parseInt(form.posVacias)   || 0} vacías</span>
            </div>
          </div>
        )}

        {/* Observaciones */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "#6B8F80", display: "block", marginBottom: 5, fontWeight: 500 }}>
            Observaciones <span style={{ fontSize: 10, color: "#9CB8AE" }}>opcional</span>
          </label>
          <textarea value={form.observaciones} onChange={e => updateField("observaciones", e.target.value)}
            placeholder="Ej: Pasillo con mercancía de devolución, posiciones 3-7 bloqueadas..."
            rows={2}
            style={{ ...inputBase, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.5 }}
            onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
            onBlur={e  => { e.target.style.borderColor = "#D4E5DE"; e.target.style.boxShadow = "none"; }}
          />
        </div>

        <button onClick={handleGuardar} disabled={guardando}
          style={{ width: "100%", height: 46, borderRadius: 10, background: guardando ? "#6B8F80" : modoEdicion ? "#D97706" : "#0F6E56", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: guardando ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 0.2s" }}
          onMouseEnter={e => { if (!guardando) e.currentTarget.style.background = modoEdicion ? "#B45309" : "#085041"; }}
          onMouseLeave={e => { if (!guardando) e.currentTarget.style.background = modoEdicion ? "#D97706" : "#0F6E56"; }}
        >
          {guardando ? <><span>⏳</span> Guardando...</>
            : modoEdicion ? <><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="white" strokeWidth="1.4" strokeLinejoin="round"/></svg>Actualizar registro</>
            : <><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13.5 10.5V13a.5.5 0 0 1-.5.5H3A.5.5 0 0 1 2.5 13V10.5M8 2v8M5.5 7.5 8 10l2.5-2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Guardar registro</>
          }
        </button>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "#9CB8AE" }}>Logistics and Services · Inventario de Pasillos</div>
      <div style={{ marginTop: 4, textAlign: "center", fontSize: 11, color: "#0F6E56", fontWeight: 600 }}>Made by Logistics and Services © 2026</div>

      {/* Toast */}
      <div style={{ position: "fixed", bottom: 20, left: "50%", transform: `translateX(-50%) translateY(${toast.visible ? 0 : 10}px)`, zIndex: 1000, background: "#1a2e27", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13, fontWeight: 500, opacity: toast.visible ? 1 : 0, transition: "all 0.25s ease", pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: "90vw", textAlign: "center" }}>
        {toast.message}
      </div>

      {/* Modal confirmar eliminación */}
      {confirmDelete !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(3px)" }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 360, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", animation: "popIn 0.22s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ padding: "24px 24px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗑</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a2e27", marginBottom: 6 }}>¿Eliminar registro #{confirmDelete + 1}?</div>
              <div style={{ fontSize: 13, color: "#6B8F80" }}>
                Pasillo <strong>{historial[confirmDelete]?.pasillo}</strong> · {historial[confirmDelete]?.fecha}<br/>Esta acción no se puede deshacer.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "0 24px 24px" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, height: 42, borderRadius: 9, background: "#F2F8F5", color: "#0F6E56", border: "1px solid #C5DDD4", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#E1F5EE"} onMouseLeave={e => e.currentTarget.style.background = "#F2F8F5"}>Cancelar</button>
              <button onClick={confirmarEliminar} style={{ flex: 1, height: 42, borderRadius: 9, background: "#C0392B", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#922B21"} onMouseLeave={e => e.currentTarget.style.background = "#C0392B"}>Eliminar</button>
            </div>
          </div>
          <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}

      {/* Popup éxito nuevo registro */}
      {successPop && lastRegistro && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(3px)" }}>
          <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 400, overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.22)", animation: "popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ background: "#0F6E56", padding: "22px 28px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, textAlign: "right" }}>Logistics and Services</div>
              <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 14, color: "#fff", fontWeight: 700 }}>Registro guardado</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>Inventario de Pasillos</div>
            </div>
            <div style={{ padding: "20px 28px 6px" }}>
              {[
                { label: "Fecha / Hora",     value: `${lastRegistro.fecha} · ${lastRegistro.hora}` },
                { label: "Pasillo",          value: PASILLOS.find(p => p.value === lastRegistro.pasillo)?.label || lastRegistro.pasillo },
                { label: "Ocupadas / Vacías",value: `${lastRegistro.posOcupadas} / ${lastRegistro.posVacias}` },
                { label: "Usuario",          value: lastRegistro.usuario || "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign: "center", padding: "10px 0", borderBottom: "1px solid #F0F7F4" }}>
                  <div style={{ fontSize: 10, color: "#9CB8AE", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 14, color: "#1a2e27", fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: "16px 28px 22px", display: "flex", gap: 8 }}>
              <button onClick={handleNuevoRegistro} style={{ flex: 1, height: 44, borderRadius: 10, background: "#F2F8F5", color: "#0F6E56", border: "1px solid #C5DDD4", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#E1F5EE"} onMouseLeave={e => e.currentTarget.style.background = "#F2F8F5"}>Nuevo registro</button>
              <button onClick={() => setSuccessPop(false)} style={{ flex: 1, height: 44, borderRadius: 10, background: "#0F6E56", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#085041"} onMouseLeave={e => e.currentTarget.style.background = "#0F6E56"}>Cerrar</button>
            </div>
          </div>
          <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}`}</style>
        </div>
      )}
    </div>
  );
}
