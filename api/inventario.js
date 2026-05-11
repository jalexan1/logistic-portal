// api/inventario.js
// Vercel Serverless Function — conecta con Vercel KV (Redis/Upstash)
// Esta función corre en el SERVIDOR de Vercel, no en el browser.
// Así podemos usar @upstash/redis de forma segura con las variables de entorno.

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const KEY = "historial_inventario";
const MAX_REGISTROS = 500;

export default async function handler(req, res) {
  // Habilitar CORS para desarrollo local
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // ── POST: Guardar un nuevo registro ──
    if (req.method === "POST") {
      const datos = req.body;
      if (!datos || !datos.pasillo) {
        return res.status(400).json({ error: "Datos inválidos" });
      }

      // lpush agrega al inicio de la lista (más reciente primero)
      await redis.lpush(KEY, JSON.stringify(datos));
      // Mantener solo los últimos MAX_REGISTROS
      await redis.ltrim(KEY, 0, MAX_REGISTROS - 1);

      return res.status(200).json({ ok: true });
    }

    // ── GET: Obtener historial ──
    if (req.method === "GET") {
      const rawList = await redis.lrange(KEY, 0, MAX_REGISTROS - 1);
      const historial = rawList.map(item => {
        try {
          // Upstash puede devolver el objeto ya parseado o como string
          return typeof item === "string" ? JSON.parse(item) : item;
        } catch (_) {
          return item;
        }
      });
      return res.status(200).json({ historial });
    }

    return res.status(405).json({ error: "Método no permitido" });

  } catch (err) {
    console.error("[api/inventario]", err);
    return res.status(500).json({ error: err.message });
  }
}
