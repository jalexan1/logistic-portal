import React, { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { BD_CLIENTES, buscarPorNombre, buscarNombreExacto } from "../services/clientesService";
import { radicarSolicitud, nuevaLlave, obtenerLineas } from "../services/solicitudesService";
import { cargarItemsEan, eanDeSku, cargarCiudades, departamentoDeCiudad } from "../services/maestrosService";
import { normalizarLinea, descargarExcelPlantilla } from "../services/excelDespachoService";
import { leerPlantillaPedido, compararConMaestro, resolverNit, URL_PLANTILLA } from "../services/plantillaPedidoExcel";
import { validarAdjuntos, subirAdjuntos, tamanoLegible } from "../services/adjuntosService";
import { cargarParametros, PARAMETROS_DEFECTO } from "../services/parametrosService";
import BuscadorMaestro from "./BuscadorMaestro";
import { leerModeloNoviembre2026, normalizarSku, NOMBRE_MODELO_NOVIEMBRE_2026 } from "../services/pdfModeloNoviembre2026";
import { fechaHoraBogota } from "../utils/fechas";
import { useAuth } from "./auth/authContext";
import { AREAS, MOTIVOS, MOTIVOS_SIN_CLIENTE, etiquetaMotivo } from "../utils/tablaLineas";
import SolicitudesDelDia from "./SolicitudesDelDia";
import ConsentimientoPopup from "./ConsentimientoPopup";
import { registrarConsentimiento, vincularConsentimiento } from "../services/consentimientoService";

// ── Helpers de fecha ──
const pad = n => String(n).padStart(2, "0");
const generateFecha = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const up = v => typeof v === "string" ? v.toUpperCase() : v;

// ── Listas del encabezado (fase 6) ──
// valor = lo que se guarda en la base · etiqueta = lo que ve el usuario
// (AREAS, MOTIVOS y MOTIVOS_SIN_CLIENTE están en utils/tablaLineas.js)
// Campos del cliente que se llenan con la palabra del motivo (LUEGO PAGO / FARMATODO)
const CAMPOS_CLIENTE = ["destinatario", "nombre", "direccion", "telefono", "lugar", "departamento"];
const llenarSinCliente = (r, motivo) => ({ ...r, ...Object.fromEntries(CAMPOS_CLIENTE.map(k => [k, motivo])) });
const sinTildes = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const areaDeLista = v => AREAS.find(a => a.valor === sinTildes(v))?.valor || "";
const FLECHA_SELECT = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%230F6E56' stroke-width='1.6' fill='none'/%3E%3C/svg%3E\") no-repeat right 10px center";

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

// ── Descarga del Excel con el formato de la plantilla (fase 6) ──
// En la pantalla Despachos el solicitante descarga UN solo archivo
// (pedido_<ÁREA>_<N°>.xlsx) con las 10 columnas de Plantilla_Pedido.xlsx.
// Se arman con las líneas GUARDADAS en la base (que ya trae EAN, dirección,
// departamento y teléfono completados desde los maestros). Si la consulta
// falla, se arman con lo que hay en pantalla para no dejar al usuario sin archivo.
async function descargarDespacho({ id, numero, area, solicitante, correo, radicadaAt, filasLocales }) {
  const enc = { numero, area, solicitante, correo, radicadaAt };
  let lineas;
  try {
    const guardadas = id ? await obtenerLineas(id) : [];
    lineas = guardadas.length ? guardadas.map(l => normalizarLinea(l, enc)) : null;
  } catch { lineas = null; }
  if (!lineas) lineas = filasLocales.map(r => normalizarLinea(r, enc));
  return descargarExcelPlantilla({ area, numero, lineas });
}

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
            {meta.esReintento ? "Esta solicitud ya estaba radicada" : "Solicitud radicada en la plataforma"}
          </div>
          <div style={{ display:"inline-block", background:"rgba(255,255,255,0.15)", borderRadius:8, padding:"6px 18px" }}>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginRight:6 }}>N°</span>
            <span style={{ fontSize:18, color:"#fff", fontWeight:700, letterSpacing:"0.04em" }}>{meta.solicitud}</span>
          </div>
        </div>
        <div style={{ padding:"20px 28px 6px" }}>
          {[
            { label:"Área · Motivo",    value: [meta.area, etiquetaMotivo(meta.proceso)].filter(Boolean).join(" · ") || "—" },
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
          <div style={{ fontSize:11, color:"#9CB8AE", marginBottom:14 }}>Se descargó el Excel del pedido (formato de la plantilla)</div>
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
function PdfToExcel({ meta, showToast, onRadicada }) {
  // Mostrar / ocultar la sección (se recuerda la preferencia en este navegador)
  const [abierto, setAbierto] = useState(() => {
    try { return localStorage.getItem("despachos_pdf_abierto") === "1"; } catch { return false; }
  });
  const alternar = () => setAbierto(v => {
    const n = !v;
    try { localStorage.setItem("despachos_pdf_abierto", n ? "1" : "0"); } catch { /* sin almacenamiento: no pasa nada */ }
    return n;
  });
  const [pdfRows, setPdfRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pdfPopup, setPdfPopup] = useState(false);
  const [pdfMeta, setPdfMeta] = useState({ solicitud:"", fecha:"", area:"", solicitante:"" });
  const [rowErrors, setRowErrors] = useState({});
  const [solicitudYaGenerada, setSolicitudYaGenerada] = useState(false);
  const [pedidoHeader, setPedidoHeader] = useState(null);
  const [enviandoPdf, setEnviandoPdf] = useState(false);
  const [lupa, setLupa] = useState(null);            // { tipo: 'destinatario'|'item', idx, inicial }
  const [noMaestro, setNoMaestro] = useState(null);  // { items: [{ idx, nombre, nit, datos }] } clientes no encontrados
  const [inconsist, setInconsist] = useState(null);  // { grupos: [...] } datos de la plantilla distintos al maestro
  const [origenCarga, setOrigenCarga] = useState("PDF"); // PDF | EXCEL
  const [cargandoExcel, setCargandoExcel] = useState(false);
  const [dragExcel, setDragExcel] = useState(false);
  const excelInputRef = useRef(null);
  // ── Motivo sin cliente (LUEGO PAGO / FARMATODO) ──
  // Al elegirlo, NIT, nombre, dirección, teléfono, ciudad y departamento se
  // llenan con la palabra del motivo y no se pide buscar ni crear el cliente.
  // Si se cambia a otro motivo, se recuperan los datos que traía el archivo.
  const sinCliente = MOTIVOS_SIN_CLIENTE.includes(meta.proceso);
  useEffect(() => {
    if (!pdfRows.length) return;
    if (sinCliente) {
      if (pdfRows.every(r => CAMPOS_CLIENTE.every(k => r[k] === meta.proceso))) return;
      setPdfRows(prev => prev.map(r => ({ ...llenarSinCliente(r, meta.proceso), _orig: r._orig || Object.fromEntries(CAMPOS_CLIENTE.map(k => [k, r[k] ?? ""])) })));
      setNoMaestro(null); setInconsist(null);
      setRowErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !CAMPOS_CLIENTE.some(c => k.endsWith(`-${c}`)))));
      setError(prev => (/maestro de clientes/.test(prev) ? "" : prev));
    } else if (pdfRows.some(r => r._orig)) {
      setPdfRows(prev => prev.map(r => { if (!r._orig) return r; const { _orig, ...resto } = r; return { ...resto, ..._orig }; }));
    }
  }, [sinCliente, meta.proceso, pdfRows]);

  // Adjuntos del pedido (.zip, imágenes, QR): se suben al radicar
  const [adjuntos, setAdjuntos] = useState([]);
  const [adjSubidos, setAdjSubidos] = useState(false);
  const [paramAdj, setParamAdj] = useState(PARAMETROS_DEFECTO);
  const adjInputRef = useRef(null);
  useEffect(() => { cargarParametros().then(setParamAdj).catch(() => {}); }, []);
  const agregarAdjuntos = (lista) => {
    const { validos, errores } = validarAdjuntos([...lista], adjuntos, paramAdj);
    if (validos.length) { setAdjuntos(prev => [...prev, ...validos]); setAdjSubidos(false); }
    if (errores.length && showToast) showToast("⚠ " + errores.join(" · "));
    if (adjInputRef.current) adjInputRef.current.value = "";
  };
  const [modeloLeido, setModeloLeido] = useState(""); // modelo de lectura usado (original / modelo_noviembre_2026)
  const valorAlEntrar = useRef("");                  // valor de la celda al entrar (para saber si cambió)
  const llavePdfRef = useRef(null);   // misma llave en reintentos → no duplica
  const pdfInputRef = useRef(null);

  // ── Alerta de inventario (consentimiento) antes de cargar Excel o PDF (SQL 032) ──
  //  consent: popup abierto → { origen: "EXCEL"|"PDF", file?: File, soloRegistrar?: bool }
  //  permitidoRef: el usuario aceptó y se abrió el selector de archivo
  //  consentimientoRef: aceptación registrada para el archivo cargado → { id, version, aceptado_at }
  const [consent, setConsent] = useState(null);
  const [registrandoConsent, setRegistrandoConsent] = useState(false);
  const permitidoRef = useRef({ EXCEL: false, PDF: false });
  const consentimientoRef = useRef(null);
  const pedirConsentimiento = (origen, file = null) => setConsent({ origen, file });
  const registrarYCargar = async (origen, file, version) => {
    setRegistrandoConsent(true);
    try { consentimientoRef.current = await registrarConsentimiento({ version, origen, archivo: file ? file.name : (fileName || null) }); }
    catch (e) {
      consentimientoRef.current = null;
      setError("⚠ No se pudo registrar la aceptación de la alerta de inventario: " + e.message + ". El pedido no se cargó.");
      return false;
    } finally { setRegistrandoConsent(false); }
    if (file) { if (origen === "PDF") processPdf(file); else processExcel(file); }
    return true;
  };
  const aceptarConsentimiento = async (texto) => {
    const { origen, file, soloRegistrar } = consent;
    if (soloRegistrar) {   // ya hay líneas cargadas sin constancia: solo se registra
      if (await registrarYCargar(origen, null, texto.version) && showToast) showToast("✓ Aceptación registrada. Pulse «Radicar y descargar Excel» de nuevo.");
      setConsent(null); return;
    }
    if (file) { await registrarYCargar(origen, file, texto.version); setConsent(null); return; }
    // Sin archivo todavía: se abre el selector (debe ser en el mismo clic, por eso va antes de cualquier espera)
    permitidoRef.current[origen] = texto.version || true;
    setConsent(null);
    (origen === "PDF" ? pdfInputRef : excelInputRef).current?.click();
  };
  const alElegirArchivo = (origen, e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const version = permitidoRef.current[origen];
    permitidoRef.current[origen] = false;
    if (version) registrarYCargar(origen, f, typeof version === "number" ? version : null);
    else pedirConsentimiento(origen, f);
  };
  const isMobileLocal = typeof window !== "undefined" && window.innerWidth < 768;

  const parsePdfText = (fullText) => {
    const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
    const pedidoMatch = fullText.match(/#\s*([A-Za-z0-9]+)/);
    const numeroPedido = pedidoMatch ? pedidoMatch[1].trim() : "";
    // ENTREGA = código del encabezado superior izquierdo del PDF (ej. "Clic0015587"),
    // que va ANTES de la línea "# Click0015587". Si no aparece, se usa el N° de pedido.
    const ENTREGA_RE = /^[A-Za-z]{2,10}\d{5,}$/;
    const hashIdx = lines.findIndex(l => l.startsWith("#"));
    const encabezado = lines.slice(0, hashIdx !== -1 ? hashIdx : Math.min(lines.length, 8));
    let entregaPdf = encabezado.find(l => ENTREGA_RE.test(l)) || numeroPedido;
    const dirigidoIdx = lines.findIndex(l => /^dirigido a$/i.test(l));
    let nombreDestinatario = dirigidoIdx !== -1 && lines[dirigidoIdx + 1] ? lines[dirigidoIdx + 1].trim() : "";
    let bdMatch = buscarPorNombre(nombreDestinatario);
    let destinatarioNit    = bdMatch ? bdMatch[0] : "";
    // Con coincidencia en el maestro se usa el nombre del maestro (NIT y nombre quedan alineados)
    let destinatarioNombre = bdMatch ? bdMatch[1].nombre : nombreDestinatario;
    let destinatarioCiudad = bdMatch ? bdMatch[1].ciudad : "";
    let maestro = bdMatch ? bdMatch[1] : {};

    const SKU_RE = /^[A-Z][A-Z0-9\-]*$|^[A-Z]{2,}$/;
    const BROKEN_SKU_RE = /^([A-Z][A-Z0-9]+)\s*-\s*$/;
    const CANT_RE = /^\d{1,4}[,.]\d{2}$/;
    const PRICE_RE = /^-?\s*\$\s*[\d.,]+$/;
    const PCT_RE = /^\d{1,3}[,.]\d{2}%$/;
    const STOP = ["subtotal", "total", "generado por", "términos", "política", "click cosmetics", "despacha"];
    const isSku = (line) => SKU_RE.test(line) || BROKEN_SKU_RE.test(line);

    // El punto de partida es la primera línea que "parece SKU" tras el
    // encabezado "Sku" — así no depende de la lista exacta de columnas
    // (Producto/Cantidad/Precio/Descuento/Sub Total/Total) ni se confunde
    // con la palabra "Total" del propio encabezado.
    const skuHeaderIdx = lines.findIndex(l => /^sku$/i.test(l));
    let startIdx = skuHeaderIdx !== -1 ? skuHeaderIdx + 1 : 0;
    while (startIdx < lines.length && !isSku(lines[startIdx])) startIdx++;

    const parsed = [];
    let i = startIdx;
    while (i < lines.length) {
      const line = lines[i];
      if (STOP.some(sw => line.toLowerCase().startsWith(sw))) break;
      const brokenMatch = BROKEN_SKU_RE.exec(line);
      let sku, descStart, cantIdx = -1;
      if (brokenMatch) {
        const part1 = brokenMatch[1];
        const part2 = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
        sku = `${part1}-${part2}`;
        descStart = i + 2;
        for (let k = i + 3; k < Math.min(i + 8, lines.length); k++) {
          if (CANT_RE.test(lines[k])) { cantIdx = k; break; }
        }
      } else if (SKU_RE.test(line)) {
        sku = line;
        descStart = i + 1;
        for (let k = i + 2; k < Math.min(i + 8, lines.length); k++) {
          if (CANT_RE.test(lines[k])) { cantIdx = k; break; }
        }
      } else {
        i++; continue;
      }
      const cantidad = cantIdx !== -1 ? parseFloat(lines[cantIdx].replace(",", ".")) : 0;
      // Info adicional (solo para el archivo informativo TODA_LA_INFO)
      const producto = cantIdx !== -1 ? lines.slice(descStart, cantIdx).join(" ") : "";
      let precio = "", descuentoPct = "", subtotalLinea = "", totalLinea = "";
      if (cantIdx !== -1) {
        const after = [lines[cantIdx+1], lines[cantIdx+2], lines[cantIdx+3], lines[cantIdx+4]];
        if (PRICE_RE.test(after[0]||"")) precio = after[0];
        if (PCT_RE.test(after[1]||"")) descuentoPct = after[1];
        if (PRICE_RE.test(after[2]||"")) subtotalLinea = after[2];
        if (PRICE_RE.test(after[3]||"")) totalLinea = after[3];
      }
      const itemEan = eanDeSku(sku);
      parsed.push({
        entrega: entregaPdf, destinatario: destinatarioNit, nombre: destinatarioNombre,
        direccion: maestro.direccion || "", lugar: destinatarioCiudad, departamento: maestro.departamento || departamentoDeCiudad(destinatarioCiudad || maestro.ciudad),
        telefono: maestro.telefono || "",
        material: sku, ean: itemEan ? itemEan.ean : "", cantidad: cantidad || "", um: "BUL", item: "1001", bodega: "021",
        producto, precio, descuentoPct, subtotalLinea, totalLinea,
      });
      i = brokenMatch ? i + 2 : i + 1;
      while (i < lines.length) { if (STOP.some(sw => lines[i].toLowerCase().startsWith(sw))) break; if (isSku(lines[i])) break; i++; }
    }

    // ── Respaldo: modelo_noviembre_2026 ──────────────────────────────────
    // El modelo original manda. Solo si dejó algo sin leer (destinatario,
    // entrega, filas o cantidades) se lee el PDF con el modelo_noviembre_2026
    // y se completa ÚNICAMENTE lo que faltó.
    let modelo = "modelo_original";
    let m2 = null;
    const faltaAlgo = !nombreDestinatario || !entregaPdf || parsed.length === 0 || parsed.some(r => !(parseFloat(r.cantidad) > 0));
    if (faltaAlgo) {
      m2 = leerModeloNoviembre2026(fullText);
      const aporta = (!nombreDestinatario && m2.nombreDestinatario) || (!entregaPdf && m2.entrega)
        || (parsed.length === 0 && m2.filas.length > 0)
        || (parsed.some(r => !(parseFloat(r.cantidad) > 0)) && m2.filas.some(f => f.cantidad > 0));
      if (!aporta) m2 = null;
    }
    if (m2) {
      modelo = NOMBRE_MODELO_NOVIEMBRE_2026;
      if (!entregaPdf && m2.entrega) entregaPdf = m2.entrega;
      if (!nombreDestinatario && m2.nombreDestinatario) {
        nombreDestinatario = m2.nombreDestinatario;           // "Para:" del PDF
        bdMatch = buscarPorNombre(nombreDestinatario);
        destinatarioNit    = bdMatch ? bdMatch[0] : "";
        destinatarioNombre = bdMatch ? bdMatch[1].nombre : nombreDestinatario;
        destinatarioCiudad = bdMatch ? bdMatch[1].ciudad : "";
        maestro = bdMatch ? bdMatch[1] : {};
      }
      if (parsed.length === 0) {
        // El modelo original no leyó filas: se toman todas del modelo nuevo
        m2.filas.forEach(f => parsed.push({ material: f.sku, cantidad: f.cantidad || "", producto: f.producto,
          precio: f.precio, descuentoPct: "", subtotalLinea: "", totalLinea: f.total }));
      } else {
        // Completar solo lo vacío: misma posición y mismo SKU; si no, el primer SKU igual sin usar
        const usadas = new Set();
        parsed.forEach((r, k) => {
          let j = m2.filas[k] && normalizarSku(m2.filas[k].sku) === normalizarSku(r.material) && !usadas.has(k) ? k : -1;
          if (j === -1) j = m2.filas.findIndex((f, x) => !usadas.has(x) && normalizarSku(f.sku) === normalizarSku(r.material));
          if (j === -1) return;
          usadas.add(j);
          const f = m2.filas[j];
          if (!(parseFloat(r.cantidad) > 0) && f.cantidad > 0) r.cantidad = f.cantidad;
          if (!r.producto) r.producto = f.producto;
          if (!r.precio) r.precio = f.precio;
          if (!r.totalLinea) r.totalLinea = f.total;
        });
      }
      // Destinatario y entrega (posiblemente nuevos) en todas las filas
      parsed.forEach(r => {
        const itemEan = r.ean ? null : eanDeSku(r.material);
        Object.assign(r, {
          entrega: entregaPdf, destinatario: destinatarioNit, nombre: destinatarioNombre,
          direccion: maestro.direccion || "", lugar: destinatarioCiudad,
          departamento: maestro.departamento || departamentoDeCiudad(destinatarioCiudad || maestro.ciudad),
          telefono: maestro.telefono || r.telefono || "",
          ean: r.ean || (itemEan ? itemEan.ean : ""), um: r.um || "BUL", item: r.item || "1001", bodega: r.bodega || "021",
        });
      });
    }

    // ── Info adicional de cabecera del pedido (solo para TODA_LA_INFO) ──
    const getNext = (idx) => (idx !== -1 && lines[idx + 1]) ? lines[idx + 1].trim() : "";
    const fechaCreacionIdx = lines.findIndex(l => /^fecha de creaci[oó]n$/i.test(l));
    const fechaVencIdx     = lines.findIndex(l => /^fecha de vencimiento$/i.test(l));
    const fechaCreacion    = getNext(fechaCreacionIdx) || (m2 ? m2.fechaEmision : "");
    const fechaVencimiento = getNext(fechaVencIdx) || (m2 ? m2.fechaVencimiento : "");

    let clienteCorreo = m2 ? m2.correoDestinatario : "", clienteTelefono = "";
    if (dirigidoIdx !== -1) {
      for (let k = dirigidoIdx + 2; k < Math.min(dirigidoIdx + 5, lines.length); k++) {
        if (!clienteCorreo && lines[k].includes("@")) clienteCorreo = lines[k];
        else if (!clienteTelefono && /^\+?\d[\d\s]{6,}$/.test(lines[k])) clienteTelefono = lines[k];
      }
    }

    const generadoPorIdx = lines.findIndex(l => /^generado por:?$/i.test(l));
    let generadoPorNombre = "", generadoPorCorreo = "";
    if (generadoPorIdx !== -1 && lines[generadoPorIdx + 1]) {
      const raw = lines[generadoPorIdx + 1].replace(/\.$/, "");
      const parts = raw.split(",");
      generadoPorNombre = (parts[0] || "").trim();
      generadoPorCorreo = (parts[1] || "").trim();
    }

    const findTotalVal = (label) => {
      let idx = -1;
      for (let k = lines.length - 1; k >= 0; k--) { if (lines[k].toLowerCase() === label) { idx = k; break; } }
      return idx !== -1 && lines[idx + 1] ? lines[idx + 1] : "";
    };
    const subtotalFactura  = findTotalVal("subtotal");
    const descuentoFactura = findTotalVal("descuento");
    const totalFactura     = findTotalVal("total") || (m2 ? m2.totalFactura : "");

    // Teléfono: el del maestro manda; si no hay, el que trae el PDF
    if (clienteTelefono) parsed.forEach(r => { if (!r.telefono) r.telefono = clienteTelefono; });

    const pedidoHeader = {
      numeroPedido, entrega: entregaPdf, fechaCreacion, fechaVencimiento,
      clienteNombre: nombreDestinatario, clienteCorreo, clienteTelefono,
      generadoPorNombre, generadoPorCorreo,
      subtotalFactura, descuentoFactura, totalFactura, modelo,
    };

    return { filas: parsed, numeroPedido, nombreDestinatario, bdMatch, pedidoHeader, modelo };
  };

  const processPdf = async (file) => {
    if (!file || file.type !== "application/pdf") { setError("Solo se aceptan archivos PDF."); return; }
    setLoading(true); setError(""); setPdfRows([]); setFileName(file.name); setRowErrors({}); setModeloLeido(""); setOrigenCarga("PDF"); setInconsist(null);
    try {
      // Maestro Item/EAN para completar la columna EAN (si falla, el EAN se digita)
      try { await cargarItemsEan(); } catch (e) { if (showToast) showToast("⚠ " + e.message + ". El EAN deberá digitarse."); }
      // Ciudad → departamento: completa el departamento si el maestro de clientes no lo trae
      try { await cargarCiudades(); } catch { /* sin maestro de ciudades: el departamento se digita */ }
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
      const { filas, nombreDestinatario, bdMatch, pedidoHeader: header, modelo } = parsePdfText(fullText);
      setModeloLeido(modelo);
      if (filas.length === 0) { setError("Se leyó el PDF pero no se encontraron filas de productos."); setPedidoHeader(null); }
      else {
        setPdfRows(filas);
        setPedidoHeader(header);
        // 28-oct: el PDF sigue las MISMAS reglas que la plantilla Excel:
        //  · cliente no encontrado → aviso + lupa + crear cliente PRELLENADO con los datos del PDF
        //  · cliente con datos distintos al maestro → aviso de información inconsistente
        const { noEncontrados, inconsistentes } = compararConMaestro(filas, BD_CLIENTES);
        if (noEncontrados.length || !bdMatch) {
          const items = noEncontrados.length ? noEncontrados
            : [{ idx: 0, entrega: filas[0]?.entrega, nit: "", nombre: nombreDestinatario || "",
                 datos: { nit: "", nombre: nombreDestinatario || "", direccion: filas[0]?.direccion, ciudad: filas[0]?.lugar, departamento: filas[0]?.departamento, telefono: filas[0]?.telefono } }];
          const n = {};
          items.forEach(g => filas.forEach((r, i) => { if (r.entrega === g.entrega && r.destinatario === g.nit) n[`${i}-destinatario`] = true; }));
          setRowErrors(n);
          setNoMaestro({ items });
          setError(`⚠ "${items[0].nombre || nombreDestinatario || "Destinatario"}" no se encontró en el maestro de clientes. Búsquelo primero con la lupa 🔍; si no existe, desde la misma búsqueda puede crearlo (queda prellenado con los datos del PDF).`);
        } else {
          setError("");
          if (inconsistentes.length) setInconsist({ grupos: inconsistentes });
        }
      }
    } catch (err) { setError("Error al procesar el PDF: " + err.message); }
    finally { setLoading(false); }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files[0]; if (file) pedirConsentimiento("PDF", file); };

  // ── Pedido con plantilla Excel ─────────────────────────────────────────
  // Misma lógica del PDF: grilla, lupas, EAN desde el maestro, celdas amarillas.
  // Cliente: si el NIT no existe → aviso + lupa + crear cliente (prellenado).
  //          si existe pero los datos difieren → aviso de información
  //          inconsistente: continuar con lo del Excel o validar con la lupa.
  const processExcel = async (file) => {
    if (!file || !/\.xlsx?$/i.test(file.name)) { setError("Solo se aceptan archivos Excel (.xlsx) con la plantilla del pedido."); return; }
    setCargandoExcel(true); setError(""); setPdfRows([]); setFileName(file.name); setRowErrors({});
    setModeloLeido(""); setOrigenCarga("EXCEL"); setNoMaestro(null); setInconsist(null); setPedidoHeader(null);
    llavePdfRef.current = null; setSolicitudYaGenerada(false);
    try {
      try { await cargarItemsEan(); } catch (e) { if (showToast) showToast("⚠ " + e.message + ". El EAN deberá digitarse."); }
      try { await cargarCiudades(); } catch { /* el departamento se digita */ }
      const { filas: leidas } = leerPlantillaPedido(await file.arrayBuffer());
      const filas = leidas.map(r => {
        const nit = resolverNit(BD_CLIENTES, r.destinatario) || r.destinatario;
        const m = BD_CLIENTES[nit] || {};
        const it = eanDeSku(r.material);
        return {
          ...r, destinatario: nit,
          // Lo que trae la plantilla manda; lo vacío se completa con el maestro
          nombre: r.nombre || m.nombre || "", direccion: r.direccion || m.direccion || "",
          telefono: r.telefono || m.telefono || "", lugar: r.lugar || m.ciudad || "",
          departamento: r.departamento || m.departamento || departamentoDeCiudad(r.lugar || m.ciudad),
          ean: it ? it.ean : "", um: "BUL", item: "1001", bodega: "021",
        };
      });
      setPdfRows(filas);
      setPedidoHeader({ origen: "EXCEL", archivo: file.name, lineas: filas.length });
      const { noEncontrados, inconsistentes } = compararConMaestro(filas, BD_CLIENTES);
      if (noEncontrados.length) {
        const n = {};
        noEncontrados.forEach(g => filas.forEach((r, i) => { if (r.entrega === g.entrega && r.destinatario === g.nit) n[`${i}-destinatario`] = true; }));
        setRowErrors(n);
        setNoMaestro({ items: noEncontrados });
        setError(`⚠ ${noEncontrados.length} cliente${noEncontrados.length > 1 ? "s" : ""} de la plantilla no se encontr${noEncontrados.length > 1 ? "aron" : "ó"} en el maestro de clientes. Búsquelo${noEncontrados.length > 1 ? "s" : ""} primero con la lupa 🔍; si no existe, desde la misma búsqueda puede crearlo.`);
      } else if (inconsistentes.length) setInconsist({ grupos: inconsistentes });
      if (showToast) showToast(`✓ Plantilla leída: ${filas.length} línea${filas.length !== 1 ? "s" : ""}`);
    } catch (err) { setError("No se pudo leer la plantilla: " + err.message); }
    finally { setCargandoExcel(false); if (excelInputRef.current) excelInputRef.current.value = ""; }
  };
  const handleDropExcel = (e) => { e.preventDefault(); setDragExcel(false); const file = e.dataTransfer.files[0]; if (file) pedirConsentimiento("EXCEL", file); };

  // Entregas de la plantilla con datos distintos al maestro que aún no se aceptaron
  const inconsistenciasPendientes = () => !["EXCEL", "PDF"].includes(origenCarga) ? []
    : compararConMaestro(pdfRows, BD_CLIENTES).inconsistentes.filter(g => !pdfRows[g.idx]?.inconsistenciaAceptada);
  const aceptarInconsistencias = () => {
    const grupos = inconsistenciasPendientes();
    const claves = new Set(grupos.map(g => `${g.entrega}¦${g.nit}`));
    setPdfRows(prev => prev.map(r => claves.has(`${r.entrega}¦${r.destinatario}`) ? { ...r, inconsistenciaAceptada: true } : r));
    setRowErrors(prev => { const n = { ...prev }; pdfRows.forEach((r, i) => { if (claves.has(`${r.entrega}¦${r.destinatario}`)) delete n[`${i}-nombre`]; }); return n; });
    // Queda constancia en la solicitud (datos de origen) de que se radicó con información inconsistente
    setPedidoHeader(h => ({ ...(h || {}), inconsistenciasAceptadas: [...((h && h.inconsistenciasAceptadas) || []),
      ...grupos.map(g => ({ entrega: g.entrega, nit: g.nit, diferencias: g.diferencias }))] }));
    setInconsist(null);
    if (showToast) showToast("Se continuará con los datos del Excel (información inconsistente aceptada).");
  };
  const updatePdfRow = (idx, key, val) => setPdfRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  const marcar = (idx, key, on) => setRowErrors(prev => { const n = { ...prev }; if (on) n[`${idx}-${key}`] = true; else delete n[`${idx}-${key}`]; return n; });

  // Datos del destinatario: se aplican a todas las líneas de la MISMA entrega
  // (un PDF = un destinatario), para que NIT y nombre no queden desalineados.
  const aplicarDestinatario = (idx, datos, marcas = {}) => {
    const entrega = pdfRows[idx]?.entrega;
    const afectadas = pdfRows.map((r, i) => (i === idx || (entrega && r.entrega === entrega)) ? i : -1).filter(i => i >= 0);
    setPdfRows(prev => prev.map((r, i) => afectadas.includes(i) ? { ...r, ...datos } : r));
    setRowErrors(prev => {
      const n = { ...prev };
      afectadas.forEach(i => ["destinatario", "nombre"].forEach(k => {
        if (marcas[k]) n[`${i}-${k}`] = true; else delete n[`${i}-${k}`];
      }));
      return n;
    });
  };
  const datosMaestro = (nit, m) => ({
    destinatario: nit, nombre: m.nombre, lugar: m.ciudad || "", direccion: m.direccion || "",
    departamento: m.departamento || departamentoDeCiudad(m.ciudad), ...(m.telefono ? { telefono: m.telefono } : {}),
  });

  // Al salir de la celda NIT: si existe en el maestro trae nombre, ciudad, dirección…;
  // si no existe, BORRA el nombre y lo sombrea en amarillo para corregir.
  const confirmarNit = (idx, valor) => {
    const nit = String(valor || "").trim();
    if (nit === valorAlEntrar.current) return;
    const m = nit ? BD_CLIENTES[nit] : null;
    if (m) aplicarDestinatario(idx, datosMaestro(nit, m));
    else {
      aplicarDestinatario(idx, { destinatario: nit, nombre: "" }, { nombre: true, destinatario: !nit });
      if (nit && showToast) showToast(`⚠ El NIT ${nit} no está en el maestro: se borró el nombre. Búsquelo con la lupa 🔍 o repórtelo al coordinador de L&S.`);
    }
  };
  // Al salir de la celda Nombre: debe existir EXACTO en el maestro; si no, borra el NIT.
  const confirmarNombre = (idx, valor) => {
    const nombre = String(valor || "").trim();
    if (nombre === valorAlEntrar.current) return;
    const m = buscarNombreExacto(nombre);
    if (m) aplicarDestinatario(idx, datosMaestro(m[0], m[1]));
    else {
      aplicarDestinatario(idx, { nombre, destinatario: "" }, { destinatario: true, nombre: !nombre });
      if (nombre && showToast) showToast(`⚠ "${nombre}" no está en el maestro: se borró el NIT. Use la lupa 🔍 para elegir el destinatario.`);
    }
  };
  // Ciudad: si cambia, el departamento se toma del maestro de ciudades
  // (solo si se conoce; si no, se deja el que estaba para digitarlo).
  const confirmarCiudad = (idx, valor) => {
    if (String(valor || "").trim() === valorAlEntrar.current) return;
    const dep = departamentoDeCiudad(valor);
    if (dep) updatePdfRow(idx, "departamento", dep);
  };
  // SKU: al cambiarlo se vuelve a buscar el EAN en el maestro Item/EAN
  const confirmarSku = (idx, valor) => {
    if (String(valor || "").trim() === valorAlEntrar.current) return;
    const it = eanDeSku(valor);
    updatePdfRow(idx, "ean", it ? it.ean : "");
  };

  // Campos obligatorios ("parametrizados"): si el PDF no los trae, se deben digitar
  // VARIOS, RAPPI y MP: TODOS los campos son obligatorios (incluye dirección, teléfono y departamento).
  // LUEGO PAGO y FARMATODO: los datos del cliente se llenan con la palabra del motivo.
  const OBLIGATORIOS = ["entrega", "destinatario", "nombre", "direccion", "telefono", "lugar", "departamento", "material", "ean", "cantidad", "um", "item", "bodega"];
  const faltaEn = (r, k) => OBLIGATORIOS.includes(k) && (k === "cantidad" ? !(parseFloat(r.cantidad) > 0) : !String(r[k] ?? "").trim());

  const exportPdfToExcel = async () => {
    if (pdfRows.length === 0 || enviandoPdf) return;
    // Motivo sin cliente: asegura que los campos del cliente lleven la palabra del motivo
    const filasRadicar = sinCliente ? pdfRows.map(r => llenarSinCliente(r, meta.proceso)) : pdfRows;
    if (solicitudYaGenerada) { if (showToast) showToast(`⚠ Solicitud ya radicada con: ${fileName}`); setPdfPopup(true); return; }
    const metaErrs = {};
    if (!meta.area.trim()) metaErrs["pdf-area"] = true;
    if (!meta.proceso) metaErrs["pdf-proceso"] = true;
    if (!meta.solicitante.trim()) metaErrs["pdf-solicitante"] = true;
    const correoTrimmed = meta.correo ? meta.correo.trim() : "";
    if (!correoTrimmed || !correoTrimmed.includes("@")) metaErrs["pdf-correo"] = true;
    const rErrs = {};
    filasRadicar.forEach((r, idx) => {
      OBLIGATORIOS.forEach(k => { if (faltaEn(r, k)) rErrs[`${idx}-${k}`] = true; });
      if (sinCliente) return;   // LUEGO PAGO / FARMATODO: no se valida el cliente contra el maestro
      const m = BD_CLIENTES[String(r.destinatario || "").trim()];
      // Plantilla Excel y PDF: el cliente debe existir en el maestro (o crearse con la lupa)
      if (["EXCEL", "PDF"].includes(origenCarga) && r.destinatario && !m) rErrs[`${idx}-destinatario`] = true;
      // NIT y nombre deben estar alineados con el maestro (salvo inconsistencia aceptada)
      if (m && !r.inconsistenciaAceptada && String(m.nombre).trim().toUpperCase() !== String(r.nombre || "").trim().toUpperCase()) rErrs[`${idx}-nombre`] = true;
    });
    // 28-oct: Excel y PDF → si hay clientes que no están en el maestro, NO se radica:
    // aviso para buscarlos o crearlos (el formulario se abre con los datos de la línea).
    if (!sinCliente && ["EXCEL", "PDF"].includes(origenCarga) && Object.keys(metaErrs).length === 0) {
      const { noEncontrados } = compararConMaestro(filasRadicar, BD_CLIENTES);
      if (noEncontrados.length) {
        setRowErrors(rErrs);
        setNoMaestro({ items: noEncontrados });
        if (showToast) showToast(`⚠ Debe crear o seleccionar ${noEncontrados.length > 1 ? `los ${noEncontrados.length} clientes` : "el cliente"} en el maestro antes de radicar.`);
        return;
      }
    }
    // Plantilla Excel o PDF con datos distintos al maestro sin decidir → mostrar el aviso
    const pendientesInc = sinCliente ? [] : inconsistenciasPendientes();
    if (pendientesInc.length && Object.keys(metaErrs).length === 0) {
      setInconsist({ grupos: pendientesInc });
      if (showToast) showToast("⚠ Hay información inconsistente con el maestro: decida si continúa con los datos del Excel o los valida con la lupa.");
      return;
    }
    if (Object.keys(metaErrs).length > 0 || Object.keys(rErrs).length > 0) {
      setRowErrors(rErrs);
      const msgs = [];
      if (metaErrs["pdf-area"]) msgs.push("Área solicitante (arriba)");
      if (metaErrs["pdf-proceso"]) msgs.push("Motivo (arriba)");
      if (metaErrs["pdf-solicitante"]) msgs.push("Solicitante");
      if (metaErrs["pdf-correo"]) msgs.push("Correo electrónico");
      const filasFaltantes = [...new Set(Object.keys(rErrs).map(k => `Fila ${parseInt(k)+1}`))];
      if (filasFaltantes.length > 0) msgs.push(`${filasFaltantes.join(", ")}: datos obligatorios vacíos o NIT/nombre no coinciden (celdas en amarillo)`);
      if (showToast) showToast("⚠ Completa: " + msgs.join(" · "));
      return;
    }
    setRowErrors({});
    // Constancia de la alerta de inventario: sin ella no se radica (Excel y PDF)
    if (["EXCEL", "PDF"].includes(origenCarga) && !consentimientoRef.current) {
      setConsent({ origen: origenCarga, soloRegistrar: true });
      return;
    }
    // ── 1) Radicar en la base de datos (transacción única). Si falla, NO se genera Excel.
    if (!llavePdfRef.current) llavePdfRef.current = nuevaLlave();
    setEnviandoPdf(true);
    let radicada;
    try {
      radicada = await radicarSolicitud({
        llave: llavePdfRef.current, meta, filas: filasRadicar, origen: origenCarga,
        pedidoHeader: consentimientoRef.current
          ? { ...(pedidoHeader || {}), consentimiento: { id: consentimientoRef.current.id, version: consentimientoRef.current.version, aceptado_at: consentimientoRef.current.aceptado_at } }
          : pedidoHeader,
        archivo: fileName || null,
      });
    } catch (ex) {
      if (showToast) showToast("⚠ " + ex.message);
      return;
    } finally {
      setEnviandoPdf(false);
    }
    // Enlaza la aceptación con la solicitud (si falla, la solicitud ya guarda la constancia en sus datos de origen)
    if (consentimientoRef.current) {
      try { await vincularConsentimiento(consentimientoRef.current.id, radicada.id); }
      catch (e) { if (showToast) showToast("⚠ Solicitud radicada, pero no se pudo enlazar la aceptación de inventario: " + e.message); }
    }
    // ── 2) Excel con el número oficial devuelto por la base
    const solicitudFinal = radicada.numero;
    const fechaFinal = fechaHoraBogota(radicada.radicadaAt);
    const metaFinal = { solicitud: solicitudFinal, fecha: fechaFinal, area: meta.area, proceso: meta.proceso, solicitante: meta.solicitante, esReintento: radicada.esReintento };
    setPdfMeta(metaFinal);
    // Adjuntos (.zip, imágenes, QR): si fallan, la solicitud igual queda radicada
    if (adjuntos.length && !adjSubidos) {
      const { subidos, errores } = await subirAdjuntos(radicada.id, adjuntos);
      if (subidos) setAdjSubidos(true);
      if (showToast) showToast(errores.length ? `⚠ Adjuntos: ${subidos} de ${adjuntos.length} cargados. ${errores.join(" · ")}` : `📎 ${subidos} adjunto${subidos !== 1 ? "s" : ""} cargado${subidos !== 1 ? "s" : ""}`);
    }
    if (onRadicada) onRadicada();   // refresca la tabla de solicitudes del día

    // ── Un solo Excel con el formato de la plantilla (con lo guardado en la base)
    await descargarDespacho({ id: radicada.id, numero: solicitudFinal, area: meta.area, solicitante: meta.solicitante,
      correo: meta.correo, radicadaAt: radicada.radicadaAt, filasLocales: filasRadicar });

    setSolicitudYaGenerada(true); setPdfPopup(true);
  };

  const resetPdf = () => { consentimientoRef.current = null; llavePdfRef.current = null; setPdfRows([]); setFileName(""); setError(""); setRowErrors({}); setPdfPopup(false); setSolicitudYaGenerada(false); setPedidoHeader(null); setModeloLeido(""); setNoMaestro(null); setInconsist(null); setOrigenCarga("PDF"); setAdjuntos([]); setAdjSubidos(false); if (pdfInputRef.current) pdfInputRef.current.value = ""; if (excelInputRef.current) excelInputRef.current.value = ""; };

  // Columnas de la grilla (mismo orden de la plantilla). lupa: abre el buscador del maestro.
  const PREVIEW_COLS = [
    { key:"entrega",      label:"Entrega",       w:"120px" },
    { key:"destinatario", label:"NIT",           w:"118px", lupa:"destinatario" },
    { key:"nombre",       label:"Nombre dest.",  w:"210px", lupa:"destinatario" },
    { key:"direccion",    label:"Dirección",     w:"170px" },
    { key:"lugar",        label:"Ciudad",        w:"110px" },
    { key:"departamento", label:"Departamento",  w:"110px" },
    { key:"telefono",     label:"Teléfono",      w:"110px" },
    { key:"material",     label:"SKU",           w:"128px", lupa:"item" },
    { key:"ean",          label:"EAN",           w:"138px", lupa:"item" },
    { key:"cantidad",     label:"Cantidad",      w:"78px", numeric:true },
    { key:"um",           label:"UM",            w:"56px" },
    { key:"item",         label:"Ítem",          w:"62px" },
    { key:"bodega",       label:"Bodega",        w:"64px" },
    { key:"observaciones", label:"Observaciones", w:"220px", libre:true },
  ];
  const totalPendientes = pdfRows.reduce((a, r, i) => a + PREVIEW_COLS.filter(c => faltaEn(r, c.key) || rowErrors[`${i}-${c.key}`]).length, 0);

  const elegirDeLupa = (fila) => {
    if (!lupa) return;
    if (lupa.tipo === "destinatario") {
      const m = BD_CLIENTES[String(fila.nit).trim()] || fila;
      aplicarDestinatario(lupa.idx, datosMaestro(String(fila.nit).trim(), { ...fila, ...m, nombre: m.nombre || fila.nombre }));
      // El destinatario ya quedó asignado: se quita el aviso de "no encontrado"
      setError(prev => (prev.startsWith("⚠") && prev.includes("maestro de clientes") ? "" : prev));
    } else {
      updatePdfRow(lupa.idx, "material", fila.item);
      updatePdfRow(lupa.idx, "ean", fila.ean);
      marcar(lupa.idx, "material", false); marcar(lupa.idx, "ean", false);
    }
  };


  return (
    <div style={{ background:"#fff", borderRadius:14, border:"1.5px solid #F59E0B", boxShadow:"0 0 0 3px rgba(245,158,11,0.12)", overflow:"hidden", marginTop:20 }}>
      {/* Encabezado resaltado: siempre visible aunque la sección esté oculta */}
      <div onClick={alternar} title={abierto ? "Ocultar Carga de pedidos" : "Mostrar Carga de pedidos"}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"10px 16px", background:"#FFFBEB", borderBottom: abierto ? "1px solid #FCD9A0" : "none", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:"#F59E0B", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M4 2h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/><path d="M10 2v4h4" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#92400E" }}>Carga de pedidos</div>
            {!isMobileLocal && <div style={{ fontSize:11, color:"#B45309" }}>Cargue el pedido con la plantilla Excel o desde el PDF y radique la solicitud sin digitar las líneas</div>}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          {pdfRows.length > 0 && <span style={{ fontSize:12, color:"#92400E", background:"#FDE68A", padding:"3px 10px", borderRadius:20, fontWeight:600 }}>{pdfRows.length} línea{pdfRows.length !== 1 ? "s" : ""}</span>}
          <button type="button" onClick={(e) => { e.stopPropagation(); alternar(); }} aria-expanded={abierto}
            style={{ display:"flex", alignItems:"center", gap:6, height:32, padding:"0 12px", fontSize:12, fontWeight:700, border:"1px solid #F59E0B", borderRadius:8, background: abierto ? "#fff" : "#F59E0B", color: abierto ? "#B45309" : "#fff", cursor:"pointer", whiteSpace:"nowrap" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: abierto ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {abierto ? "Ocultar" : "Mostrar"}
          </button>
        </div>
      </div>
      <div style={{ padding: isMobileLocal ? "14px 12px" : "16px 20px", display: abierto ? "block" : "none" }}>
        <div style={{ display:"grid", gridTemplateColumns: isMobileLocal ? "1fr" : "1fr 1fr", gap:16, marginBottom:14 }}>
          {/* Pedido con plantilla Excel */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#1a2e27" }}>📊 Pedido con plantilla Excel</div>
              <a href={URL_PLANTILLA} download="Plantilla_Pedido.xlsx" onClick={e => e.stopPropagation()}
                style={{ display:"inline-flex", alignItems:"center", gap:6, height:30, padding:"0 12px", fontSize:12, fontWeight:600, border:"1px solid #C5DDD4", borderRadius:8, background:"#fff", color:"#0F6E56", textDecoration:"none", whiteSpace:"nowrap" }}>⬇ Descargar plantilla</a>
            </div>
            <div onDragOver={(e) => { e.preventDefault(); setDragExcel(true); }} onDragLeave={() => setDragExcel(false)} onDrop={handleDropExcel} onClick={() => pedirConsentimiento("EXCEL")}
              style={{ flex:1, border:`1.5px dashed ${dragExcel ? "#0F6E56" : "#C5DDD4"}`, borderRadius:10, padding:"20px 16px", textAlign:"center", background: dragExcel ? "#F0FBF6" : "#F7FCF9", cursor:"pointer", transition:"border-color 0.2s, background 0.2s" }}>
              <input ref={excelInputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display:"none" }} onClick={e => e.stopPropagation()} onChange={(e) => alElegirArchivo("EXCEL", e)} />
              <div style={{ width:36, height:36, background:"#E1F5EE", borderRadius:8, margin:"0 auto 10px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="2.5" width="13" height="13" rx="1.5" stroke="#0F6E56" strokeWidth="1.3"/><path d="M2.5 7h13M2.5 11h13M7 2.5v13" stroke="#0F6E56" strokeWidth="1.2"/></svg>
              </div>
              {cargandoExcel ? <div style={{ fontSize:13, color:"#0F6E56", fontWeight:500 }}>Leyendo la plantilla y buscando en el maestro…</div>
                : origenCarga === "EXCEL" && fileName && pdfRows.length > 0 ? (<><div style={{ fontSize:13, fontWeight:600, color:"#1a2e27", marginBottom:2 }}>{fileName}</div><div style={{ fontSize:11, color:"#6B8F80" }}>{pdfRows.length} líneas cargadas · haga clic para cambiar</div></>)
                : (<><div style={{ fontSize:13, fontWeight:500, color:"#1a2e27", marginBottom:4 }}>Arrastre aquí la plantilla diligenciada</div><div style={{ fontSize:11, color:"#6B8F80", marginBottom:12 }}>Plantilla_Pedido.xlsx · valida el cliente con el maestro · arma las líneas</div><div style={{ display:"inline-block", padding:"7px 18px", background:"#0F6E56", color:"#fff", borderRadius:8, fontSize:12, fontWeight:500 }}>Seleccionar Excel</div></>)}
            </div>
          </div>
          {/* Pedido desde PDF */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", height:30 }}><div style={{ fontSize:12, fontWeight:700, color:"#1a2e27" }}>📄 Pedido desde PDF</div></div>
            <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => pedirConsentimiento("PDF")}
              style={{ border:`1.5px dashed ${dragOver ? "#0F6E56" : "#C5DDD4"}`, borderRadius:10, padding:"20px 16px", textAlign:"center", background: dragOver ? "#F0FBF6" : "#F7FCF9", cursor:"pointer", height:"100%", boxSizing:"border-box", transition:"border-color 0.2s, background 0.2s" }}>
              <input ref={pdfInputRef} type="file" accept="application/pdf" style={{ display:"none" }} onClick={e => e.stopPropagation()} onChange={(e) => alElegirArchivo("PDF", e)} />
              <div style={{ width:36, height:36, background:"#E1F5EE", borderRadius:8, margin:"0 auto 10px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/><path d="M10 3v5h5" stroke="#0F6E56" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6 10h6M6 13h4" stroke="#0F6E56" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </div>
              {loading ? <div style={{ fontSize:13, color:"#0F6E56", fontWeight:500 }}>Leyendo PDF y buscando en BD…</div>
                : origenCarga === "PDF" && fileName && pdfRows.length > 0 ? (<><div style={{ fontSize:13, fontWeight:600, color:"#1a2e27", marginBottom:2 }}>{fileName}</div><div style={{ fontSize:11, color:"#6B8F80" }}>{pdfRows.length} líneas generadas · haz clic para cambiar</div>{modeloLeido === NOMBRE_MODELO_NOVIEMBRE_2026 && <div title="El modelo original no leyó todos los datos: se completaron con la lectura del formato nuevo" style={{ display:"inline-block", marginTop:6, fontSize:11, fontWeight:600, color:"#1D4ED8", background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:20, padding:"2px 10px" }}>Leído con modelo_noviembre_2026</div>}</>)
                : (<><div style={{ fontSize:13, fontWeight:500, color:"#1a2e27", marginBottom:4 }}>Arrastre aquí el PDF del pedido</div><div style={{ fontSize:11, color:"#6B8F80", marginBottom:12 }}>Lee el PDF · busca el cliente en el maestro · arma las líneas</div><div style={{ display:"inline-block", padding:"7px 18px", background:"#0F6E56", color:"#fff", borderRadius:8, fontSize:12, fontWeight:500 }}>Seleccionar PDF</div></>)}
            </div>
          </div>
        </div>
        {/* Adjuntos del pedido: aplican al pedido cargado por Excel o por PDF */}
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); agregarAdjuntos(e.dataTransfer.files); }}
          style={{ border:"1px solid #E2EDE9", borderRadius:10, padding:"10px 14px", marginBottom:14, background:"#FBFDFC" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#1a2e27" }}>📎 Adjuntos del pedido <span style={{ fontWeight:400, color:"#6B8F80" }}>(opcional · Excel o PDF)</span></div>
              <div style={{ fontSize:11, color:"#6B8F80" }}>Archivos .zip, imágenes y QR · {(paramAdj.adjuntos_tipos || []).join(", ")} · máximo {paramAdj.adjuntos_max_archivos} archivos de {paramAdj.adjuntos_max_mb} MB · se guardan con la solicitud al radicar (se conservan {paramAdj.adjuntos_retencion_meses} mes en la aplicación)</div>
            </div>
            <input ref={adjInputRef} type="file" multiple accept={(paramAdj.adjuntos_tipos || []).map(t => "." + t).join(",")} style={{ display:"none" }} onChange={e => agregarAdjuntos(e.target.files)} />
            <button type="button" onClick={() => adjInputRef.current?.click()} disabled={solicitudYaGenerada}
              style={{ height:32, padding:"0 14px", fontSize:12, fontWeight:600, border:"1px solid #C5DDD4", borderRadius:8, background:"#fff", color:"#0F6E56", cursor:"pointer", whiteSpace:"nowrap" }}>+ Agregar adjuntos</button>
          </div>
          {adjuntos.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
              {adjuntos.map((f, i) => (
                <span key={`${f.name}-${i}`} style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11.5, color:"#1a2e27", background:"#EAF7F1", border:"1px solid #C5DDD4", borderRadius:20, padding:"3px 6px 3px 10px" }}>
                  {f.name} <span style={{ color:"#6B8F80" }}>{tamanoLegible(f.size)}</span>
                  {!adjSubidos && <button type="button" onClick={() => setAdjuntos(prev => prev.filter((_, k) => k !== i))} aria-label={`Quitar ${f.name}`}
                    style={{ width:18, height:18, border:"none", borderRadius:9, background:"#fff", color:"#C0392B", cursor:"pointer", fontSize:12, lineHeight:"18px", padding:0 }}>×</button>}
                  {adjSubidos && <span style={{ color:"#0F6E56" }}>✓</span>}
                </span>))}
            </div>
          )}
        </div>
        {error && <div style={{ background: error.startsWith("⚠") ? "#FFFBEB" : "#FFF5F5", border: `1px solid ${error.startsWith("⚠") ? "#F6D860" : "#F5A0A0"}`, borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color: error.startsWith("⚠") ? "#92600A" : "#C0392B", lineHeight:1.5 }}>{error}</div>}
        {pdfRows.length > 0 && (
          <>
            {sinCliente && (
              <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:10, padding:"8px 12px", marginBottom:10, fontSize:12, color:"#1E3A8A" }}>
                Motivo <b>{etiquetaMotivo(meta.proceso)}</b>: no se exigen datos del cliente. NIT, nombre, dirección, teléfono, ciudad y departamento se llenan con «{meta.proceso}».
              </div>
            )}
            {!sinCliente && origenCarga === "EXCEL" && !inconsist && inconsistenciasPendientes().length > 0 && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, background:"#FFF7ED", border:"1px solid #FDBA74", borderRadius:10, padding:"8px 12px", marginBottom:10, fontSize:12, color:"#9A3412" }}>
                <span><b>{inconsistenciasPendientes().length} entrega{inconsistenciasPendientes().length !== 1 ? "s" : ""} con información inconsistente</b> con el maestro de clientes. Decida antes de radicar.</span>
                <button onClick={() => setInconsist({ grupos: inconsistenciasPendientes() })} style={{ height:30, padding:"0 12px", borderRadius:8, background:"#EA580C", color:"#fff", border:"none", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>Revisar</button>
              </div>
            )}
            {totalPendientes > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:8, background:"#FFF7D6", border:"1px solid #F2C94C", borderRadius:10, padding:"8px 12px", marginBottom:10, fontSize:12, color:"#7A5A00" }}>
                <span style={{ width:14, height:14, borderRadius:4, background:"#FFE58A", border:"1px solid #E5B935", flexShrink:0 }} />
                <span><b>{totalPendientes} dato{totalPendientes !== 1 ? "s" : ""} por digitar o corregir</b> (celdas en amarillo). Son obligatorios para radicar. Use la lupa 🔍 para buscar en los maestros.</span>
              </div>
            )}
            <div style={{ overflow:"auto", maxHeight:"62vh", marginBottom:14, borderRadius:8, border:"1px solid #E2EDE9" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1820, fontSize:12 }}>
                <thead style={{ position:"sticky", top:0, zIndex:2 }}><tr style={{ background:"#F2F8F5" }}>
                  <th style={{ width:32, padding:"8px 6px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:"center", borderBottom:"1px solid #E2EDE9" }}>#</th>
                  {PREVIEW_COLS.map(c => <th key={c.key} style={{ width:c.w, padding:"8px 8px", fontSize:11, color:"#6B8F80", fontWeight:500, textAlign:c.numeric?"right":"left", borderBottom:"1px solid #E2EDE9", whiteSpace:"nowrap" }}>
                    {c.label}{OBLIGATORIOS.includes(c.key) && <span style={{ color:"#C0392B" }}> *</span>}
                  </th>)}
                </tr></thead>
                <tbody>{pdfRows.map((r, idx) => (
                  <tr key={idx} style={{ borderBottom:"1px solid #F0F7F4" }}>
                    <td style={{ textAlign:"center", fontSize:11, color:"#9CB8AE", padding:"3px 4px" }}>{idx+1}</td>
                    {PREVIEW_COLS.map(c => {
                      const amarillo = faltaEn(r, c.key) || rowErrors[`${idx}-${c.key}`];
                      const fondo = amarillo ? "#FFF3BF" : "transparent";
                      const borde = amarillo ? "1px solid #E5B935" : "1px solid transparent";
                      return (
                      <td key={c.key} style={{ padding:"3px" }}>
                        <div style={{ position:"relative" }}>
                          <input type={c.numeric ? "number" : "text"} value={r[c.key] ?? ""} title={amarillo ? "Dato obligatorio: digítelo o búsquelo con la lupa" : ""}
                            onChange={e => updatePdfRow(idx, c.key, c.key === "cantidad" || c.libre ? e.target.value : e.target.value.toUpperCase())}
                            style={{ width:"100%", height:30, padding: c.lupa ? "0 26px 0 7px" : "0 7px", fontSize:12, border: borde, borderRadius:6, background: fondo, color:"#1a2e27", outline:"none", textAlign:c.numeric?"right":"left", boxSizing:"border-box" }}
                            onFocus={e => { valorAlEntrar.current = String(r[c.key] ?? "").trim(); e.target.style.background = amarillo ? "#FFF3BF" : "#F2F8F5"; e.target.style.border = "1px solid #0F6E56"; }}
                            onBlur={e => {
                              e.target.style.background = fondo; e.target.style.border = borde;
                              if (c.key === "destinatario") confirmarNit(idx, e.target.value);
                              else if (c.key === "nombre") confirmarNombre(idx, e.target.value);
                              else if (c.key === "material") confirmarSku(idx, e.target.value);
                              else if (c.key === "lugar") { confirmarCiudad(idx, e.target.value); if (rowErrors[`${idx}-lugar`] && String(e.target.value).trim()) marcar(idx, "lugar", false); }
                              else if (rowErrors[`${idx}-${c.key}`] && String(e.target.value).trim()) marcar(idx, c.key, false);
                            }}
                          />
                          {c.lupa && (
                            <button type="button" title={c.lupa === "item" ? "Buscar en el maestro Item / EAN" : "Buscar en el maestro de destinatarios"}
                              onClick={() => setLupa({ tipo: c.lupa, idx, inicial: c.lupa === "item"
                                ? (c.key === "ean" ? { ean: r.ean } : { item: (r.material || "").replace(/\s+/g, "").replace(/-(19|20)\d{2}$/, "") })
                                : (c.key === "destinatario" ? { nit: r.destinatario } : { nombre: r.nombre }) })}
                              style={{ position:"absolute", right:3, top:4, width:22, height:22, border:"none", borderRadius:5, background:"transparent", cursor:"pointer", fontSize:12, lineHeight:"22px", padding:0 }}>🔍</button>
                          )}
                        </div>
                      </td>); })}
                  </tr>))}</tbody>
              </table>
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <button onClick={resetPdf} style={{ padding:"8px 16px", fontSize:13, border:"1px solid #E2EDE9", borderRadius:9, background:"#fff", color:"#6B8F80", cursor:"pointer" }} onMouseEnter={e => { e.currentTarget.style.background="#FFF0EE"; e.currentTarget.style.color="#C0392B"; e.currentTarget.style.borderColor="#F5C6C0"; }} onMouseLeave={e => { e.currentTarget.style.background="#fff"; e.currentTarget.style.color="#6B8F80"; e.currentTarget.style.borderColor="#E2EDE9"; }}>Limpiar</button>
              <button onClick={exportPdfToExcel} disabled={enviandoPdf} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 22px", fontSize:13, fontWeight:600, border:"none", borderRadius:9, background:enviandoPdf?"#6FA895":"#0F6E56", color:"#fff", cursor:enviandoPdf?"wait":"pointer" }} onMouseEnter={e => { if (!enviandoPdf) e.currentTarget.style.background="#085041"; }} onMouseLeave={e => { if (!enviandoPdf) e.currentTarget.style.background="#0F6E56"; }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {enviandoPdf ? "Radicando…" : solicitudYaGenerada ? "Ver solicitud" : "Radicar y descargar Excel"}
              </button>
            </div>
          </>
        )}
      </div>
      {consent && <ConsentimientoPopup origen={consent.origen} trabajando={registrandoConsent} onAceptar={aceptarConsentimiento} onCancelar={() => !registrandoConsent && setConsent(null)} />}
      {lupa && <BuscadorMaestro tipo={lupa.tipo} inicial={lupa.inicial} datosCrear={lupa.datosCrear} onElegir={elegirDeLupa} onCerrar={() => setLupa(null)} />}
      {noMaestro && !sinCliente && (
        <div style={{ position:"fixed", inset:0, zIndex:2500, background:"rgba(10,30,24,0.55)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:540, maxHeight:"88vh", overflow:"auto", boxShadow:"0 28px 70px rgba(0,0,0,0.22)" }}>
            <div style={{ background:"#FFFBEB", borderBottom:"1px solid #FCD9A0", padding:"16px 22px", display:"flex", gap:12, alignItems:"center" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:"#F59E0B", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:700, flexShrink:0 }}>!</div>
              <div style={{ fontSize:15, fontWeight:700, color:"#92400E" }}>{noMaestro.items.length > 1 ? `${noMaestro.items.length} clientes no encontrados en el maestro` : "Cliente no encontrado en el maestro"}</div>
            </div>
            <div style={{ padding:"16px 22px", fontSize:13, color:"#44574F", lineHeight:1.55 }}>
              <ol style={{ margin:"0 0 12px", paddingLeft:18 }}>
                <li><b>Primero búsquelo</b> con la lupa: se muestran también los nombres <b>parecidos</b> (tildes, S.A.S, errores de digitación).</li>
                <li>Si aparece, <b>selecciónelo</b>. Si hay varios parecidos, elija el correcto.</li>
                <li>Solo si no existe, use <b>«Crear cliente nuevo»</b> en la misma búsqueda (quedará prellenado con los datos {origenCarga === "PDF" ? "del PDF" : "de la plantilla"} que se hayan digitado). <b>Sin el cliente en el maestro no se puede radicar.</b> Quedará pendiente de revisión por el supervisor.</li>
              </ol>
              {noMaestro.items.map(it => (
                <div key={it.idx} style={{ display:"flex", alignItems:"center", gap:10, background:"#F7F9F8", border:"1px solid #E2EDE9", borderRadius:8, padding:"8px 12px", marginBottom:6 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, color:"#1a2e27", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.nombre || "(sin nombre)"}</div>
                    <div style={{ fontSize:11, color:"#6B8F80" }}>{[it.entrega && `Entrega ${it.entrega}`, it.nit && `NIT ${it.nit}`].filter(Boolean).join(" · ") || "El PDF no trae el NIT"}</div>
                  </div>
                  <button onClick={() => { setLupa({ tipo: "destinatario", idx: it.idx, inicial: { nombre: it.nombre }, datosCrear: it.datos });
                      setNoMaestro(prev => { const resto = prev.items.filter(x => x.idx !== it.idx); return resto.length ? { items: resto } : null; }); }}
                    style={{ height:34, padding:"0 14px", borderRadius:8, background:"#0F6E56", color:"#fff", border:"none", fontSize:12.5, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>🔍 Buscar cliente</button>
                </div>
              ))}
            </div>
            <div style={{ padding:"0 22px 18px", textAlign:"right" }}>
              <button onClick={() => setNoMaestro(null)} style={{ height:38, padding:"0 18px", borderRadius:10, background:"#fff", color:"#6B8F80", border:"1px solid #E2EDE9", fontSize:13, fontWeight:600, cursor:"pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Información inconsistente: datos de la plantilla distintos al maestro ── */}
      {inconsist && !noMaestro && !sinCliente && (
        <div style={{ position:"fixed", inset:0, zIndex:2500, background:"rgba(10,30,24,0.55)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:720, maxHeight:"88vh", overflow:"auto", boxShadow:"0 28px 70px rgba(0,0,0,0.22)" }}>
            <div style={{ background:"#FFF7ED", borderBottom:"1px solid #FDBA74", padding:"16px 22px", display:"flex", gap:12, alignItems:"center" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:"#EA580C", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:700, flexShrink:0 }}>≠</div>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:"#9A3412" }}>Información inconsistente con el maestro de clientes</div>
                <div style={{ fontSize:12, color:"#9A3412" }}>El NIT existe, pero la plantilla trae datos distintos a los registrados.</div>
              </div>
            </div>
            <div style={{ padding:"14px 22px" }}>
              {inconsist.grupos.map(g => (
                <div key={`${g.entrega}-${g.nit}`} style={{ border:"1px solid #E2EDE9", borderRadius:10, marginBottom:10, overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"8px 12px", background:"#F7FCF9", borderBottom:"1px solid #E2EDE9" }}>
                    <span style={{ fontSize:12.5, color:"#1a2e27" }}><b>Entrega {g.entrega}</b> · NIT {g.nit}</span>
                    <button onClick={() => { setLupa({ tipo: "destinatario", idx: g.idx, inicial: { nit: g.nit } }); setInconsist(null); }}
                      style={{ height:30, padding:"0 12px", borderRadius:8, background:"#fff", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:12, fontWeight:600, cursor:"pointer" }}>🔍 Validar con lupa</button>
                  </div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead><tr style={{ color:"#6B8F80" }}>{["Campo", "Dato del Excel", "Dato en la base"].map(h => <th key={h} style={{ textAlign:"left", padding:"6px 12px", fontWeight:600, fontSize:11 }}>{h}</th>)}</tr></thead>
                    <tbody>{g.diferencias.map(d => (
                      <tr key={d.campo} style={{ borderTop:"1px solid #F0F5F3" }}>
                        <td style={{ padding:"6px 12px", fontWeight:600, color:"#44574F" }}>{d.campo}</td>
                        <td style={{ padding:"6px 12px", color:"#C2410C" }}>{d.excel}</td>
                        <td style={{ padding:"6px 12px", color:"#0F6E56" }}>{d.base}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              ))}
              <div style={{ fontSize:12, color:"#44574F", lineHeight:1.5 }}>
                <b>Validar con lupa</b>: elige el cliente correcto y se usan los datos de la base.
                <b> Continuar</b>: la solicitud se radica con los datos del Excel tal como vienen (queda registrado como información inconsistente).
              </div>
            </div>
            <div style={{ padding:"0 22px 18px", display:"flex", justifyContent:"flex-end", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => setInconsist(null)} style={{ height:40, padding:"0 16px", borderRadius:10, background:"#fff", color:"#6B8F80", border:"1px solid #E2EDE9", fontSize:13, fontWeight:600, cursor:"pointer" }}>Decidir después</button>
              <button onClick={aceptarInconsistencias} style={{ height:40, padding:"0 18px", borderRadius:10, background:"#EA580C", color:"#fff", border:"none", fontSize:13, fontWeight:600, cursor:"pointer" }}>Continuar con los datos del Excel</button>
            </div>
          </div>
        </div>
      )}
      {pdfPopup && (
        <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(10,30,24,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:"16px", backdropFilter:"blur(3px)" }}>
          <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:440, overflow:"hidden", boxShadow:"0 28px 70px rgba(0,0,0,0.22)", animation:"popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ background:"#0F6E56", padding:"22px 28px 20px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10, textAlign:"right" }}>Logistics and Services</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", lineHeight:1.5, marginBottom:6 }}>{pdfMeta.esReintento ? "Esta solicitud ya estaba radicada" : origenCarga === "EXCEL" ? "Solicitud radicada desde la plantilla Excel" : "Solicitud radicada desde PDF"}</div>
              <div style={{ display:"inline-block", background:"rgba(255,255,255,0.15)", borderRadius:8, padding:"6px 18px" }}>
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginRight:6 }}>N°</span>
                <span style={{ fontSize:18, color:"#fff", fontWeight:700, letterSpacing:"0.04em" }}>{pdfMeta.solicitud}</span>
              </div>
            </div>
            <div style={{ padding:"20px 28px 6px" }}>
              {[{ label:"Área · Motivo", value: [pdfMeta.area, etiquetaMotivo(pdfMeta.proceso)].filter(Boolean).join(" · ")||"—" }, { label:"Fecha", value: pdfMeta.fecha }, { label:"N° Solicitud", value: pdfMeta.solicitud }, { label:"Solicitante", value: pdfMeta.solicitante||"—" }].map(({ label, value }) => (
                <div key={label} style={{ textAlign:"center", padding:"10px 0", borderBottom:"1px solid #F0F7F4" }}>
                  <div style={{ fontSize:10, color:"#9CB8AE", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:14, color:"#1a2e27", fontWeight:600 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:"16px 28px 22px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#9CB8AE", marginBottom:14 }}>Se descargó el Excel del pedido (formato de la plantilla)</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={resetPdf} style={{ flex:1, height:44, borderRadius:10, background:"#F2F8F5", color:"#0F6E56", border:"1px solid #C5DDD4", fontSize:13, fontWeight:600, cursor:"pointer" }} onMouseEnter={e => e.currentTarget.style.background="#E1F5EE"} onMouseLeave={e => e.currentTarget.style.background="#F2F8F5"}>Nuevo pedido</button>
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
  const auth = useAuth();
  // Solicitante y correo: siempre los del usuario que inició sesión (no se editan)
  const correoSesion = auth?.perfil?.email || auth?.session?.user?.email || auth?.user?.email || "";
  const metaInicial = () => ({
    area: areaDeLista(auth?.perfil?.area), proceso: "", fecha: generateFecha(), solicitud: "",
    solicitante: up(String(auth?.perfil?.nombre || "").trim() || correoSesion), correo: correoSesion,
  });
  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [solicitudFinalizada, setSolicitudFinalizada] = useState(false);
  const [meta, setMeta] = useState(metaInicial);
  const [enviando, setEnviando] = useState(false);
  const llaveRef = useRef(null);   // llave de idempotencia de la solicitud en curso
  const [errors, setErrors] = useState({});
  const [popup, setPopup] = useState(false);
  const [recarga, setRecarga] = useState(0);   // +1 cada vez que se radica → refresca la tabla del día
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
  const clearAll = () => { llaveRef.current = null; setRows([EMPTY_ROW()]); setMeta(metaInicial()); setErrors({}); setSolicitudFinalizada(false); };
  const newRequest = () => { llaveRef.current = null; setRows([EMPTY_ROW()]); setMeta(metaInicial()); setErrors({}); setPopup(false); setSolicitudFinalizada(false); };

  const exportExcel = useCallback(async () => {
    if (enviando) return;
    const metaValidation = {};
    if (!meta.area.trim()) metaValidation["meta-area"] = true;
    if (!meta.proceso) metaValidation["meta-proceso"] = true;
    if (!meta.solicitante.trim()) metaValidation["meta-solicitante"] = true;
    const correoTrimmed = meta.correo ? meta.correo.trim() : "";
    if (!correoTrimmed || !correoTrimmed.includes("@")) metaValidation["meta-correo"] = true;
    if (Object.keys(metaValidation).length > 0) {
      setErrors(prev => ({ ...prev, ...metaValidation }));
      const missingMeta = [];
      if (metaValidation["meta-area"]) missingMeta.push("Área solicitante");
      if (metaValidation["meta-proceso"]) missingMeta.push("Motivo");
      if (metaValidation["meta-solicitante"]) missingMeta.push("Solicitante");
      if (metaValidation["meta-correo"]) missingMeta.push("Correo electrónico");
      showToast(`⚠ Completa los campos del encabezado: ${missingMeta.join(", ")}`);
      return;
    }
    // LUEGO PAGO / FARMATODO: los campos del cliente llevan la palabra del motivo
    const syncedRows = MOTIVOS_SIN_CLIENTE.includes(meta.proceso)
      ? rows.map(r => ({ ...r, destinatario: meta.proceso, nombre: meta.proceso, lugar: meta.proceso, direccion: meta.proceso, telefono: meta.proceso, departamento: meta.proceso }))
      : syncAllClientes(rows);
    setRows(syncedRows);
    const allErrors = {};
    syncedRows.forEach(r => Object.assign(allErrors, validateRowPure(r, syncedRows)));
    if (Object.keys(allErrors).length > 0) { setErrors(allErrors); showToast("⚠ Hay campos requeridos incompletos o registros duplicados"); return; }
    setErrors({});
    // ── 1) Radicar en la base (una transacción). Ya radicada → solo re-descarga el Excel.
    let metaFinal = meta;
    if (!solicitudFinalizada) {
      if (!llaveRef.current) llaveRef.current = nuevaLlave();
      setEnviando(true);
      try {
        const r = await radicarSolicitud({ llave: llaveRef.current, meta, filas: syncedRows, origen: "MANUAL" });
        metaFinal = { ...meta, id: r.id, radicadaAt: r.radicadaAt, solicitud: r.numero, fecha: fechaHoraBogota(r.radicadaAt), esReintento: r.esReintento };
        setRecarga(n => n + 1);
      } catch (ex) {
        showToast("⚠ " + ex.message);
        return;
      } finally {
        setEnviando(false);
      }
    }
    const solicitudFinal = metaFinal.solicitud;
    setMeta(metaFinal);
    setSolicitudFinalizada(true);
    // despacho_, CARGA A WMS_ y CARGA LIBRO 1_ (con lo guardado en la base: EAN, dirección…)
    await descargarDespacho({ id: metaFinal.id, numero: solicitudFinal, area: metaFinal.area, solicitante: metaFinal.solicitante,
      correo: metaFinal.correo, radicadaAt: metaFinal.radicadaAt, filasLocales: syncedRows });
    setPopup(true);
  }, [rows, meta, enviando, solicitudFinalizada]);

  const filledRows = rows.filter(r => r.entrega || r.material || r.destinatario).length;

  const inputBase = { width:"100%", height:38, padding:"0 10px", fontSize:14, border:"1px solid #D4E5DE", borderRadius:8, background:"#fff", color:"#1a2e27", outline:"none", boxSizing:"border-box", WebkitAppearance:"none" };
  const inputReadonly = { ...inputBase, background:"#F2F8F5", color:"#5A7A6E", border:"1px solid #E2EDE9", cursor:"default", fontWeight:500 };

  return (
    <div style={{ paddingBottom:60 }}>
      {/* Contador de líneas (el Manual ahora está en la barra de menú) */}
      {filledRows > 0 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", marginBottom:12 }}>
          <span style={{ fontSize:12, color:"#0F6E56", background:"#E1F5EE", padding:"4px 10px", borderRadius:20, fontWeight:500 }}>
            {filledRows} línea{filledRows!==1?"s":""}
          </span>
        </div>
      )}

      {/* Meta */}
      <div style={{ background:"#fff", borderRadius:14, border:"1px solid #E2EDE9", padding:isMobile?"14px":"18px 22px", marginBottom:16 }}>
        <div style={{ fontSize:10, fontWeight:600, color:"#6B8F80", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>Información del envío</div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1.15fr 1fr 1.2fr 1fr 1.85fr 1.85fr", gap:12 }}>
          {[["area", "Área solicitante", AREAS, "meta-area"], ["proceso", "Motivo", MOTIVOS, "meta-proceso"]].map(([k, titulo, opciones, err]) => (
            <div key={k}>
              <label style={{ fontSize:12, color:errors[err]?"#C0392B":"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>{titulo} *</label>
              <select value={meta[k]} disabled={solicitudFinalizada}
                onChange={e => { const v = e.target.value; setMeta(p => ({ ...p, [k]: v })); setErrors(p => { const n={...p}; delete n[err]; return n; }); }}
                style={{ ...inputBase, paddingRight:28, cursor:"pointer", color: meta[k] ? "#1a2e27" : "#9CB8AE",
                  border:errors[err]?"1px solid #E74C3C":"1px solid #D4E5DE", background:`${errors[err]?"#FFF5F5":"#fff"} ${FLECHA_SELECT}` }}>
                <option value="">Seleccione…</option>
                {opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Fecha <span style={{ fontSize:10, color:"#9CB8AE" }}>automática</span></label>
            <input type="text" value={meta.fecha} readOnly style={inputReadonly} />
          </div>
          <div>
            <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>N° Solicitud</label>
            <input type="text" value={meta.solicitud || "—"} readOnly style={{ ...inputReadonly, letterSpacing:"0.02em" }} />
          </div>
          <div>
            <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Solicitante <span style={{ fontSize:10, color:"#9CB8AE" }}>usuario en sesión</span></label>
            <input type="text" value={meta.solicitante} readOnly title={meta.solicitante} style={inputReadonly} />
          </div>
          <div>
            <label style={{ fontSize:12, color:"#6B8F80", display:"block", marginBottom:5, fontWeight:500 }}>Correo electrónico <span style={{ fontSize:10, color:"#9CB8AE" }}>usuario en sesión</span></label>
            <input type="email" value={meta.correo} readOnly title={meta.correo} style={inputReadonly} />
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
        <button onClick={exportExcel} disabled={enviando} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:isMobile?"11px 20px":"9px 22px", fontSize:13, fontWeight:600, border:"none", borderRadius:9, background:enviando?"#6FA895":"#0F6E56", color:"#fff", cursor:enviando?"wait":"pointer", flex:isMobile?"1 0 100%":"none" }} onMouseEnter={e => { if (!enviando) e.currentTarget.style.background="#085041"; }} onMouseLeave={e => { if (!enviando) e.currentTarget.style.background="#0F6E56"; }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11v.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {enviando ? "Radicando…" : solicitudFinalizada ? "Descargar .xlsx de nuevo" : "Radicar y descargar .xlsx"}
        </button>
      </div>

      {/* Excel desde PDF (recuadro resaltado, con Mostrar / Ocultar) */}
      <PdfToExcel meta={meta} showToast={showToast} onRadicada={() => setRecarga(n => n + 1)} />

      {/* Solicitudes radicadas: por defecto las de hoy, con filtro por rango de fechas */}
      <SolicitudesDelDia isMobile={isMobile} recarga={recarga} showToast={showToast} />

      {/* Toast */}
      <div style={{ position:"fixed", bottom:20, left:"50%", transform:`translateX(-50%) translateY(${toast.visible?0:10}px)`, zIndex:1000, background:"#1a2e27", color:"#fff", padding:"10px 20px", borderRadius:24, fontSize:13, fontWeight:500, opacity:toast.visible?1:0, transition:"all 0.25s ease", pointerEvents:"none", whiteSpace:"nowrap", boxShadow:"0 4px 20px rgba(0,0,0,0.2)", maxWidth:"90vw", textAlign:"center" }}>
        {toast.message}
      </div>

      <SuccessPopup visible={popup} meta={meta} onClose={() => setPopup(false)} onNewRequest={newRequest} />
    </div>
  );
}
