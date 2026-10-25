// ── AdminBaseDatos.jsx ───────────────────────────────────────────────────
// Admon → Administración BD y adjuntos (solo administrador).
//  1. Resumen de adjuntos y política de documentos (retención en meses).
//  2. Adjuntos vencidos: descargar → copiar al disco duro → marcar como
//     respaldados → eliminar de Supabase. Todo manual, paso a paso.
//  3. SQL listos para copiar (consultas de más de un mes, tamaños, etc.).
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import {
  resumenAdjuntos, adjuntosVencidos, marcarAdjuntos, eliminarAdjuntosRespaldados, descargarAdjunto, tamanoLegible,
} from "../../services/adjuntosService";
import { fechaHoraBogota } from "../../utils/fechas";

const SQLS = [
  {
    titulo: "Solicitudes de más de un mes (encabezado)",
    uso: "Cambie las fechas. En el resultado use «Export → CSV» para entregarlo en Excel.",
    sql: `SELECT numero, radicada_at AT TIME ZONE 'America/Bogota' AS fecha_hora, estado_codigo, area_solicitante,
       proceso, solicitante_nombre, solicitante_correo, origen, total_lineas, total_unidades, lote_numero
  FROM despachos.vw_solicitudes
 WHERE fecha_radicacion BETWEEN '2026-01-01' AND '2026-06-30'
 ORDER BY radicada_at;`,
  },
  {
    titulo: "Líneas de solicitudes de más de un mes (detalle completo)",
    uso: "Mismas columnas de la hoja DESPACHO. Cambie las fechas; puede filtrar por NIT con ILIKE.",
    sql: `SELECT radicada_at AT TIME ZONE 'America/Bogota' AS fecha_hora, numero, area_solicitante, proceso,
       solicitante_nombre, entrega, destinatario_nit, destinatario_nombre, destinatario_direccion,
       destinatario_ciudad, destinatario_departamento, destinatario_telefono, material, ean,
       cantidad, um, item, bodega, observaciones, lote_numero
  FROM despachos.vw_solicitud_lineas
 WHERE fecha_radicacion BETWEEN '2026-01-01' AND '2026-06-30'
   -- AND destinatario_nit ILIKE '%900615349%'
 ORDER BY radicada_at, numero, linea_nro;`,
  },
  {
    titulo: "Bloques procesados de más de un mes",
    uso: "Cambie las fechas.",
    sql: `SELECT numero, procesado_at AT TIME ZONE 'America/Bogota' AS procesado, procesado_por,
       total_solicitudes, total_lineas, total_unidades, comentario, revertido_at, motivo_reversion
  FROM despachos.vw_lotes
 WHERE fecha_proceso BETWEEN '2026-01-01' AND '2026-06-30'
 ORDER BY procesado_at;`,
  },
  {
    titulo: "Adjuntos vencidos según la política (lista para el respaldo)",
    uso: "Lo mismo que muestra la tabla de esta pantalla, por si prefiere trabajarlo desde Supabase.",
    sql: `SELECT a.id, s.numero, a.nombre, a.ruta, round(a.tamano_bytes / 1048576.0, 2) AS mb,
       a.created_at AT TIME ZONE 'America/Bogota' AS subido, a.respaldado_at, a.respaldado_por
  FROM despachos.solicitud_adjuntos a
  JOIN despachos.solicitudes s ON s.id = a.solicitud_id
 WHERE a.eliminado_at IS NULL
   AND a.created_at < now() - make_interval(months => core.fn_parametro_num('TOMAPEDIDO','adjuntos_retencion_meses',1)::int)
 ORDER BY a.created_at;`,
  },
  {
    titulo: "Espacio usado por adjuntos, por mes",
    uso: "Para controlar el crecimiento del almacenamiento.",
    sql: `SELECT to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM') AS mes,
       count(*) AS archivos, round(sum(tamano_bytes) / 1048576.0, 2) AS mb,
       count(*) FILTER (WHERE eliminado_at IS NOT NULL) AS ya_eliminados
  FROM despachos.solicitud_adjuntos
 GROUP BY 1 ORDER BY 1 DESC;`,
  },
  {
    titulo: "Tamaño de las tablas principales",
    uso: "Para saber qué está creciendo en la base de datos.",
    sql: `SELECT n.nspname || '.' || c.relname AS tabla, c.reltuples::bigint AS filas_aprox,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS tamano
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('core', 'despachos', 'inventario')
 ORDER BY pg_total_relation_size(c.oid) DESC;`,
  },
  {
    titulo: "Cambios recientes en el maestro de clientes y parámetros (auditoría)",
    uso: "Quién cambió qué, en los últimos 30 días.",
    sql: `SELECT a.created_at AT TIME ZONE 'America/Bogota' AS fecha, a.tabla, a.accion, a.registro_id,
       p.nombre AS usuario, a.campos_cambiados
  FROM core.auditoria a
  LEFT JOIN core.perfiles p ON p.id = a.usuario_id
 WHERE a.tabla IN ('destinatarios', 'parametros')
   AND a.created_at > now() - interval '30 days'
 ORDER BY a.created_at DESC;`,
  },
];

const card = { background: "#fff", border: "1px solid #E2EDE9", borderRadius: 14, overflow: "hidden", marginBottom: 16 };
const head = { padding: "12px 16px", borderBottom: "1px solid #E2EDE9", fontSize: 14, fontWeight: 700, color: "#1a2e27" };
const btn = { height: 34, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid #C5DDD4", borderRadius: 8, background: "#fff", color: "#0F6E56", cursor: "pointer", whiteSpace: "nowrap" };
const th = { padding: "8px 8px", fontSize: 10, fontWeight: 600, color: "#6B8F80", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap", background: "#F7FCF9" };
const td = { padding: "7px 8px", fontSize: 12, color: "#1a2e27", borderBottom: "1px solid #F0F5F3", whiteSpace: "nowrap" };

export default function AdminBaseDatos() {
  const [resumen, setResumen] = useState(null);
  const [vencidos, setVencidos] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [cargando, setCargando] = useState(false);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const aviso = (m) => { setToast(m); setTimeout(() => setToast(""), 4500); };

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const [r, v] = await Promise.all([resumenAdjuntos(), adjuntosVencidos()]);
      setResumen(r); setVencidos(v); setSel(new Set());
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const elegidos = vencidos.filter(a => sel.has(a.id));
  const marcarTodos = (on) => setSel(on ? new Set(vencidos.map(a => a.id)) : new Set());
  const alternar = (id) => setSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const descargar = async () => {
    setTrabajando("descargar");
    try {
      for (const a of elegidos) { await descargarAdjunto(a, a.solicitud_numero); await new Promise(r => setTimeout(r, 500)); }
      aviso(`⬇ ${elegidos.length} archivo(s) descargados. Cópielos al disco duro y luego márquelos como respaldados.`);
    } catch (e) { aviso("⚠ " + e.message); }
    finally { setTrabajando(""); }
  };
  const respaldar = async () => {
    setTrabajando("respaldar");
    try { const n = await marcarAdjuntos(elegidos.map(a => a.id), "RESPALDADO"); aviso(`✓ ${n} adjunto(s) marcados como respaldados en disco duro`); await cargar(); }
    catch (e) { aviso("⚠ " + e.message); }
    finally { setTrabajando(""); }
  };
  const eliminar = async () => {
    setConfirmarBorrado(false); setTrabajando("eliminar");
    try { const n = await eliminarAdjuntosRespaldados(elegidos); aviso(`🗑 ${n} adjunto(s) eliminados de Supabase (quedan en el disco duro)`); await cargar(); }
    catch (e) { aviso("⚠ " + e.message); }
    finally { setTrabajando(""); }
  };
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); aviso("✓ SQL copiado"); } catch { aviso("Seleccione el texto y cópielo con Ctrl+C"); } };

  const sinRespaldo = elegidos.filter(a => !a.respaldado_at).length;

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2e27" }}>Administración BD y adjuntos</div>
          <div style={{ fontSize: 12, color: "#6B8F80" }}>Respaldo de adjuntos según la política de documentos y consultas para la base de datos.</div>
        </div>
        <button onClick={cargar} disabled={cargando} style={{ ...btn, height: 36 }}>↻ Actualizar</button>
      </div>
      {error && <div style={{ background: "#FFF5F5", border: "1px solid #F5A0A0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "#C0392B" }}>⚠ {error}</div>}

      {/* 1. Resumen y política */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          ["Adjuntos en la aplicación", resumen ? `${resumen.total_archivos}` : "—", resumen ? `${resumen.total_mb} MB` : ""],
          ["Vencidos (para respaldar)", resumen ? `${resumen.vencidos_archivos}` : "—", resumen ? `${resumen.vencidos_mb} MB · subidos antes del ${resumen.fecha_corte}` : ""],
          ["Respaldados, falta eliminar", resumen ? `${resumen.respaldados_pendientes_borrar}` : "—", "ya están en el disco duro"],
          ["Retención en la aplicación", resumen ? `${resumen.retencion_meses} mes${Number(resumen.retencion_meses) !== 1 ? "es" : ""}` : "—", "Admon → Parámetros TomaPedido"],
        ].map(([t, v, s]) => (
          <div key={t} style={{ background: "#fff", border: "1px solid #E2EDE9", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, color: "#6B8F80", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{t}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#0F6E56" }}>{v}</div>
            <div style={{ fontSize: 11, color: "#9CB8AE" }}>{s}</div>
          </div>))}
      </div>

      <div style={{ ...card, background: "#F7FCF9" }}>
        <div style={head}>📋 Política de documentos (adjuntos: .zip, imágenes, QR)</div>
        <div style={{ padding: "12px 18px", fontSize: 12.5, color: "#44574F", lineHeight: 1.6 }}>
          <b>1.</b> Los adjuntos se consultan en la aplicación (Solicitudes de hoy, Solicitudes, Bloques procesados e Histórico) durante <b>1 mes</b>.<br />
          <b>2.</b> Cumplido el mes, el <b>administrador los pasa manualmente a un disco duro</b> con esta pantalla.<br />
          <b>3.</b> En el disco duro se conservan <b>1 año</b>. <b>4.</b> Después de un año se <b>destruyen</b>.
        </div>
      </div>

      {/* 2. Paso a paso + adjuntos vencidos */}
      <div style={card}>
        <div style={head}>💾 Pasar adjuntos vencidos al disco duro — paso a paso</div>
        <ol style={{ margin: 0, padding: "12px 18px 12px 36px", fontSize: 12.5, color: "#44574F", lineHeight: 1.7 }}>
          <li>Conecte el disco duro y cree una carpeta por mes, por ejemplo <code>Adjuntos_Despachos\2026-10</code>.</li>
          <li>En la tabla de abajo marque los adjuntos y pulse <b>⬇ Descargar</b>. Se descargan con el N° de solicitud al inicio del nombre (ej. <code>DSE-000273_qr.png</code>).</li>
          <li>Mueva los archivos descargados desde su carpeta <b>Descargas</b> a la carpeta del disco duro y verifique que abren.</li>
          <li>Vuelva aquí y pulse <b>✓ Marcar como respaldados</b> (queda registrado quién y cuándo).</li>
          <li>Pulse <b>🗑 Eliminar de Supabase</b>: solo borra los ya respaldados y libera espacio. Esto no se puede deshacer.</li>
          <li>Anote en el disco duro la fecha de destrucción: <b>1 año</b> después del respaldo.</li>
        </ol>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 16px", borderTop: "1px solid #E2EDE9", background: "#FBFDFC" }}>
          <span style={{ fontSize: 12, color: "#44574F", marginRight: "auto" }}>{elegidos.length} de {vencidos.length} seleccionados{sinRespaldo ? ` · ${sinRespaldo} sin respaldar` : ""}</span>
          <button onClick={descargar} disabled={!elegidos.length || !!trabajando} style={btn}>{trabajando === "descargar" ? "Descargando…" : "⬇ Descargar"}</button>
          <button onClick={respaldar} disabled={!elegidos.length || !!trabajando} style={btn}>{trabajando === "respaldar" ? "…" : "✓ Marcar como respaldados"}</button>
          <button onClick={() => setConfirmarBorrado(true)} disabled={!elegidos.some(a => a.respaldado_at) || !!trabajando}
            style={{ ...btn, color: "#C0392B", borderColor: "#F5C6C0" }}>{trabajando === "eliminar" ? "Eliminando…" : "🗑 Eliminar de Supabase"}</button>
        </div>
        <div style={{ overflow: "auto", maxHeight: "50vh" }}>
          {cargando && <div style={{ padding: 16, fontSize: 13, color: "#6B8F80" }}>Cargando…</div>}
          {!cargando && vencidos.length === 0 && <div style={{ padding: 18, fontSize: 13, color: "#9CB8AE", textAlign: "center" }}>No hay adjuntos vencidos. Todo está dentro de la política.</div>}
          {!cargando && vencidos.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead style={{ position: "sticky", top: 0 }}><tr>
                <th style={{ ...th, width: 36 }}><input type="checkbox" checked={sel.size === vencidos.length} onChange={e => marcarTodos(e.target.checked)}
                  style={{ appearance: "auto", WebkitAppearance: "checkbox", width: 16, height: 16, cursor: "pointer" }} /></th>
                {["Solicitud", "Archivo", "Tamaño", "Subido", "Respaldo en disco"].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{vencidos.map(a => (
                <tr key={a.id} style={{ background: sel.has(a.id) ? "#EAF7F1" : "#fff" }}>
                  <td style={td}><input type="checkbox" checked={sel.has(a.id)} onChange={() => alternar(a.id)} style={{ appearance: "auto", WebkitAppearance: "checkbox", width: 16, height: 16, cursor: "pointer" }} /></td>
                  <td style={{ ...td, fontWeight: 700, color: "#0F6E56" }}>{a.solicitud_numero}</td>
                  <td style={td}>{a.nombre}</td>
                  <td style={td}>{tamanoLegible(a.tamano_bytes)}</td>
                  <td style={td}>{fechaHoraBogota(a.created_at)}</td>
                  <td style={{ ...td, color: a.respaldado_at ? "#0F6E56" : "#B45309" }}>{a.respaldado_at ? `✓ ${fechaHoraBogota(a.respaldado_at)} · ${a.respaldado_por || ""}` : "Pendiente"}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
      </div>

      {/* 3. SQL */}
      <div style={card}>
        <div style={head}>🧾 SQL para el administrador de la base de datos</div>
        <div style={{ padding: "10px 16px", fontSize: 12, color: "#6B8F80" }}>
          Dónde ejecutarlos: <b>Supabase → proyecto kpi-logistics → SQL Editor → New query</b>. Son solo de consulta (no modifican datos).
          Para información de más de un mes que pidan los usuarios, use los tres primeros.
        </div>
        {SQLS.map(q => (
          <div key={q.titulo} style={{ borderTop: "1px solid #F0F5F3", padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <div><div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e27" }}>{q.titulo}</div><div style={{ fontSize: 11.5, color: "#6B8F80" }}>{q.uso}</div></div>
              <button onClick={() => copiar(q.sql)} style={btn}>📋 Copiar</button>
            </div>
            <pre style={{ margin: 0, background: "#0F1F1A", color: "#D1FAE5", borderRadius: 8, padding: "10px 12px", fontSize: 11.5, overflow: "auto", lineHeight: 1.5 }}>{q.sql}</pre>
          </div>))}
      </div>

      {confirmarBorrado && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,30,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#C0392B", marginBottom: 8 }}>Eliminar de Supabase</div>
            <div style={{ fontSize: 13, color: "#44574F", lineHeight: 1.55, marginBottom: 14 }}>
              Se eliminarán <b>{elegidos.filter(a => a.respaldado_at).length}</b> adjunto(s) ya respaldados en disco duro.
              {sinRespaldo > 0 && <> Los <b>{sinRespaldo}</b> sin respaldar <b>no</b> se tocan.</>} Esta acción <b>no se puede deshacer</b>.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmarBorrado(false)} style={btn}>Cancelar</button>
              <button onClick={eliminar} style={{ ...btn, background: "#C0392B", color: "#fff", borderColor: "#C0392B" }}>Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 2100, background: "#1a2e27", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}
