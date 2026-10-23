// ── pdfModeloNoviembre2026.js ────────────────────────────────────────────
// Lectura de RESPALDO de los PDF de pedido: "modelo_noviembre_2026".
//
// El portal lee primero con el modelo original (PDF tipo "Clic0015587":
// "Dirigido a", cantidades con decimales "24,00", precio, descuento…).
// Si ese modelo deja datos sin leer (destinatario, entrega, filas o cantidades),
// se usa esta lectura, hecha para el formato "Presupuesto" (ej. "Pedido Titan"):
//
//   De:   Click Hair / 901443866-0 / dirección …     ← quien ENVÍA (no se usa)
//   Para: Maquina Dispensadora Titan Plaza            ← DESTINATARIO
//   Presupuesto: # Click0017723                       ← ENTREGA
//   Emisión: 20/10/2026 · Vencimiento: 26/10/2026 · TOTAL: $ 9.825.000
//   SKU | Producto | Precio unitario | Cantidad | Total
//   PTC6100-2025 | Energizante capilar… | $ 45.000 | 15 | $ 675.000
//   PTC9121 - / 2026 (SKU partido en dos renglones) …
//
// Función pura (sin base de datos): recibe el texto del PDF, un renglón por
// fragmento de texto, tal como lo entrega pdf.js.
// ─────────────────────────────────────────────────────────────────────────

export const NOMBRE_MODELO_NOVIEMBRE_2026 = "modelo_noviembre_2026";

// SKU completo en un renglón: PTC6100-2025 · PTC7400 · PTK9059 · PTB2600-2025
const SKU_RE = /^[A-Z]{2,5}\d{3,6}[A-Z]?(?:-\d{4})?$/;
// SKU partido: "PTC9121 -" y en el renglón siguiente "2026"
const SKU_PARTIDO_RE = /^([A-Z]{2,5}\d{3,6}[A-Z]?)\s*-\s*$/;
const ANIO_RE = /^\d{4}$/;
// SKU pegado al nombre del producto: "PTC6100-2025Energizante capilar…"
const SKU_PEGADO_RE = /^([A-Z]{2,5}\d{3,6}[A-Z]?(?:\s*-\s*\d{4}|\s*-)?)\s*([A-Za-zÁÉÍÓÚáéíóúÑñ].*)$/;
const PRECIO_RE = /^\$\s*[\d.,]+$/;
const CANTIDAD_RE = /^\d{1,6}(?:[.,]\d{1,3})?$/;
const FIN_RE = /^(sub\s*total|politicas|políticas|para tu tranquilidad|total)\b/i;

const siguiente = (lineas, idx) => (idx !== -1 && lineas[idx + 1] ? lineas[idx + 1].trim() : "");
const indice = (lineas, re) => lineas.findIndex(l => re.test(l));

// "15" → 15 · "15,00" → 15 · "1.200" (miles) → 1200
const aCantidad = (txt) => {
  const t = String(txt).trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Normaliza un SKU para comparar ("PTC9121 - 2026" → "PTC9121-2026"). */
export const normalizarSku = (sku) => String(sku || "").toUpperCase().replace(/\s+/g, "").trim();

/**
 * Lee el PDF con el modelo_noviembre_2026.
 * Devuelve { modelo, entrega, nombreDestinatario, correoDestinatario, fechaEmision,
 *            fechaVencimiento, totalFactura, filas: [{ sku, producto, precio, cantidad, total }] }
 */
export function leerModeloNoviembre2026(textoPdf) {
  const lineas = String(textoPdf || "").split("\n").map(l => l.trim()).filter(Boolean);

  // Destinatario: el renglón siguiente a "Para:" (el de "De:" es quien envía)
  const iPara = indice(lineas, /^para:?$/i);
  let nombreDestinatario = siguiente(lineas, iPara);
  if (/^(email|tel|nit)\b/i.test(nombreDestinatario)) nombreDestinatario = "";
  let correoDestinatario = "";
  if (iPara !== -1) {
    for (let k = iPara + 2; k < Math.min(iPara + 7, lineas.length); k++) {
      if (lineas[k].includes("@")) { correoDestinatario = lineas[k]; break; }
      if (/^presupuesto/i.test(lineas[k])) break;
    }
  }

  // Entrega: "# Click0017723" (el # puede venir en un renglón y el código en el siguiente)
  const mEntrega = lineas.join("\n").match(/#\s*([A-Za-z]{2,12}\d{4,})/);
  const entrega = mEntrega ? mEntrega[1] : "";

  const fechaEmision = siguiente(lineas, indice(lineas, /^emisi[oó]n:?$/i));
  const fechaVencimiento = siguiente(lineas, indice(lineas, /^vencimiento:?$/i));
  const iTotal = indice(lineas, /^total:$/i);
  const totalFactura = iTotal !== -1 && PRECIO_RE.test(siguiente(lineas, iTotal)) ? siguiente(lineas, iTotal) : "";

  // Tabla de productos: empieza después del encabezado "SKU"
  const iSku = indice(lineas, /^sku$/i);
  const filas = [];
  let i = iSku !== -1 ? iSku + 1 : 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (FIN_RE.test(l) && filas.length > 0) break;

    let sku = null, producto = [];
    const partido = SKU_PARTIDO_RE.exec(l);
    const pegado = SKU_PEGADO_RE.exec(l);
    if (partido && ANIO_RE.test(lineas[i + 1] || "")) { sku = `${partido[1]}-${lineas[i + 1]}`; i += 2; }
    else if (SKU_RE.test(l)) { sku = l; i += 1; }
    else if (pegado && !PRECIO_RE.test(l)) {
      sku = normalizarSku(pegado[1]); producto.push(pegado[2].trim()); i += 1;
      // "PTC9121 -Termoprotector…" con el año en el renglón siguiente
      if (/-$/.test(sku) && ANIO_RE.test(lineas[i] || "")) { sku += lineas[i]; i += 1; }
    }
    else { i += 1; continue; }

    // Descripción hasta el precio unitario; luego cantidad y total
    let precio = "", cantidad = 0, total = "";
    let guard = 0;
    while (i < lineas.length && !PRECIO_RE.test(lineas[i]) && guard < 6) {
      if (SKU_RE.test(lineas[i]) || SKU_PARTIDO_RE.test(lineas[i])) break;
      producto.push(lineas[i]); i += 1; guard += 1;
    }
    if (PRECIO_RE.test(lineas[i] || "")) {
      precio = lineas[i]; i += 1;
      if (CANTIDAD_RE.test(lineas[i] || "")) { cantidad = aCantidad(lineas[i]); i += 1; }
      if (PRECIO_RE.test(lineas[i] || "")) { total = lineas[i]; i += 1; }
    }
    filas.push({ sku: normalizarSku(sku), producto: producto.join(" ").trim(), precio, cantidad, total });
  }

  return {
    modelo: NOMBRE_MODELO_NOVIEMBRE_2026,
    entrega, nombreDestinatario, correoDestinatario,
    fechaEmision, fechaVencimiento, totalFactura, filas,
  };
}
