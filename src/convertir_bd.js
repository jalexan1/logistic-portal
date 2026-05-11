/**
 * Ejecuta este script UNA VEZ para convertir BD_clientes.xlsx a JSON
 * y pegarlo en App.jsx dentro de BD_CLIENTES
 *
 * Uso:
 *   1. Copia BD_clientes.xlsx a la carpeta del proyecto
 *   2. En PowerShell: node convertir_bd.js
 *   3. Copia el resultado y pégalo en App.jsx reemplazando BD_CLIENTES = { ... }
 *
 * El script asume que tu Excel tiene:
 *   Columna A: NIT / Destinatario
 *   Columna B: Nombre del cliente
 *   Fila 1: encabezados (se omite)
 */

const XLSX = require("xlsx");
const path = require("path");

const filePath = path.join(__dirname, "BD_clientes.xlsx");
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

const result = {};
for (let i = 1; i < data.length; i++) {
  const [nit, nombre] = data[i];
  if (nit && nombre) {
    result[String(nit).trim()] = String(nombre).trim().toUpperCase();
  }
}

console.log("// Pega esto en App.jsx reemplazando BD_CLIENTES = { ... }");
console.log("const BD_CLIENTES = " + JSON.stringify(result, null, 2) + ";");
console.log(`\n// Total clientes cargados: ${Object.keys(result).length}`);
