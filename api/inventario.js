// api/inventario.js — Vercel Serverless Function
// Conecta con Vercel KV (Redis/Upstash)
// Métodos: GET (leer) · POST (crear) · PUT (reemplazar lista = eliminar/actualizar)

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const KEY = "historial_inventario";
const MAX_REGISTROS = 500;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {

    // ── GET: leer historial ──────────────────────────────────────
    if (req.method === "GET") {
      const rawList = await redis.lrange(KEY, 0, MAX_REGISTROS - 1);
      const historial = rawList.map(item => {
        try { return typeof item === "string" ? JSON.parse(item) : item; }
        catch (_) { return item; }
      });
      return res.status(200).json({ historial });
    }

    // ── POST: agregar un nuevo registro al inicio ────────────────
    if (req.method === "POST") {
      const datos = req.body;
      if (!datos || !datos.pasillo) {
        return res.status(400).json({ error: "Datos inválidos" });
      }
      await redis.lpush(KEY, JSON.stringify(datos));
      await redis.ltrim(KEY, 0, MAX_REGISTROS - 1);
      return res.status(200).json({ ok: true });
    }

    // ── PUT: reemplazar la lista completa (eliminar / editar) ────
    // El frontend envía el historial ya modificado (sin el registro
    // eliminado, o con el registro editado actualizado).
    if (req.method === "PUT") {
      const { historial } = req.body;
      if (!Array.isArray(historial)) {
        return res.status(400).json({ error: "Se esperaba { historial: [] }" });
      }

      // Borrar la lista actual y escribir la nueva
      await redis.del(KEY);

      if (historial.length > 0) {
        // rpush para conservar el orden original (índice 0 = más reciente)
        const items = historial.map(r => JSON.stringify(r));
        await redis.rpush(KEY, ...items);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido" });

  } catch (err) {
    console.error("[api/inventario]", err);
    return res.status(500).json({ error: err.message });
  }
}
