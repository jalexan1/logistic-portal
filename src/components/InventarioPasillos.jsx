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
const up = v => typeof v === "string" ? v.toUpperCase() : v;

const LADOS = ["IZQUIERDO", "DERECHO", "AMBOS"];

const EMPTY_FORM = () => ({
  fecha: generateFecha(),
  hora: generateHora(),
  pasillo: "",
  lado: "",
  posOcupadas: "",
  posVacias: "",
  observaciones: "",
});

// ── Tarjeta de historial ──
function HistorialCard({ registro, idx }) {
  const total = (parseInt(registro.posOcupadas) || 0) + (parseInt(registro.posVacias) || 0);
  const ocupPct = total > 0 ? Math.round(((parseInt(registro.posOcupadas)||0) / total) * 100) : 0;
  const color = ocupPct >= 90 ? "#C0392B" : ocupPct >= 70 ? "#D97706" : "#0F6E56";

  return (
    <div style={{
      background: "#fff", borderRadius: 12, border: "1px solid #E2EDE9",
      padding: "14px 16px", marginBottom: 10,
      display: "flex", alignItems: "center", gap: 14,
      transition: "box-shadow 0.2s",
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
    >
      {/* Índice */}
      <div style={{ minWidth: 32, height: 32, borderRadius: 8, background: "#F2F8F5", color: "#0F6E56", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {idx + 1}
      </div>

      {/* Info principal */}
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1a2e27" }}>Pasillo {registro.pasillo}</span>
          <span style={{ fontSize: 11, color: "#6B8F80", background: "#F2F8F5", padding: "2px 8px", borderRadius: 6 }}>{registro.lado}</span>
          <span style={{ fontSize: 11, color: "#9CB8AE" }}>{registro.fecha} · {registro.hora}</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6B8F80" }}>
          <span><strong style={{ color: "#C0392B" }}>{registro.posOcupadas}</strong> ocupadas</span>
          <span><strong style={{ color: "#0F6E56" }}>{registro.posVacias}</strong> vacías</span>
          {total > 0 && <span><strong>{total}</strong> total</span>}
          {registro.observaciones && <span style={{ color: "#9CB8AE", fontStyle: "italic" }}>"{registro.observaciones}"</span>}
        </div>
      </div>

      {/* Barra de ocupación */}
      {total > 0 && (
        <div style={{ textAlign: "right", minWidth: 64 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{ocupPct}%</div>
          <div style={{ fontSize: 10, color: "#9CB8AE", marginBottom: 4 }}>ocupación</div>
          <div style={{ width: 64, height: 5, background: "#E2EDE9", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${ocupPct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// ── COMPONENTE PRINCIPAL: Inventario Pasillos ──
// ══════════════════════════════════════════
export default function InventarioPasillos({ isMobile }) {
  const [form, setForm] = useState(EMPTY_FORM());
  const [errors, setErrors] = useState({});
  const [historial, setHistorial] = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: "" });
  const [guardando, setGuardando] = useState(false);
  const [successPop, setSuccessPop] = useState(false);
  const [lastRegistro, setLastRegistro] = useState(null);

  // Actualizar hora automáticamente cada minuto
  useEffect(() => {
    const t = setInterval(() => {
      setForm(p => ({ ...p, hora: generateHora(), fecha: generateFecha() }));
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Cargar historial al montar
  useEffect(() => {
    cargarHistorial();
  }, []);

  const cargarHistorial = async () => {
    setLoadingHistorial(true);
    try {
      const data = await obtenerHistorialInventario();
      setHistorial(data);
    } catch (_) {
      setHistorial([]);
    } finally {
      setLoadingHistorial(false);
    }
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
    if (!form.pasillo.trim())                   e.pasillo = true;
    if (!form.lado)                              e.lado = true;
    if (form.posOcupadas === "" || form.posOcupadas === null) e.posOcupadas = true;
    if (form.posVacias === "" || form.posVacias === null)     e.posVacias = true;
    if (parseInt(form.posOcupadas) < 0)          e.posOcupadas = true;
    if (parseInt(form.posVacias) < 0)            e.posVacias = true;
    return e;
  };

  const handleGuardar = async () => {
    const e = validateForm();
    if (Object.keys(e).length > 0) {
      setErrors(e);
      showToast("⚠ Completa los campos requeridos");
      return;
    }

    setGuardando(true);
    const datos = {
      fecha: form.fecha,
      hora: form.hora,
      pasillo: up(form.pasillo),
      lado: form.lado,
      posOcupadas: parseInt(form.posOcupadas) || 0,
      posVacias: parseInt(form.posVacias) || 0,
      observaciones: form.observaciones.trim(),
    };

    const result = await guardarInventario(datos);
    setLastRegistro(datos);
    setHistorial(prev => [datos, ...prev]);
    setSuccessPop(true);
    setGuardando(false);

    if (!result.ok) {
      showToast("⚠ Guardado localmente (sin conexión a BD)");
    }
  };

  const handleNuevoRegistro = () => {
    setForm(EMPTY_FORM());
    setErrors({});
    setSuccessPop(false);
  };

  const exportarExcel = () => {
    if (historial.length === 0) { showToast("⚠ No hay registros para exportar"); return; }
    const wb = XLSX.utils.book_new();
    const headers = ["Fecha", "Hora", "Pasillo", "Lado", "Pos. Ocupadas", "Pos. Vacías", "Total", "% Ocupación", "Observaciones"];
    const dataRows = historial.map(r => {
      const total = (r.posOcupadas || 0) + (r.posVacias || 0);
      const pct = total > 0 ? Math.round(((r.posOcupadas || 0) / total) * 100) : 0;
      return [r.fecha, r.hora, r.pasillo, r.lado, r.posOcupadas, r.posVacias, total, `${pct}%`, r.observaciones || ""];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [{wch:12},{wch:8},{wch:10},{wch:12},{wch:14},{wch:12},{wch:8},{wch:14},{wch:30}];
    XLSX.utils.book_append_sheet(wb, ws, "Inventario Pasillos");
    const d = new Date();
    XLSX.writeFile(wb, `inventario_pasillos_${pad(d.getDate())}${pad(d.getMonth()+1)}${d.getFullYear()}.xlsx`);
    showToast("✓ Excel exportado correctamente");
  };

  const inputBase = {
    width: "100%", height: 40, padding: "0 12px", fontSize: 14,
    border: "1px solid #D4E5DE", borderRadius: 9,
    background: "#fff", color: "#1a2e27", outline: "none",
    boxSizing: "border-box", WebkitAppearance: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };
  const inputError = { ...inputBase, border: "1px solid #E74C3C", background: "#FFF5F5" };
  const inputReadonly = { ...inputBase, background: "#F2F8F5", color: "#5A7A6E", border: "1px solid #E2EDE9", cursor: "default", fontWeight: 500 };

  const labelStyle = (key) => ({
    fontSize: 12, color: errors[key] ? "#C0392B" : "#6B8F80",
    display: "block", marginBottom: 5, fontWeight: 500,
  });

  const total = (parseInt(form.posOcupadas) || 0) + (parseInt(form.posVacias) || 0);
  const ocupPct = total > 0 ? Math.round(((parseInt(form.posOcupadas)||0) / total) * 100) : null;

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* ── Formulario de registro ── */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2EDE9", padding: isMobile ? "14px" : "18px 22px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Registro de posiciones
          </div>
          {ocupPct !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#6B8F80" }}>Ocupación en tiempo real:</span>
              <span style={{
                fontSize: 13, fontWeight: 800,
                color: ocupPct >= 90 ? "#C0392B" : ocupPct >= 70 ? "#D97706" : "#0F6E56",
                background: ocupPct >= 90 ? "#FFF5F5" : ocupPct >= 70 ? "#FFFBEB" : "#E1F5EE",
                padding: "2px 10px", borderRadius: 20,
              }}>{ocupPct}%</span>
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
            <input type="text" value={form.pasillo}
              onChange={e => updateField("pasillo", up(e.target.value))}
              placeholder="Ej: A1, B2, PASILLO-3"
              style={errors.pasillo ? inputError : inputBase}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e => { e.target.style.borderColor = errors.pasillo ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            />
          </div>
        </div>

        {/* Fila 2: Lado · Posiciones Ocupadas · Posiciones Vacías */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1.5fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          {/* Lado: selector de botones */}
          <div>
            <label style={labelStyle("lado")}>Lado *</label>
            <div style={{ display: "flex", gap: 6 }}>
              {LADOS.map(l => (
                <button key={l} onClick={() => { updateField("lado", l); }}
                  style={{
                    flex: 1, height: 40, border: `1px solid ${form.lado === l ? "#0F6E56" : errors.lado ? "#E74C3C" : "#D4E5DE"}`,
                    borderRadius: 9, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    background: form.lado === l ? "#0F6E56" : errors.lado ? "#FFF5F5" : "#fff",
                    color: form.lado === l ? "#fff" : errors.lado ? "#C0392B" : "#1a2e27",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (form.lado !== l) { e.currentTarget.style.background = "#F2F8F5"; e.currentTarget.style.borderColor = "#0F6E56"; } }}
                  onMouseLeave={e => { if (form.lado !== l) { e.currentTarget.style.background = errors.lado ? "#FFF5F5" : "#fff"; e.currentTarget.style.borderColor = errors.lado ? "#E74C3C" : "#D4E5DE"; } }}
                >{l.charAt(0) + l.slice(1).toLowerCase()}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle("posOcupadas")}>Posiciones Ocupadas *</label>
            <input type="number" min="0" value={form.posOcupadas}
              onChange={e => updateField("posOcupadas", e.target.value)}
              placeholder="0"
              style={{ ...(errors.posOcupadas ? inputError : inputBase), textAlign: "center" }}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e => { e.target.style.borderColor = errors.posOcupadas ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            />
          </div>

          <div>
            <label style={labelStyle("posVacias")}>Posiciones Vacías *</label>
            <input type="number" min="0" value={form.posVacias}
              onChange={e => updateField("posVacias", e.target.value)}
              placeholder="0"
              style={{ ...(errors.posVacias ? inputError : inputBase), textAlign: "center" }}
              onFocus={e => { e.target.style.borderColor = "#0F6E56"; e.target.style.boxShadow = "0 0 0 3px rgba(15,110,86,0.08)"; }}
              onBlur={e => { e.target.style.borderColor = errors.posVacias ? "#E74C3C" : "#D4E5DE"; e.target.style.boxShadow = "none"; }}
            />
          </div>
        </div>

        {/* Fila 3: Barra de ocupación (si hay datos) + Observaciones */}
        {total > 0 && (
          <div style={{ background: "#F7FCF9", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#6B8F80", fontWeight: 500 }}>Total: {total} posiciones</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: ocupPct >= 90 ? "#C0392B" : ocupPct >= 70 ? "#D97706" : "#0F6E56" }}>{ocupPct}% ocupado</span>
            </div>
            <div style={{ height: 8, background: "#E2EDE9", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${ocupPct}%`, height: "100%", background: ocupPct >= 90 ? "#C0392B" : ocupPct >= 70 ? "#F59E0B" : "#0F6E56", borderRadius: 4, transition: "width 0.4s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#9CB8AE" }}>
              <span>{parseInt(form.posOcupadas)||0} ocupadas</span>
              <span>{parseInt(form.posVacias)||0} vacías</span>
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
            onBlur={e => { e.target.style.borderColor = "#D4E5DE"; e.target.style.boxShadow = "none"; }}
          />
        </div>

        {/* Botón guardar */}
        <button onClick={handleGuardar} disabled={guardando}
          style={{ width: "100%", height: 46, borderRadius: 10, background: guardando ? "#6B8F80" : "#0F6E56", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: guardando ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 0.2s" }}
          onMouseEnter={e => { if (!guardando) e.currentTarget.style.background = "#085041"; }}
          onMouseLeave={e => { if (!guardando) e.currentTarget.style.background = "#0F6E56"; }}
        >
          {guardando ? (
            <><span style={{ fontSize: 16 }}>⏳</span> Guardando...</>
          ) : (
            <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 10.5V13a.5.5 0 0 1-.5.5H3A.5.5 0 0 1 2.5 13V10.5M8 2v8M5.5 7.5 8 10l2.5-2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Guardar registro</>
          )}
        </button>
      </div>

      {/* ── Historial ── */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2EDE9", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #E2EDE9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.07em" }}>Historial de registros</span>
            {historial.length > 0 && (
              <span style={{ fontSize: 11, color: "#0F6E56", background: "#E1F5EE", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>{historial.length}</span>
            )}
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
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
            historial.map((r, idx) => <HistorialCard key={idx} registro={r} idx={idx} />)
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, textAlign: "center", fontSize: 11, color: "#9CB8AE" }}>Logistics and Services · Inventario de Pasillos</div>
      <div style={{ marginTop: 6, textAlign: "center", fontSize: 11, color: "#0F6E56", fontWeight: 600 }}>Made by Logistics and Services © 2026</div>

      {/* Toast */}
      <div style={{
        position: "fixed", bottom: 20, left: "50%",
        transform: `translateX(-50%) translateY(${toast.visible ? 0 : 10}px)`,
        zIndex: 1000, background: "#1a2e27", color: "#fff",
        padding: "10px 20px", borderRadius: 24, fontSize: 13, fontWeight: 500,
        opacity: toast.visible ? 1 : 0, transition: "all 0.25s ease",
        pointerEvents: "none", whiteSpace: "nowrap",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: "90vw", textAlign: "center",
      }}>
        {toast.message}
      </div>

      {/* ── Popup de éxito ── */}
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
                { label: "Fecha / Hora", value: `${lastRegistro.fecha} · ${lastRegistro.hora}` },
                { label: "Pasillo", value: lastRegistro.pasillo },
                { label: "Lado", value: lastRegistro.lado },
                { label: "Ocupadas / Vacías", value: `${lastRegistro.posOcupadas} / ${lastRegistro.posVacias}` },
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
