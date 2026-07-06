// ── ExtraccionPickingPdf.jsx ──────────────────────────────────────────────
// Responsabilidad única: UI de extracción de datos Picking desde PDFs.
// Orquesta pdfOcrService → pickingParser → pickingExcelService.
// No conoce ningún otro módulo del portal (despachos, inventario, etc.).
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useCallback } from 'react';
import { procesarPdf }          from '../../utils/pdfOcrService';
import { extraerPickingNo, extraerFechaImpresion, detectarDuplicados } from '../../utils/pickingParser';
import { generarExcelPicking }  from '../../services/pickingExcelService';

// ── Paleta de colores (coherente con el portal, sin tocar sus estilos) ────
const C = {
  verde:    '#0F6E56',
  verdeClr: '#E1F5EE',
  borde:    '#E2EDE9',
  bg:       '#F7F9F8',
  texto:    '#1A2E27',
  sub:      '#6B8F80',
  dupRojo:  '#FFD7D7',
  warnAmar: '#FFF8E1',
  altAzul:  '#F0F7FF',
  blanco:   '#FFFFFF',
};

// ── Estilos reutilizables ─────────────────────────────────────────────────
const S = {
  card: {
    background: C.blanco, borderRadius: 12, border: `1px solid ${C.borde}`,
    padding: '20px 24px', marginBottom: 16,
  },
  btnPrimario: {
    background: C.verde, color: '#fff', border: 'none',
    borderRadius: 9, padding: '10px 22px', fontSize: 13,
    fontWeight: 600, cursor: 'pointer', display: 'flex',
    alignItems: 'center', gap: 7,
  },
  btnSecundario: {
    background: '#fff', color: C.verde, border: `1px solid ${C.verde}`,
    borderRadius: 9, padding: '9px 20px', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  },
  tag: (color, bg) => ({
    fontSize: 11, fontWeight: 600, color,
    background: bg, padding: '2px 8px',
    borderRadius: 10, whiteSpace: 'nowrap',
  }),
  tabBtn: (activo) => ({
    padding: '8px 20px', fontSize: 13, fontWeight: activo ? 700 : 500,
    border: activo ? `1.5px solid ${C.verde}` : `1px solid ${C.borde}`,
    borderRadius: 8, background: activo ? C.verde : '#fff',
    color: activo ? '#fff' : C.sub, cursor: 'pointer', transition: 'all 0.15s',
  }),
};

// ── Zona drag-and-drop ────────────────────────────────────────────────────
function ZonaCarga({ modo, onArchivos, archivosSeleccionados, procesando }) {
  const [arrastrandoEncima, setArrastrandoEncima] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setArrastrandoEncima(false);
    if (procesando) return;
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length) onArchivos(modo === 'unico' ? [files[0]] : files);
  }, [modo, onArchivos, procesando]);

  const handleInput = (e) => {
    const files = Array.from(e.target.files);
    if (files.length) onArchivos(modo === 'unico' ? [files[0]] : files);
  };

  const estiloZona = {
    border: `2px dashed ${arrastrandoEncima ? C.verde : C.borde}`,
    borderRadius: 10, padding: '32px 24px', textAlign: 'center',
    background: arrastrandoEncima ? C.verdeClr : C.bg,
    cursor: procesando ? 'not-allowed' : 'pointer',
    transition: 'all 0.2s', opacity: procesando ? 0.6 : 1,
  };

  return (
    <div
      style={estiloZona}
      onDragOver={e => { e.preventDefault(); setArrastrandoEncima(true); }}
      onDragLeave={() => setArrastrandoEncima(false)}
      onDrop={handleDrop}
      onClick={() => !procesando && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple={modo === 'multiple'}
        style={{ display: 'none' }}
        onChange={handleInput}
      />
      <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
      {archivosSeleccionados.length === 0 ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.texto, marginBottom: 4 }}>
            {modo === 'unico'
              ? 'Arrastra tu PDF aquí o haz clic para seleccionar'
              : 'Arrastra varios PDFs aquí o haz clic para seleccionar'}
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>
            {modo === 'unico'
              ? 'Un solo PDF con todas las hojas del Picking'
              : 'Puedes seleccionar múltiples archivos PDF'}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.verde, marginBottom: 6 }}>
            {archivosSeleccionados.length === 1
              ? `📎 ${archivosSeleccionados[0].name}`
              : `📎 ${archivosSeleccionados.length} archivos seleccionados`}
          </div>
          {archivosSeleccionados.length > 1 && (
            <div style={{ fontSize: 11, color: C.sub }}>
              {archivosSeleccionados.map(f => f.name).join(' · ')}
            </div>
          )}
          {!procesando && (
            <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>
              Haz clic para cambiar la selección
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Barra de progreso ─────────────────────────────────────────────────────
function BarraProgreso({ mensaje, pagina, total, pdfActual, totalPdfs }) {
  const pct = total > 0 ? Math.round((pagina / total) * 100) : 0;
  return (
    <div style={{ margin: '16px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.sub }}>{mensaje}</span>
        {totalPdfs > 1 && (
          <span style={{ fontSize: 11, color: C.sub }}>
            PDF {pdfActual} de {totalPdfs}
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: C.verde }}>{pct}%</span>
      </div>
      <div style={{ background: C.borde, borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: C.verde, borderRadius: 99,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

// ── Tabla de resultados ───────────────────────────────────────────────────
function TablaResultados({ registros, pickingsDuplicados, fechasDuplicadas, mostrarColumnaOrigen }) {
  const IGNORAR = new Set(['[NO LEGIBLE]', '[REVISAR - ILEGIBLE EN ESCANEO]']);

  const thStyle = {
    padding: '9px 12px', fontSize: 11, fontWeight: 700,
    color: '#fff', background: '#1F4E79',
    textAlign: 'center', whiteSpace: 'nowrap',
    borderRight: '1px solid #2a5f8f',
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${C.borde}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {mostrarColumnaOrigen && <th style={thStyle}>PDF Origen</th>}
            <th style={thStyle}>Página</th>
            <th style={thStyle}>Picking No</th>
            <th style={thStyle}>Fecha de Impresión</th>
            <th style={{ ...thStyle, borderRight: 'none' }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {registros.map((r, idx) => {
            const esDup  = pickingsDuplicados.has(r.pickingNo);
            const esWarn = IGNORAR.has(r.pickingNo) || IGNORAR.has(r.fechaImpresion) ||
                           r.fechaImpresion === '[REVISAR - ILEGIBLE EN ESCANEO]';
            const bg     = esDup ? C.dupRojo : esWarn ? C.warnAmar : idx % 2 === 1 ? C.altAzul : C.blanco;

            const tdStyle = {
              padding: '8px 12px', textAlign: 'center',
              background: bg, borderBottom: `1px solid ${C.borde}`,
            };
            return (
              <tr key={`${r.pdfNombre}-${r.pagina}`}>
                {mostrarColumnaOrigen && (
                  <td style={{ ...tdStyle, fontSize: 11, color: C.sub, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.pdfNombre}
                  </td>
                )}
                <td style={tdStyle}>{r.pagina}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: C.texto }}>{r.pickingNo}</td>
                <td style={tdStyle}>{r.fechaImpresion}</td>
                <td style={tdStyle}>
                  {esDup  && <span style={S.tag('#C0392B', '#FFD7D7')}>🔁 Duplicado</span>}
                  {esWarn && <span style={S.tag('#92610A', '#FFF8E1')}>⚠ Revisar</span>}
                  {!esDup && !esWarn && <span style={S.tag(C.verde, C.verdeClr)}>✓ OK</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────
export default function ExtraccionPickingPdf() {
  const [modo, setModo]                   = useState('unico');    // 'unico' | 'multiple'
  const [archivos, setArchivos]           = useState([]);
  const [procesando, setProcesando]       = useState(false);
  const [progreso, setProgreso]           = useState({ mensaje: '', pagina: 0, total: 0, pdfActual: 0, totalPdfs: 0 });
  const [registros, setRegistros]         = useState([]);
  const [terminado, setTerminado]         = useState(false);
  const [error, setError]                 = useState(null);
  const canceladoRef                      = useRef(false);

  const { pickingsDuplicados, fechasDuplicadas } = detectarDuplicados(registros);
  const totalDuplicados = pickingsDuplicados.size;
  const totalRevisar    = registros.filter(r =>
    r.pickingNo === '[NO LEGIBLE]' || r.fechaImpresion === '[NO LEGIBLE]' ||
    r.fechaImpresion === '[REVISAR - ILEGIBLE EN ESCANEO]'
  ).length;

  const resetear = () => {
    setArchivos([]);
    setRegistros([]);
    setTerminado(false);
    setError(null);
    setProcesando(false);
    setProgreso({ mensaje: '', pagina: 0, total: 0, pdfActual: 0, totalPdfs: 0 });
    canceladoRef.current = false;
  };

  const iniciarProcesamiento = async () => {
    if (!archivos.length || procesando) return;
    canceladoRef.current = false;
    setProcesando(true);
    setRegistros([]);
    setTerminado(false);
    setError(null);

    try {
      const totalPdfs = archivos.length;

      for (let ai = 0; ai < archivos.length; ai++) {
        if (canceladoRef.current) break;
        const archivo = archivos[ai];

        await procesarPdf(
          archivo,
          ({ pagina, total, texto }) => {
            if (canceladoRef.current) return;
            const pickingNo      = extraerPickingNo(texto);
            const fechaImpresion = extraerFechaImpresion(texto);
            setRegistros(prev => [...prev, {
              pdfNombre: archivo.name,
              pagina,
              pickingNo,
              fechaImpresion,
            }]);
            setProgreso({ mensaje: `Extrayendo datos — ${archivo.name}`, pagina, total, pdfActual: ai + 1, totalPdfs });
          },
          (msg) => {
            if (!canceladoRef.current) {
              setProgreso(p => ({ ...p, mensaje: msg, pdfActual: ai + 1, totalPdfs }));
            }
          }
        );
      }
    } catch (err) {
      setError(`Error durante el procesamiento: ${err.message}`);
    } finally {
      setProcesando(false);
      if (!canceladoRef.current) setTerminado(true);
    }
  };

  const descargarExcel = () => {
    const nombre = archivos.length === 1
      ? archivos[0].name.replace('.pdf', '').replace('.PDF', '')
      : `Extraccion_Picking_${new Date().toISOString().slice(0, 10)}`;
    generarExcelPicking(registros, nombre);
  };

  const mostrarColumnaOrigen = archivos.length > 1 || modo === 'multiple';

  return (
    <div style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif", color: C.texto }}>

      {/* ── Encabezado sección ── */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.texto, margin: 0 }}>
          Extracción de Datos Picking
        </h2>
        <p style={{ fontSize: 12, color: C.sub, margin: '4px 0 0' }}>
          Lee PDFs escaneados y extrae el Picking No y la Fecha de Impresión. Genera un Excel con los resultados y detecta duplicados automáticamente.
        </p>
      </div>

      {/* ── Selector de modo ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Modo de cargue
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={S.tabBtn(modo === 'unico')}    onClick={() => { setModo('unico');    resetear(); }}>
            📄 Un PDF (múltiples hojas)
          </button>
          <button style={S.tabBtn(modo === 'multiple')} onClick={() => { setModo('multiple'); resetear(); }}>
            📁 Varios PDFs
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.sub, marginTop: 10 }}>
          {modo === 'unico'
            ? 'Carga un único archivo PDF que contiene todas las hojas del picking escaneadas.'
            : 'Carga múltiples archivos PDF (de diferentes lotes o fechas) y los procesa en conjunto.'}
        </div>
      </div>

      {/* ── Zona de carga ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Selección de archivos
        </div>
        <ZonaCarga
          modo={modo}
          onArchivos={setArchivos}
          archivosSeleccionados={archivos}
          procesando={procesando}
        />

        {/* Botones de acción */}
        {archivos.length > 0 && !procesando && !terminado && (
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button style={S.btnPrimario} onClick={iniciarProcesamiento}>
              ▶ Iniciar extracción
            </button>
            <button style={S.btnSecundario} onClick={resetear}>
              ✕ Limpiar
            </button>
          </div>
        )}

        {procesando && (
          <div style={{ marginTop: 16 }}>
            <BarraProgreso
              mensaje={progreso.mensaje}
              pagina={progreso.pagina}
              total={progreso.total}
              pdfActual={progreso.pdfActual}
              totalPdfs={progreso.totalPdfs}
            />
            <button
              style={{ ...S.btnSecundario, marginTop: 8, fontSize: 12, padding: '7px 16px' }}
              onClick={() => { canceladoRef.current = true; setProcesando(false); }}
            >
              ⏹ Cancelar
            </button>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#FFF0EE', border: '1px solid #F5C6C6', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#C0392B' }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Resumen y descarga ── */}
      {registros.length > 0 && (
        <div style={{ ...S.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.texto }}>
                Resultados — {registros.length} registros procesados
              </span>
              {totalDuplicados > 0 && (
                <span style={S.tag('#C0392B', '#FFD7D7')}>
                  🔁 {totalDuplicados} picking{totalDuplicados > 1 ? 's' : ''} duplicado{totalDuplicados > 1 ? 's' : ''}
                </span>
              )}
              {totalRevisar > 0 && (
                <span style={S.tag('#92610A', '#FFF8E1')}>
                  ⚠ {totalRevisar} para revisar
                </span>
              )}
            </div>

            {terminado && (
              <button style={S.btnPrimario} onClick={descargarExcel}>
                ⬇ Descargar Excel
              </button>
            )}
          </div>

          {procesando && registros.length > 0 && (
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 10 }}>
              Procesando… la tabla se actualiza en tiempo real.
            </div>
          )}

          <TablaResultados
            registros={registros}
            pickingsDuplicados={pickingsDuplicados}
            fechasDuplicadas={fechasDuplicadas}
            mostrarColumnaOrigen={mostrarColumnaOrigen}
          />

          {terminado && (
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button style={S.btnPrimario} onClick={descargarExcel}>
                ⬇ Descargar Excel
              </button>
              <button style={S.btnSecundario} onClick={resetear}>
                ↺ Nueva extracción
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Leyenda ── */}
      <div style={{ fontSize: 11, color: C.sub, display: 'flex', gap: 16, flexWrap: 'wrap', padding: '0 4px 24px' }}>
        <span><span style={{ ...S.tag(C.verde, C.verdeClr), marginRight: 4 }}>✓ OK</span> Dato extraído correctamente</span>
        <span><span style={{ ...S.tag('#C0392B', '#FFD7D7'), marginRight: 4 }}>🔁 Duplicado</span> Picking No aparece más de una vez</span>
        <span><span style={{ ...S.tag('#92610A', '#FFF8E1'), marginRight: 4 }}>⚠ Revisar</span> No se pudo leer con claridad</span>
      </div>
    </div>
  );
}
