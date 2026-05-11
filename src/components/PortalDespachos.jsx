import React, { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { BD_CLIENTES, buscarPorNit, buscarPorNombre } from "../services/clientesService";

// ── Helpers de fecha ──
const pad = n => String(n).padStart(2, "0");
const generateFecha = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const generateSolicitud = () => {
  const d = new Date();
  return `${pad(d.getDate())}${pad(d.getMonth()+1)}${String(d.getFullYear()).slice(2)}${pad(d.getHours())}${pad(d.getMinutes())}`;
};
const up = v => typeof v === "string" ? v.toUpperCase() : v;

// ── Definición de columnas ──
const COLS = [
  { key: "entrega",      label: "Entrega",             placeholder: "OC-1-435",      width: "115px", required: true  },
  { key: "destinatario", label: "Destinatario (NIT)",   placeholder: "900313153",     width: "110px", required: true  },
  { key: "nombre",       label: "Nombre destinatario",  placeholder: "EMPRESA S.A.S", width: "188px", required: true  },
  { key: "lugar",        label: "Lugar",                placeholder: "MEDELLÍN",      width: "100px", required: true  },
  { key: "material",     label: "Material",             placeholder: "770MP0403",     width: "105px", required: true  },
  { key: "cantidad",     label: "Cantidad",             placeholder: "0",             width: "76px",  required: true, numeric: true },
  { key: "um",           label: "UM",                   placeholder: "BUL",           width: "54px"  },
  { key: "item",         label: "Ítem",                 placeholder: "1001",          width: "64px",  numeric: true   },
  { key: "bodega",       label: "Bodega",               placeholder: "021",           width: "64px"  },
];

const REQUIRED_KEYS  = COLS.filter(c => c.required).map(c => c.key);
const REQUIRED_LABELS = Object.fromEntries(COLS.filter(c => c.required).map(c => [c.key, c.label.replace(" (NIT)", "")]));

const EMPTY_ROW = () => ({
  id: crypto.randomUUID(),
  entrega:"", destinatario:"", nombre:"", lugar:"",
  material:"", cantidad:"", um:"BUL", item:"1001", bodega:"021",
});

// ── Popup de confirmación ──
function SuccessPopup({ visible, meta, onClose, onNewRequest }) {
  if (!visible) return null;
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:2000,
      background:"rgba(10,30,24,0.6)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:"16px", backdropFilter:"blur(3px)",
    }}>
      <div style={{
        background:"#fff", borderRadius:20, width:"100%", maxWidth:440,
        overflow:"hidden", boxShadow:"0 28px 70px rgba(0,0,0,0.22)",
        animation:"popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <div style={{ background:"#0F6E56", padding:"22px 28px 20px", textAlign:"center" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, textAlign:"right" }}>
            Logistics and Services
          </div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", lineHeight:1.5, marginBottom:6 }}>
            Hemos recibido correctamente tu solicitud
          </div>
          <div style={{ display:"inline-block", background:"rgba(255,255,255,0.15)", borderRadius:8, padding:"6px 18px" }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginRight:6 }}>N°</span>
            <span style={{ fontSize:18, color:"#fff", fontWeight:700, letterSpacing:"0.04em" }}>{meta.solicitud}</span>
          </div>
        </div>
        <div style={{ padding:"20px 28px 6px" }}>
          {[
            { label:"Área solicitante", value: meta.area      || "—" },
            { label:"Fecha",            value: meta.fecha             },
            { label:"N° Solicitud",     value: meta.solicitud         },
            { label:"Solicitante",      value: meta.solicitante || "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign:"center", padding:"10px 0", borderBottom:"1px solid #F0F7F4" }}>
              <div style={{ fontSize:10, color:"#9CB8AE", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>{label}</div>
              <div style={{ fontSize:14, color:"#1a2e27", fontWeight:600 }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:"16px 28px 22px", textAlign:"center" }}>
          <div style={{ fontSize:11, color:"#9CB8AE", marginBottom:14 }}>El archivo .xlsx fue descargado en tu equipo</div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onNewRequest} style={{ flex:1, height:44, borderRadius:10, background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:13, fontWeight:600, cursor:"pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "#E1F5EE"}
              onMouseLeave={e => e.currentTarget.style.background = "#F2F8F5"}
            >Nueva solicitud</button>
            <button onClick={onClose} style={{ flex:1, height:44, borderRadius:10, background:"#0F6E56", color:"#fff", border:"none", fontSize:14, fontWeight:600, cursor:"pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "#085041"}
              onMouseLeave={e => e.currentTarget.style.background = "#0F6E56"}
            >Cerrar</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── Bloque de errores detallado ──
function ErrorBlock({ rows, errors }) {
  const byRow = {};
  rows.forEach((row, idx) => {
    const label = `Fila ${idx + 1}`;
    const isDup = errors[`${row.id}-entrega`] && errors[`${row.id}-material`]
      && row.entrega.trim() && row.material.trim();
    const faltantes = REQUIRED_KEYS.filter(k => errors[`${row.id}-${k}`] && !String(row[k]||"").trim())
      .map(k => REQUIRED_LABELS[k]);
    if (isDup || faltantes.length > 0) byRow[label] = { duplicado: !!isDup, faltantes };
  });
  const entries = Object.entries(byRow);
  if (entries.length === 0) return null;
  return (
    <div style={{ background:"#FFF5F5", border:"1px solid #F5A0A0", borderRadius:10, padding:"12px 16px", marginBottom:14 }}>
      <div style={{ fontSize:12, fontWeight:600, color:"#C0392B", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.5" stroke="#C0392B"/><path d="M7 4v3.5M7 10h.01" stroke="#C0392B" strokeWidth="1.3" strokeLinecap="round"/></svg>
        Errores en las líneas de despacho
      </div>
      {entries.map(([rowLabel, info]) => (
        <div key={rowLabel} style={{ fontSize:12, color:"#7B2020", marginBottom:4, paddingLeft:4 }}>
          <span style={{ fontWeight:600 }}>{rowLabel}</span>
          {info.duplicado && <span> — <span style={{ fontWeight:600, color:"#9B1C1C" }}>Registro duplicado:</span> la combinación Entrega + Material ya existe en otra línea</span>}
          {info.faltantes.length > 0 && <span style={{ color:"#9B4545" }}>{info.duplicado ? " · " : " — "}Campos requeridos: <span style={{ fontWeight:500 }}>{info.faltantes.join(", ")}</span></span>}
        </div>
      ))}
    </div>
  );
}

// ── Mobile card ──
function MobileRowCard({ row, idx, errors, onUpdate, onDelete, onDuplicate }) {
  const [open, setOpen] = useState(idx === 0);
  const hasErr = REQUIRED_KEYS.some(k => errors[`${row.id}-${k}`]);
  const summary = [row.entrega, row.material, row.cantidad ? `×${row.cantidad}` : ""].filter(Boolean).join(" · ") || "Fila vacía";

  const handleChange = (key, val) => {
    const v = key === "cantidad" || key === "item" ? val : up(val);
    onUpdate(row.id, key, v);
    if (key === "destinatario") {
      const found = BD_CLIENTES[v.trim()];
      if (found) { onUpdate(row.id, "nombre", found.nombre); onUpdate(row.id, "lugar", found.ciudad); }
      else {
        const wasFromBD = Object.values(BD_CLIENTES).some(e => e.nombre === row.nombre);
        if (wasFromBD) { onUpdate(row.id, "nombre", ""); onUpdate(row.id, "lugar", ""); }
      }
    }
  };

  const tryAutocomplete = (currentNit) => {
    const nit = (currentNit !== undefined ? currentNit : row.destinatario).trim();
    const found = BD_CLIENTES[nit];
    if (found) { onUpdate(row.id, "nombre", found.nombre); onUpdate(row.id, "lugar", found.ciudad); }
    else {
      const wasFromBD = Object.values(BD_CLIENTES).some(e => e.nombre === row.nombre);
      if (wasFromBD) { onUpdate(row.id, "nombre", ""); onUpdate(row.id, "lugar", ""); }
    }
  };

  return (
    <div style={{ border:`1px solid ${hasErr ? "#F5A0A0" : "#E2EDE9"}`, borderRadius:12, marginBottom:8, overflow:"hidden", background:"#fff" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer", background:open?"#F2F8F5":"#fff", userSelect:"none" }}>
        <span style={{ minWidth:22, height:22, borderRadius:6, background:"#E1F5EE", color:"#0F6E56", fontSize:11, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center" }}>{idx+1}</span>
        <span style={{ flex:1, fontSize:13, color:"#1a2e27", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{summary}</span>
        {hasErr && <span style={{ fontSize:11, color:"#C0392B", background:"#FFF0EE", padding:"2px 7px", borderRadius:8 }}>incompleto</span>}
        <span style={{ fontSize:16, color:"#9CB8AE", display:"inline-block", transform:open?"rotate(180deg)":"none", transition:"transform 0.2s" }}>⌄</span>
      </div>
      {open && (
        <div style={{ padding:"12px 14px 14px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {COLS.map(c => {
              const hasError = errors[`${row.id}-${c.key}`];
              return (
                <div key={c.key} style={{ gridColumn: c.key==="nombre"?"span 2":"span 1" }}>
                  <label style={{ fontSize:11, color:"#6B8F80", display:"block", marginBottom:4, fontWeight:500 }}>
                    {c.label}{c.required && <span style={{ color:"#C0392B" }}> *</span>}
                  </label>
                  <input type={c.numeric?"number":"text"} value={row[c.key]} placeholder={c.placeholder}
                    onChange={e => handleChange(c.key, e.target.value)}
                    onFocus={e => { if (c.key==="destinatario") tryAutocomplete(row.destinatario); e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.1)"; }}
                    onBlur={e => { if (c.key==="destinatario") tryAutocomplete(e.target.value); e.target.style.borderColor=hasError?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
                    onKeyDown={e => { if ((e.key==="Tab"||e.key==="Enter") && c.key==="destinatario") tryAutocomplete(e.target.value); }}
                    style={{ width:"100%", height:40, padding:"0 10px", fontSize:14, border:`1px solid ${hasError?"#E74C3C":"#D4E5DE"}`, borderRadius:8, background:hasError?"#FFF5F5":"#fff", color:"#1a2e27", outline:"none", boxSizing:"border-box", WebkitAppearance:"none", textTransform:c.numeric?"none":"uppercase" }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={() => onDuplicate(row.id)} style={{ flex:1, height:36, border:"1px solid #D4E5DE", borderRadius:8, background:"#fff", color:"#0F6E56", fontSize:13, cursor:"pointer" }}>Duplicar</button>
            <button onClick={() => onDelete(row.id)} style={{ flex:1, height:36, border:"1px solid #F5C6C0", borderRadius:8, background:"#FFF5F5", color:"#C0392B", fontSize:13, cursor:"pointer" }}>Eliminar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Componente PDF → Excel ──
function PdfToExcel({ meta, showToast }) {
  const [pdfRows, setPdfRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pdfPopup, setPdfPopup] = useState(false);
  const [pdfMeta, setPdfMeta] = useState({ solicitud:"", fecha:"", area:"", solicitante:"" });
  const [rowErrors, setRowErrors] = useState({});
  const [solicitudYaGenerada, setSolicitudYaGenerada] = useState(false);
  const pdfInputRef = useRef(null);
  const isMobileLocal = typeof window !== "undefined" && window.innerWidth < 768;
  const OUTPUT_HEADERS = ["Entrega", "Destinat.", "Nombre destinatario de mercancías", "Lugar-destinatario", "Material", "Cantidad entrega", "UM", "item", "bodega"];

  const parsePdfText = (fullText) => {
    const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
    const pedidoMatch = fullText.match(/#\s*([A-Za-z0-9]+)/);
    const numeroPedido = pedidoMatch ? pedidoMatch[1].trim() : "";
    const dirigidoIdx = lines.findIndex(l => /^dirigido a$/i.test(l));
    const nombreDestinatario = dirigidoIdx !== -1 && lines[dirigidoIdx + 1] ? lines[dirigidoIdx + 1].trim() : "";
    const bdMatch = buscarPorNombre(nombreDestinatario);
    const destinatarioNit    = bdMatch ? bdMatch[0] : "";
    const destinatarioNombre = nombreDestinatario;
    const destinatarioCiudad = bdMatch ? bdMatch[1].ciudad : "";
    const skuHeaderIdx = lines.findIndex(l => /^sku$/i.test(l));
    let startIdx = skuHeaderIdx !== -1 ? skuHeaderIdx + 1 : 0;
    const headerCols = ["producto", "cantidad", "precio", "sub total", "total"];
    while (startIdx < lines.length && headerCols.includes(lines[startIdx].toLowerCase())) startIdx++;
    const STOP = ["subtotal", "total", "generado por", "términos", "política", "click cosmetics", "despacha"];
    const SKU_RE = /^[A-Z][A-Z0-9\-]*$|^[A-Z]{2,}$/;
    const BROKEN_SKU_RE = /^([A-Z][A-Z0-9]+)\s*-\s*$/;
    const CANT_RE = /^\d{1,4}[,.]\d{2}$/;
    const isSku = (line) => SKU_RE.test(line) || BROKEN_SKU_RE.test(line);
    const parsed = [];
    let i = startIdx;
    while (i < lines.length) {
      const line = lines[i];
      if (STOP.some(sw => line.toLowerCase().startsWith(sw))) break;
      const brokenMatch = BROKEN_SKU_RE.exec(line);
      if (brokenMatch) {
        const part1 = brokenMatch[1];
        const part2 = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
        const sku = `${part1}-${part2}`;
        let cantidad = 0;
        for (let k = i + 3; k < Math.min(i + 8, lines.length); k++) {
          if (CANT_RE.test(lines[k])) { cantidad = parseFloat(lines[k].replace(",", ".")); break; }
        }
        parsed.push({ entrega: numeroPedido, destinatario: destinatarioNit, nombre: destinatarioNombre, lugar: destinatarioCiudad, material: sku, cantidad: cantidad || "", um: "BUL", item: "1001", bodega: "021" });
        i += 2;
        while (i < lines.length) { if (STOP.some(sw => lines[i].toLowerCase().startsWith(sw))) break; if (isSku(lines[i])) break; i++; }
        continue;
      }
      if (!SKU_RE.test(line)) { i++; continue; }
      const sku = line;
      let cantidad = 0;
      for (let k = i + 2; k < Math.min(i + 8, lines.length); k++) {
        if (CANT_RE.test(lines[k])) { cantidad = parseFloat(lines[k].replace(",", ".")); break; }
      }
      parsed.push({ entrega: numeroPedido, destinatario: destinatarioNit, nombre: destinatarioNombre, lugar: destinatarioCiudad, material: sku, cantidad: cantidad || "", um: "BUL", item: "1001", bodega: "021" });
      i++;
      while (i < lines.length) { if (STOP.some(sw => lines[i].toLowerCase().startsWith(sw))) break; if (isSku(lines[i])) break; i++; }
    }
    return { filas: parsed, numeroPedido, nombreDestinatario, bdMatch };
  };

  const processPdf = async (file) => {
    if (!file || file.type !== "application/pdf") { setError("Solo se aceptan archivos PDF."); return; }
    setLoading(true); setError(""); setPdfRows(""); setFileName(file.name);
    try {
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve; script.onerror = () => reject(new Error("No se pudo cargar pdf.js"));
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        for (const item of content.items) { const t = (item.str || "").trim(); if (t) fullText += t + "\n"; }
      }
      const { filas, nombreDestinatario, bdMatch } = parsePdfText(fullText);
      if (filas.length === 0) { setError("Se leyó el PDF pero no se encontraron filas de productos."); }
      else {
        setPdfRows(filas);
        if (!bdMatch && nombreDestinatario) setError(`⚠ "${nombreDestinatario}" no se encontró en la BD de clientes. NIT y ciudad quedan en blanco — puedes editarlos.`);
        else setError("");
      }
    } catch (err) { setError("Error al procesar el PDF: " + err.message); }
    finally { setLoading(false); }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files[0]; if (file) processPdf(file); };
  const updatePdfRow = (idx, key, val) => setPdfRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));

  const exportPdfToExcel = () => {
    if (pdfRows.length === 0) return;
    if (solicitudYaGenerada) { if (showToast) showToast(`⚠ Solicitud ya generada con: ${fileName}`); setPdfPopup(true); return; }
    const metaErrs = {};
    if (!meta.area.trim()) metaErrs["pdf-area"] = true;
    if (!meta.solicitante.trim()) metaErrs["pdf-solicitante"] = true;
    const correoTrimmed = meta.correo ? meta.correo.trim() : "";
    if (!correoTrimmed || !correoTrimmed.includes("@")) metaErrs["pdf-correo"] = true;
    const rErrs = {};
    pdfRows.forEach((r, idx) => {
      if (!String(r.destinatario || "").trim()) rErrs[`${idx}-destinatario`] = true;
      if (!String(r.nombre || "").trim())       rErrs[`${idx}-nombre`] = true;
      if (!String(r.lugar || "").trim())         rErrs[`${idx}-lugar`] = true;
    });
    if (Object.keys(metaErrs).length > 0 || Object.keys(rErrs).length > 0) {
      setRowErrors(rErrs);
      const msgs = [];
      if (metaErrs["pdf-area"]) msgs.push("Área solicitante");
      if (metaErrs["pdf-solicitante"]) msgs.push("Solicitante");
      if (metaErrs["pdf-correo"]) msgs.push("Correo electrónico");
      const filasFaltantes = [...new Set(Object.keys(rErrs).map(k => `Fila ${parseInt(k)+1}`))];
      if (filasFaltantes.length > 0) msgs.push(`${filasFaltantes.join(", ")}: NIT, Nombre o Ciudad vacíos`);
      if (showToast) showToast("⚠ Completa: " + msgs.join(" · "));
      return;
    }
    setRowErrors({});
    const solicitudFinal = generateSolicitud();
    const fechaFinal = generateFecha();
    const metaFinal = { solicitud: solicitudFinal, fecha: fechaFinal, area: meta.area, solicitante: meta.solicitante };
    setPdfMeta(metaFinal);
    const wb = XLSX.utils.book_new();
    const dataRows = pdfRows.map(r => [r.entrega, r.destinatario, r.nombre, r.lugar, r.material, parseFloat(r.cantidad)||0, r.um, r.item, r.bodega]);
    const ws = XLSX.utils.aoa_to_sheet([OUTPUT_HEADERS, ...dataRows]);
    ws["!cols"] = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, `despacho_${(meta.area||"pdf").replace(/\s+/g,"_")}_${solicitudFinal}.xlsx`);
    setSolicitudYaGenerada(true); setPdfPopup(true);
  };

  const resetPdf = () => { setPdfRows([]); setFileName(""); setError(""); setRowErrors({}); setPdfPopup(false); setSolicitudYaGenerada(false); if (pdfInputRef.current) pdfInputRef.current.value = ""; };

  const PREVIEW_COLS = [
    { key:"entrega", label:"Entrega", w:"110px" }, { key:"destinatario", label:"NIT", w:"100px" },
    { key:"nombre", label:"Nombre dest.", w:"180px" }, { key:"lugar", label:"Ciudad", w:"100px" },
    { key:"material", label:"Material (SKU)", w:"110px" }, { key:"cantidad", label:"Cantidad", w:"80px", numeric:true },
    { key:"um", label:"UM", w:"54px" }, { key:"item", label:"Ítem", w:"64px" }, { key:"bodega", label:"Bodega", w:"64px" },
  ];

  return (
    <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", overflow:"hidden", marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid #E2EDE9" }}>
        <span style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em" }}>Excel desde PDF</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {pdfRows.length > 0 && <span style={{ fontSize:12, color:"#0F6E56", background:"#E1F5EE", padding:"3px 10px", borderRadius:20, fontWeight:500 }}>{pdfRows.length} línea{pdfRows.length !== 1 ? "s" : ""}</span>}
          <span style={{ fontSize:11, color:"#0F6E56", background:"#E1F5EE", padding:"3px 10px", borderRadius:20, fontWeight:500 }}>nueva función</span>
        </div>
      </div>
      <div style={{ padding: isMobileLocal ? "14px 12px" : "16px 20px" }}>
        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => pdfInputRef.current?.click()}
          style={{ border:`1.5px dashed ${dragOver ? "#0F6E56" : "#C5DDD4"}`, borderRadius:10, padding:"20px 16px", textAlign:"center", background: dragOver ? "#F0FBF6" : "#F7FCF9", cursor:"pointer", marginBottom:14, transition:"border-color 0.2s, background 0.2s" }}>
          <input ref={pdfInputRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={(e) => { if (e.target.files[0]) processPdf(e.target.files[0]); }} />
          <div style={{ width:36, height:36, background:"#E1F5EE", borderRadius:8, margin:"0 auto 10px", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/><path d="M10 3v5h5" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6 10h6M6 13h4" stroke="#0F6E56" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </div>
          {loading ? <div style={{ fontSize:13, color:"#0F6E56", fontWeight:500 }}>Leyendo PDF y buscando en BD…</div>
            : fileName && pdfRows.length > 0 ? (<><div style={{ fontSize:13, fontWeight:600, color:"#1a2e27", marginBottom:2 }}>{fileName}</div><div style={{ fontSize:11, color:"#6B8F80" }}>{pdfRows.length} líneas generadas · haz clic para cambiar</div></>)
            : (<><div style={{ fontSize:13, fontWeight:500, color:"#1a2e27", marginBottom:4 }}>Arrastra tu PDF de pedido aquí</div><div style={{ fontSize:11, color:"#6B8F80", marginBottom:12 }}>Lee el PDF · busca el cliente en BD · genera el Excel de despacho</div><div style={{ display:"inline-block", padding:"7px 18px", background:"#0F6E56", color:"#fff", borderRadius:8, fontSize:12, fontWeight:500 }}>Seleccionar PDF</div></>)}
        </div>
        {error && <div style={{ background: error.startsWith("⚠") ? "#FFFBEB" : "#FFF5F5", border: `1px solid ${error.startsWith("⚠") ? "#F6D860" : "#F5A0A0"}`, borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color: error.startsWith("⚠") ? "#92600A" : "#C0392B", lineHeight:1.5 }}>{error}</div>}
        {pdfRows.length > 0 && (
          <>
            <div style={{ overflowX:"auto", marginBottom:14, borderRadius:8, border:"1px solid #E2EDE9" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860, fontSize:12 }}>
                <thead><tr style={{ background:"#F2F8F5" }}>
                  <th style={{ width:32, padding:"8px 6px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:"center", borderBottom:"1px solid #E2EDE9" }}>#</th>
                  {PREVIEW_COLS.map(c => <th key={c.key} style={{ width:c.w, padding:"8px 8px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:c.numeric?"right":"left", borderBottom:"1px solid #E2EDE9", whiteSpace:"nowrap" }}>{c.label}</th>)}
                </tr></thead>
                <tbody>{pdfRows.map((r, idx) => (
                  <tr key={idx} style={{ borderBottom:"1px solid #F0F7F4" }} onMouseEnter={e => e.currentTarget.style.background="#FAFCFB"} onMouseLeave={e => e.currentTarget.style.background=""}>
                    <td style={{ textAlign:"center", fontSize:11, color:"#9CB8AE", padding:"3px 4px" }}>{idx+1}</td>
                    {PREVIEW_COLS.map(c => { const hasErr = rowErrors[`${idx}-${c.key}`]; return (
                      <td key={c.key} style={{ padding:"3px" }}>
                        <input type={c.numeric ? "number" : "text"} value={r[c.key]} onChange={e => { updatePdfRow(idx, c.key, e.target.value); if (hasErr) setRowErrors(prev => { const n={...prev}; delete n[`${idx}-${c.key}`]; return n; }); }}
                          style={{ width:"100%", height:30, padding:"0 7px", fontSize:12, border: hasErr ? "1px solid #E74C3C" : "1px solid transparent", borderRadius:6, background: hasErr ? "#FFF5F5" : "transparent", color:"#1a2e27", outline:"none", textAlign:c.numeric?"right":"left", boxSizing:"border-box" }}
                          onFocus={e => { e.target.style.background="#F2F8F5"; e.target.style.border="1px solid #0F6E56"; }}
                          onBlur={e => { e.target.style.background = hasErr ? "#FFF5F5" : "transparent"; e.target.style.border = hasErr ? "1px solid #E74C3C" : "1px solid transparent"; }}
                        />
                      </td>); })}
                  </tr>))}</tbody>
              </table>
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <button onClick={resetPdf} style={{ padding:"8px 16px", fontSize:13, border:"1px solid #E2EDE9", borderRadius:9, background:"#fff", color:"#6B8F80", cursor:"pointer" }} onMouseEnter={e => { e.currentTarget.style.background="#FFF0EE"; e.currentTarget.style.color="#C0392B"; e.currentTarget.style.borderColor="#F5C6C0"; }} onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.color="#6B8F80"; e.currentTarget.style.borderColor="#E2EDE9"; }}>Limpiar</button>
              <button onClick={exportPdfToExcel} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 22px", fontSize:13, fontWeight:600, border:"none", borderRadius:9, background:"#0F6E56", color:"#fff", cursor:"pointer" }} onMouseEnter={e => e.currentTarget.style.background="#085041"} onMouseLeave={e => e.currentTarget.style.background="#0F6E56"}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Descargar Excel
              </button>
            </div>
          </>
        )}
      </div>
      {pdfPopup && (
        <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(10,30,24,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", backdropFilter:"blur(3px)" }}>
          <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:440, overflow:"hidden", boxShadow:"0 28px 70px rgba(0,0,0,0.22)", animation:"popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ background:"#0F6E56", padding:"22px 28px 20px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, textAlign:"right" }}>Logistics and Services</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", lineHeight:1.5, marginBottom:6 }}>Excel generado correctamente desde PDF</div>
              <div style={{ display:"inline-block", background:"rgba(255,255,255,0.15)", borderRadius:8, padding:"6px 18px" }}>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginRight:6 }}>N°</span>
                <span style={{ fontSize:18, color:"#fff", fontWeight:700, letterSpacing:"0.04em" }}>{pdfMeta.solicitud}</span>
              </div>
            </div>
            <div style={{ padding:"20px 28px 6px" }}>
              {[{ label:"Área solicitante", value: pdfMeta.area||"—" }, { label:"Fecha", value: pdfMeta.fecha }, { label:"N° Solicitud", value: pdfMeta.solicitud }, { label:"Solicitante", value: pdfMeta.solicitante||"—" }].map(({ label, value }) => (
                <div key={label} style={{ textAlign:"center", padding:"10px 0", borderBottom:"1px solid #F0F7F4" }}>
                  <div style={{ fontSize:10, color:"#9CB8AE", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:14, color:"#1a2e27", fontWeight:600 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:"16px 28px 22px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#9CB8AE", marginBottom:14 }}>El archivo .xlsx fue descargado en tu equipo</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={resetPdf} style={{ flex:1, height:44, borderRadius:10, background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:13, fontWeight:600, cursor:"pointer" }} onMouseEnter={e => e.currentTarget.style.background="#E1F5EE"} onMouseLeave={e => e.currentTarget.style.background="#F2F8F5"}>Nuevo PDF</button>
                <button onClick={() => setPdfPopup(false)} style={{ flex:1, height:44, borderRadius:10, background:"#0F6E56", color:"#fff", border:"none", fontSize:14, fontWeight:600, cursor:"pointer" }} onMouseEnter={e => e.currentTarget.style.background="#085041"} onMouseLeave={e => e.currentTarget.style.background="#0F6E56"}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// ── COMPONENTE PRINCIPAL: Portal de Despachos ──
// ══════════════════════════════════════════════
export default function PortalDespachos({ isMobile }) {
  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [solicitudFinalizada, setSolicitudFinalizada] = useState(false);
  const [meta, setMeta] = useState({ area:"", fecha:generateFecha(), solicitud:"", solicitante:"", correo:"" });
  const [errors, setErrors] = useState({});
  const [popup, setPopup] = useState(false);
  const [toast, setToast] = useState({ visible:false, message:"" });
  const tableRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (!solicitudFinalizada) setMeta(p => ({ ...p, fecha:generateFecha() }));
    }, 60000);
    return () => clearInterval(timerRef.current);
  }, [solicitudFinalizada]);

  const showToast = msg => { setToast({ visible:true, message:msg }); setTimeout(() => setToast(t => ({ ...t, visible:false })), 3500); };

  const applyClienteSync = (row, nit) => {
    const nitClean = (nit || row.destinatario).trim();
    const found = BD_CLIENTES[nitClean];
    if (found) return { ...row, nombre: found.nombre, lugar: found.ciudad };
    const wasFromBD = Object.values(BD_CLIENTES).some(v => v.nombre === row.nombre);
    return { ...row, nombre: wasFromBD ? "" : row.nombre, lugar: wasFromBD ? "" : row.lugar };
  };

  const syncCliente = (id, nit) => setRows(p => p.map(r => r.id === id ? applyClienteSync(r, nit) : r));
  const syncAllClientes = (currentRows) => currentRows.map(r => applyClienteSync(r, r.destinatario));

  const updateRow = (id, key, value) => {
    setRows(p => p.map(r => r.id === id ? { ...r, [key]:value } : r));
    setErrors(p => { const n = { ...p }; delete n[`${id}-${key}`]; return n; });
  };

  const isDuplicate = (currentId, entrega, material) => {
    if (!entrega.trim() || !material.trim()) return false;
    return rows.some(r => r.id !== currentId && r.entrega.trim().toUpperCase() === entrega.trim().toUpperCase() && r.material.trim().toUpperCase() === material.trim().toUpperCase());
  };

  const handleCellChange = (id, key, rawVal) => {
    const v = key === "cantidad" || key === "item" ? rawVal : up(rawVal);
    updateRow(id, key, v);
    if (key === "destinatario") syncCliente(id, v);
    if (key === "entrega" || key === "material") {
      const row = rows.find(r => r.id === id);
      if (!row) return;
      const entrega  = key === "entrega"  ? v : row.entrega;
      const material = key === "material" ? v : row.material;
      if (isDuplicate(id, entrega, material)) {
        setErrors(prev => ({ ...prev, [`${id}-entrega`]:true, [`${id}-material`]:true }));
        showToast(`⚠ Ya existe una línea con Entrega "${entrega}" y Material "${material}"`);
      } else {
        setErrors(prev => { const n = { ...prev }; delete n[`${id}-entrega`]; delete n[`${id}-material`]; return n; });
      }
    }
  };

  const validateRowPure = (row, allRows) => {
    const e = {};
    REQUIRED_KEYS.forEach(k => { if (!String(row[k]||"").trim()) e[`${row.id}-${k}`] = true; });
    const others = allRows.filter(r => r.id !== row.id);
    const isDup = row.entrega.trim() && row.material.trim() && others.some(r =>
      r.entrega.trim().toUpperCase()  === row.entrega.trim().toUpperCase() &&
      r.material.trim().toUpperCase() === row.material.trim().toUpperCase()
    );
    if (isDup) { e[`${row.id}-entrega`] = true; e[`${row.id}-material`] = true; }
    return e;
  };

  const validateRow = (row, allRows) => validateRowPure(row, allRows || rows);

  const validateLastRow = () => {
    const last = rows[rows.length - 1];
    const e = validateRow(last, rows);
    setErrors(prev => ({ ...prev, ...e }));
    if (Object.keys(e).length > 0) {
      const missing = REQUIRED_KEYS.filter(k => e[`${last.id}-${k}`]).map(k => REQUIRED_LABELS[k]);
      if (e[`${last.id}-entrega`] && e[`${last.id}-material`] && last.entrega.trim() && last.material.trim()) {
        showToast(`⚠ Fila ${rows.length}: ya existe Entrega "${last.entrega}" + Material "${last.material}"`);
      } else { showToast(`⚠ Fila ${rows.length} incompleta: ${missing.join(", ")}`); }
      return false;
    }
    return true;
  };

  const validateAll = () => {
    const e = {}; rows.forEach(r => Object.assign(e, validateRow(r, rows))); setErrors(e);
    return Object.keys(e).length === 0;
  };

  const addRow = () => {
    const syncedRows = rows.map((r, i) => i === rows.length - 1 ? applyClienteSync(r, r.destinatario) : r);
    setRows(syncedRows);
    const last = syncedRows[syncedRows.length - 1];
    const e = validateRowPure(last, syncedRows);
    if (Object.keys(e).length > 0) {
      setErrors(prev => ({ ...prev, ...e }));
      const missing = REQUIRED_KEYS.filter(k => e[`${last.id}-${k}`] && !String(last[k]||"").trim()).map(k => REQUIRED_LABELS[k]);
      if (e[`${last.id}-entrega`] && e[`${last.id}-material`] && last.entrega.trim() && last.material.trim()) {
        showToast(`⚠ Fila ${syncedRows.length}: ya existe Entrega "${last.entrega}" + Material "${last.material}"`);
      } else { showToast(`⚠ Completa fila ${syncedRows.length}: ${missing.join(", ")}`); }
      return;
    }
    setRows(prev => [...prev, EMPTY_ROW()]);
  };

  const deleteRow = (id) => { if (rows.length === 1) { setRows([EMPTY_ROW()]); setErrors({}); return; } setRows(p => p.filter(r => r.id !== id)); setErrors(p => { const n = { ...p }; Object.keys(n).filter(k => k.startsWith(id)).forEach(k => delete n[k]); return n; }); };
  const duplicateRow = (id) => { const row = rows.find(r => r.id === id); if (!row) return; const newRow = { ...row, id: crypto.randomUUID() }; setRows(p => { const idx = p.findIndex(r => r.id === id); const next = [...p]; next.splice(idx + 1, 0, newRow); return next; }); };
  const clearAll = () => { setRows([EMPTY_ROW()]); setMeta({ area:"", fecha:generateFecha(), solicitud:"", solicitante:"", correo:"" }); setErrors({}); setSolicitudFinalizada(false); };
  const newRequest = () => { setRows([EMPTY_ROW()]); setMeta({ area:"", fecha:generateFecha(), solicitud:"", solicitante:"", correo:"" }); setErrors({}); setPopup(false); setSolicitudFinalizada(false); };

  const exportExcel = useCallback(() => {
    const metaValidation = {};
    if (!meta.area.trim()) metaValidation["meta-area"] = true;
    if (!meta.solicitante.trim()) metaValidation["meta-solicitante"] = true;
    const correoTrimmed = meta.correo ? meta.correo.trim() : "";
    if (!correoTrimmed || !correoTrimmed.includes("@")) metaValidation["meta-correo"] = true;
    if (Object.keys(metaValidation).length > 0) {
      setErrors(prev => ({ ...prev, ...metaValidation }));
      const missingMeta = [];
      if (metaValidation["meta-area"]) missingMeta.push("Área solicitante");
      if (metaValidation["meta-solicitante"]) missingMeta.push("Solicitante");
      if (metaValidation["meta-correo"]) missingMeta.push("Correo electrónico");
      showToast(`⚠ Completa los campos del encabezado: ${missingMeta.join(", ")}`);
      return;
    }
    const syncedRows = syncAllClientes(rows);
    setRows(syncedRows);
    const allErrors = {};
    syncedRows.forEach(r => Object.assign(allErrors, validateRowPure(r, syncedRows)));
    if (Object.keys(allErrors).length > 0) { setErrors(allErrors); showToast("⚠ Hay campos requeridos incompletos o registros duplicados"); return; }
    setErrors({});
    const solicitudFinal = solicitudFinalizada ? meta.solicitud : generateSolicitud();
    const fechaFinal = generateFecha();
    const metaFinal = { ...meta, solicitud: solicitudFinal, fecha: fechaFinal };
    setMeta(metaFinal);
    setSolicitudFinalizada(true);
    const wb = XLSX.utils.book_new();
    const headers = ["Entrega","Destinat.","Nombre destinatario de mercancías","Lugar-destinatario","Material","Cantidad entrega","UM","item","bodega"];
    const dataRows = syncedRows.map(r => [r.entrega, r.destinatario, r.nombre, r.lugar, r.material, parseFloat(r.cantidad)||0, r.um, parseInt(r.item)||0, r.bodega]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [{wch:18},{wch:14},{wch:34},{wch:20},{wch:14},{wch:16},{wch:6},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    const fname = `despacho_${(meta.area||"envio").replace(/\s+/g,"_")}_${solicitudFinal}.xlsx`;
    XLSX.writeFile(wb, fname);
    setPopup(true);
  }, [rows, meta]);

  const downloadManual = () => { const link = document.createElement("a"); link.href = "/manual_portal_despachos.html"; link.download = "Manual_Portal_Despachos_Logistics_and_Services.html"; link.click(); };
  const filledRows = rows.filter(r => r.entrega || r.material || r.destinatario).length;

  const inputBase = { width:"100%", height:38, padding:"0 10px", fontSize:14, border:"1px solid #D4E5DE", borderRadius:8, background:"#fff", color:"#1a2e27", outline:"none", boxSizing:"border-box", WebkitAppearance:"none" };
  const inputReadonly = { ...inputBase, background:"#F2F8F5", color:"#5A7A6E", border:"1px solid #E2EDE9", cursor:"default", fontWeight:500 };

  return (
    <div style={{ paddingBottom:60 }}>
      {/* Action bar header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", marginBottom:16, gap:8 }}>
        {filledRows > 0 && (
          <span style={{ fontSize:12, color:"#0F6E56", background:"#E1F5EE", padding:"4px 10px", borderRadius:20, fontWeight:500 }}>
            {filledRows} línea{filledRows!==1?"s":""}
          </span>
        )}
        <button onClick={downloadManual} title="Descargar manual de usuario"
          style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 14px", fontSize:12, fontWeight:600, border:"1px solid #D4E5DE", borderRadius:8, background:"#fff", color:"#0F6E56", cursor:"pointer", transition:"all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.background="#F2F8F5"; e.currentTarget.style.borderColor="#0F6E56"; }}
          onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.borderColor="#D4E5DE"; }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H3V2z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/><path d="M13 2H8.5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5H13V2z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 4v7" stroke="#0F6E56" strokeWidth="1" strokeLinecap="round"/></svg>
          {!isMobile && "Manual"}
        </button>
      </div>

      {/* Meta */}
      <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", padding:isMobile?"14px":"18px 22px", marginBottom:16 }}>
        <div style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>Información del envío</div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"2fr 1.2fr 0.9fr 2fr 2fr", gap:12 }}>
          <div>
            <label style={{ fontSize:12, color:errors["meta-area"]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Área solicitante *</label>
            <input type="text" value={meta.area} onChange={e => { setMeta(p => ({ ...p, area:up(e.target.value) })); setErrors(p => { const n={...p}; delete n["meta-area"]; return n; }); }} placeholder="ÁREA"
              style={{ ...inputBase, textTransform:"uppercase", border:errors["meta-area"]?"1px solid #E74C3C":"1px solid #D4E5DE", background:errors["meta-area"]?"#FFF5F5":"#fff" }}
              onFocus={e => { e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)"; e.target.style.background="#fff"; }}
              onBlur={e => { e.target.style.borderColor=errors["meta-area"]?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
            />
          </div>
          <div>
            <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Fecha <span style={{ fontSize:10, color:"#9CB8AE" }}>automática</span></label>
            <input type="text" value={meta.fecha} readOnly style={inputReadonly} />
          </div>
          <div>
            <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>N° Solicitud</label>
            <input type="text" value={meta.solicitud || "—"} readOnly style={{ ...inputReadonly, letterSpacing:"0.02em" }} />
          </div>
          <div>
            <label style={{ fontSize:12, color:errors["meta-solicitante"]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Solicitante *</label>
            <input type="text" value={meta.solicitante} onChange={e => { setMeta(p => ({ ...p, solicitante:up(e.target.value) })); setErrors(p => { const n={...p}; delete n["meta-solicitante"]; return n; }); }} placeholder="NOMBRE SOLICITANTE"
              style={{ ...inputBase, textTransform:"uppercase", border:errors["meta-solicitante"]?"1px solid #E74C3C":"1px solid #D4E5DE", background:errors["meta-solicitante"]?"#FFF5F5":"#fff" }}
              onFocus={e => { e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)"; e.target.style.background="#fff"; }}
              onBlur={e => { e.target.style.borderColor=errors["meta-solicitante"]?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
            />
          </div>
          <div>
            <label style={{ fontSize:12, color:errors["meta-correo"]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Correo electrónico *</label>
            <input type="email" value={meta.correo} onChange={e => { const val = e.target.value.replace(/\s/g, ""); setMeta(p => ({ ...p, correo: val })); setErrors(p => { const n={...p}; delete n["meta-correo"]; return n; }); }} placeholder="correo@empresa.com"
              style={{ ...inputBase, border:errors["meta-correo"]?"1px solid #E74C3C":"1px solid #D4E5DE", background:errors["meta-correo"]?"#FFF5F5":"#fff" }}
              onFocus={e => { e.target.style.borderColor="#0F6E56"; e.target.style.boxShadow="0 0 0 3px rgba(15,110,86,0.08)"; e.target.style.background="#fff"; }}
              onBlur={e => { e.target.style.borderColor=errors["meta-correo"]?"#E74C3C":"#D4E5DE"; e.target.style.boxShadow="none"; }}
            />
          </div>
        </div>
      </div>

      <ErrorBlock rows={rows} errors={errors} />

      {/* Lines */}
      <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", overflow:"hidden", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", borderBottom:"1px solid #E2EDE9" }}>
          <span style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em" }}>Líneas de despacho</span>
          <span style={{ fontSize:12, color:"#6B8F80" }}>{rows.length} fila{rows.length!==1?"s":""}</span>
        </div>
        {!isMobile && (
          <div style={{ overflowX:"auto" }} ref={tableRef}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860 }}>
              <thead>
                <tr style={{ background:"#F2F8F5" }}>
                  <th style={{ width:34, padding:"8px 6px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:"center", borderBottom:"1px solid #E2EDE9" }}>#</th>
                  {COLS.map(c => (
                    <th key={c.key} style={{ width:c.width, padding:"8px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:c.numeric?"right":"left", borderBottom:"1px solid #E2EDE9", whiteSpace:"nowrap" }}>
                      {c.label}{c.required && <span style={{ color:"#C0392B" }}> *</span>}
                    </th>
                  ))}
                  <th style={{ width:60, borderBottom:"1px solid #E2EDE9" }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.id} style={{ borderBottom:"1px solid #F0F7F4", transition:"background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background="#FAFCFB"}
                    onMouseLeave={e => { e.currentTarget.style.background = ""; }}
                  >
                    <td style={{ textAlign:"center", fontSize:11, color:"#9CB8AE", userSelect:"none", padding:"3px 4px" }}>{idx+1}</td>
                    {COLS.map(c => {
                      const hasError = errors[`${row.id}-${c.key}`];
                      return (
                        <td key={c.key} style={{ padding:"3px" }}>
                          <input type={c.numeric?"number":"text"} value={row[c.key]} placeholder={c.placeholder}
                            onChange={e => handleCellChange(row.id, c.key, e.target.value)}
                            onFocus={e => { if (c.key === "destinatario") syncCliente(row.id, row.destinatario); e.target.style.background="#F2F8F5"; e.target.style.border="1px solid #0F6E56"; }}
                            onBlur={e => { if (c.key === "destinatario") syncCliente(row.id, row.destinatario); e.target.style.background = hasError?"#FFF5F5":"transparent"; e.target.style.border = hasError?"1px solid #E74C3C":"1px solid transparent"; }}
                            onKeyDown={e => { if ((e.key === "Tab" || e.key === "Enter") && c.key === "destinatario") syncCliente(row.id, e.target.value); }}
                            style={{ width:"100%", height:30, padding:"0 7px", fontSize:12, border:hasError?"1px solid #E74C3C":"1px solid transparent", borderRadius:6, background:hasError?"#FFF5F5":"transparent", color:"#1a2e27", outline:"none", textAlign:c.numeric?"right":"left", textTransform:c.numeric?"none":"uppercase", boxSizing:"border-box" }}
                          />
                        </td>
                      );
                    })}
                    <td style={{ padding:"3px 6px" }}>
                      <div style={{ display:"flex", gap:2, justifyContent:"center" }}>
                        {[
                          { label:"⎘", title:"Duplicar", fn:() => duplicateRow(row.id), hover:{ bg:"#E1F5EE", color:"#0F6E56" } },
                          { label:"×", title:"Eliminar",  fn:() => deleteRow(row.id),   hover:{ bg:"#FFF0EE", color:"#C0392B" }, big:true },
                        ].map(btn => (
                          <button key={btn.title} title={btn.title} onClick={btn.fn}
                            style={{ width:26, height:26, border:"none", background:"none", cursor:"pointer", borderRadius:5, color:"#9CB8AE", fontSize:btn.big?16:13, display:"flex", alignItems:"center", justifyContent:"center" }}
                            onMouseEnter={e => { e.currentTarget.style.background=btn.hover.bg; e.currentTarget.style.color=btn.hover.color; }}
                            onMouseLeave={e => { e.currentTarget.style.background="none"; e.currentTarget.style.color="#9CB8AE"; }}
                          >{btn.label}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isMobile && (
          <div style={{ padding:"12px" }}>
            {rows.map((row, idx) => (
              <MobileRowCard key={row.id} row={row} idx={idx} errors={errors} onUpdate={updateRow} onDelete={deleteRow} onDuplicate={duplicateRow} />
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:isMobile?"wrap":"nowrap" }}>
        <button onClick={addRow} style={{ display:"flex", alignItems:"center", gap:7, padding:isMobile?"10px 16px":"8px 16px", fontSize:13, fontWeight:500, border:"1px solid #D4E5DE", borderRadius:9, background:"#fff", color:"#0F6E56", cursor:"pointer", flex:isMobile?"1 1 auto":"none" }} onMouseEnter={e => e.currentTarget.style.background="#F2F8F5"} onMouseLeave={e => e.currentTarget.style.background="#fff"}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="#0F6E56" strokeWidth="1.5" strokeLinecap="round"/></svg>
          Agregar línea
        </button>
        <button onClick={clearAll} style={{ display:"flex", alignItems:"center", gap:7, padding:isMobile?"10px 14px":"8px 14px", fontSize:13, border:"1px solid #E2EDE9", borderRadius:9, background:"#fff", color:"#6B8F80", cursor:"pointer" }} onMouseEnter={e => { e.currentTarget.style.background="#FFF0EE"; e.currentTarget.style.color="#C0392B"; e.currentTarget.style.borderColor="#F5C6C0"; }} onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.color="#6B8F80"; e.currentTarget.style.borderColor="#E2EDE9"; }}>
          Limpiar
        </button>
        {!isMobile && <div style={{ flex:1 }} />}
        <button onClick={exportExcel} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:isMobile?"11px 20px":"9px 22px", fontSize:13, fontWeight:600, border:"none", borderRadius:9, background:"#0F6E56", color:"#fff", cursor:"pointer", flex:isMobile?"1 0 100%":"none" }} onMouseEnter={e => e.currentTarget.style.background="#085041"} onMouseLeave={e => e.currentTarget.style.background="#0F6E56"}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Descargar .xlsx
        </button>
      </div>

      {/* PDF → Excel section */}
      <div style={{ display:"flex", alignItems:"center", gap:12, margin:"32px 0 16px" }}>
        <div style={{ flex:1, height:1, background:"#E2EDE9" }} />
        <span style={{ fontSize:10, fontWeight:600, color:"#9CB8AE", textTransform:"uppercase", letterSpacing:"0.08em", whiteSpace:"nowrap" }}>Excel desde PDF</span>
        <div style={{ flex:1, height:1, background:"#E2EDE9" }} />
      </div>
      <PdfToExcel meta={meta} showToast={showToast} />

      {/* Footer */}
      <div style={{ marginTop:32, textAlign:"center", fontSize:11, color:"#9CB8AE" }}>Logistics and Services · Portal de despachos · El archivo se genera localmente en tu equipo</div>
      <div style={{ marginTop:6, textAlign:"center", fontSize:11, color:"#0F6E56", fontWeight:600 }}>Made by Logistics and Services © 2026</div>

      {/* Toast */}
      <div style={{ position:"fixed", bottom:20, left:"50%", transform:`translateX(-50%) translateY(${toast.visible?0:10}px)`, zIndex:1000, background:"#1a2e27", color:"#fff", padding:"10px 20px", borderRadius:24, fontSize:13, fontWeight:500, opacity:toast.visible?1:0, transition:"all 0.25s ease", pointerEvents:"none", whiteSpace:"nowrap", boxShadow:"0 4px 20px rgba(0,0,0,0.2)", maxWidth:"90vw", textAlign:"center" }}>
        {toast.message}
      </div>

      <SuccessPopup visible={popup} meta={meta} onClose={() => setPopup(false)} onNewRequest={newRequest} />
    </div>
  );
}
