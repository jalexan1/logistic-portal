-- =============================================================================
-- 031_motivo_bloque_carga_articulos.sql   (v2 29-oct: + lock_timeout)
-- Plataforma L&S · Portal de Despachos · Mejoras 28-oct-2026
--
-- QUÉ HACE
--  1. despachos.vw_lote_lineas: agrega el MOTIVO (columna proceso, al final)
--     para que el Excel de bloque lo muestre en sus 4 hojas.
--  2. Carga MASIVA de artículos (core.item_ean) con plantilla ITEM | EAN | DESCRIPCION:
--       despachos.fn_cargar_articulos(filas, aplicar)
--       · aplicar = false → SIMULACIÓN (no cambia nada, solo informa)
--       · aplicar = true  → carga
--     Idempotente con el ITEM como llave. Reglas:
--       CREAR        ITEM nuevo
--       ACTUALIZAR   ITEM existe y trae otro EAN u otra descripción
--       SIN_CAMBIOS  ITEM existe con los mismos datos
--       DUPLICADO    fila repetida idéntica en el archivo (se carga una vez)
--       NO_CARGADO   falta ITEM o EAN · ITEM repetido con datos distintos ·
--                    EAN repetido para varios ITEM en el archivo · EAN ya
--                    asignado a OTRO ítem activo del maestro
--     Solo supervisor (operador) y admin.
--
-- RENDIMIENTO (lección del 27-oct)
--  · Todos los cruces son por IGUALDAD (item = item, ean = ean): sin funciones
--    ni OR dentro de los cruces → la base usa tablas hash.
--  · Todo UPDATE lleva WHERE (Supabase pg_safeupdate).
--  · Probado: 257 artículos en el maestro + archivo de 5.000 filas → ver LEEME.
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere 017 a 030 aplicados (en especial 026 y 028).
-- =============================================================================
SET statement_timeout = '30s';   -- freno 1: ninguna sentencia corre más de 30 s
SET lock_timeout = '5s';         -- freno 2: si la vista está en uso, espera máx. 5 s y aborta
                                 --          (no deja a los usuarios del portal en cola)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Motivo en las líneas del bloque (columna nueva al final)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW despachos.vw_lote_lineas
WITH (security_invoker = true) AS
SELECT s.lote_id, s.id AS solicitud_id, s.numero AS solicitud_numero, s.area_solicitante,
       s.solicitante_nombre, s.origen, s.numero_pedido_origen, s.radicada_at,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_ciudad, li.material, li.producto_descripcion, li.cantidad, li.um, li.item, li.bodega,
       s.solicitante_correo, li.ean, li.destinatario_direccion, li.destinatario_departamento,
       li.destinatario_telefono,
       s.proceso
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
WHERE s.lote_id IS NOT NULL;

GRANT SELECT ON despachos.vw_lote_lineas TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Carga masiva de artículos
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_cargar_articulos(p_filas jsonb, p_aplicar boolean DEFAULT false)
RETURNS TABLE (fila integer, item text, ean text, descripcion text, accion text, detalle text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_cuenta bigint := core.fn_mi_cuenta();
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'CORE150: la plantilla no tiene filas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_filas) > 10000 THEN
    RAISE EXCEPTION 'CORE151: máximo 10000 artículos por carga' USING ERRCODE = 'check_violation';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_carga_articulos (
    fila int, item text, ean text, descripcion text, firma text,
    dest_id bigint, dest_ean text, dest_desc text, dest_activo boolean,
    accion text, detalle text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_carga_articulos;

  -- Normalización (una vez por fila del archivo, igual que la pantalla de Artículos)
  INSERT INTO pg_temp.tmp_carga_articulos (fila, item, ean, descripcion)
  SELECT COALESCE(x.fila, o.ord::int + 1),
         NULLIF(upper(regexp_replace(COALESCE(x.item, ''), '\s+', '', 'g')), ''),
         NULLIF(regexp_replace(COALESCE(x.ean, ''), '\s+', '', 'g'), ''),
         NULLIF(trim(regexp_replace(COALESCE(x.descripcion, ''), '[\s ]+', ' ', 'g')), '')
  FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS x(fila int, item text, ean text, descripcion text);

  UPDATE pg_temp.tmp_carga_articulos t
  SET firma = lower(concat_ws('|', t.ean, t.descripcion))
  WHERE true;   -- pg_safeupdate exige WHERE
  -- Estadísticas de la tabla temporal: sin esto la base no sabe cuántas filas tiene y
  -- puede elegir "todo contra todo" (medido: 10,6 s con 5.000 filas; con ANALYZE < 1 s)
  ANALYZE pg_temp.tmp_carga_articulos;

  -- a) Datos obligatorios
  UPDATE pg_temp.tmp_carga_articulos t SET accion = 'NO_CARGADO',
    detalle = CASE WHEN t.item IS NULL THEN 'Falta el ITEM' ELSE 'Falta el EAN' END
  WHERE t.item IS NULL OR t.ean IS NULL;

  -- b) ITEM repetido en el archivo: datos distintos → no se carga; idénticos → una sola vez
  WITH g AS (
    SELECT t.item, count(DISTINCT t.firma) AS firmas, min(t.fila) AS primera,
           string_agg(t.fila::text, ', ' ORDER BY t.fila) AS filas
    FROM pg_temp.tmp_carga_articulos t WHERE t.accion IS NULL
    GROUP BY t.item HAVING count(*) > 1)
  UPDATE pg_temp.tmp_carga_articulos t SET
    accion  = CASE WHEN g.firmas > 1 THEN 'NO_CARGADO' WHEN t.fila <> g.primera THEN 'DUPLICADO' ELSE NULL END,
    detalle = CASE WHEN g.firmas > 1 THEN 'ITEM repetido en el archivo con datos distintos (filas ' || g.filas || ')'
                   WHEN t.fila <> g.primera THEN 'Fila repetida igual a la fila ' || g.primera || ': se carga una sola vez' END
  FROM g WHERE t.item = g.item AND t.accion IS NULL;

  -- c) Un mismo EAN para varios ITEM dentro del archivo → no se carga ninguno
  WITH g AS (
    SELECT t.ean, string_agg(DISTINCT t.item, ', ') AS items
    FROM pg_temp.tmp_carga_articulos t WHERE t.accion IS NULL
    GROUP BY t.ean HAVING count(DISTINCT t.item) > 1)
  UPDATE pg_temp.tmp_carga_articulos t SET accion = 'NO_CARGADO',
    detalle = 'El EAN ' || t.ean || ' está repetido en el archivo para varios ITEM (' || g.items || ')'
  FROM g WHERE t.ean = g.ean AND t.accion IS NULL;

  -- d) ¿El ITEM ya existe en el maestro? (cruce por igualdad)
  UPDATE pg_temp.tmp_carga_articulos t SET
    dest_id = a.id, dest_ean = a.ean, dest_desc = a.descripcion, dest_activo = a.activo
  FROM core.item_ean a
  WHERE a.item = t.item AND a.cuenta_id IS NOT DISTINCT FROM v_cuenta AND t.accion IS NULL;

  -- e) El EAN ya pertenece a OTRO ítem activo del maestro → no se carga
  UPDATE pg_temp.tmp_carga_articulos t SET accion = 'NO_CARGADO',
    detalle = 'El EAN ' || t.ean || ' ya está asignado al ITEM ' || o.item
  FROM core.item_ean o
  WHERE o.ean = t.ean AND o.activo AND o.cuenta_id IS NOT DISTINCT FROM v_cuenta
    AND o.item <> t.item AND t.accion IS NULL;

  -- f) Existe → actualizar (EAN / descripción del archivo) o sin cambios
  UPDATE pg_temp.tmp_carga_articulos t SET
    accion  = CASE WHEN t.ean IS DISTINCT FROM t.dest_ean
                     OR (t.descripcion IS NOT NULL AND t.descripcion IS DISTINCT FROM t.dest_desc)
                   THEN 'ACTUALIZAR' ELSE 'SIN_CAMBIOS' END,
    detalle = 'Existe con EAN ' || t.dest_ean
              || CASE WHEN t.ean IS DISTINCT FROM t.dest_ean THEN ' → nuevo EAN ' || t.ean ELSE '' END
              || CASE WHEN NOT t.dest_activo THEN ' · inactivo' ELSE '' END
  WHERE t.accion IS NULL AND t.dest_id IS NOT NULL;

  -- g) Nuevos
  UPDATE pg_temp.tmp_carga_articulos t SET accion = 'CREAR', detalle = 'Artículo nuevo'
  WHERE t.accion IS NULL AND t.dest_id IS NULL;

  -- Aplicar
  IF p_aplicar THEN
    INSERT INTO core.item_ean (cuenta_id, item, ean, descripcion, created_by)
    SELECT v_cuenta, t.item, t.ean, t.descripcion, auth.uid()
    FROM pg_temp.tmp_carga_articulos t WHERE t.accion = 'CREAR'
    ORDER BY t.fila;

    UPDATE core.item_ean a SET
      ean         = t.ean,
      descripcion = COALESCE(t.descripcion, a.descripcion)
    FROM pg_temp.tmp_carga_articulos t
    WHERE t.accion = 'ACTUALIZAR' AND t.dest_id = a.id;
  END IF;

  RETURN QUERY
    SELECT t.fila, COALESCE(t.item, ''), COALESCE(t.ean, ''), COALESCE(t.descripcion, ''), t.accion, t.detalle
    FROM pg_temp.tmp_carga_articulos t ORDER BY t.fila;
END;
$$;
COMMENT ON FUNCTION despachos.fn_cargar_articulos(jsonb, boolean) IS
  'Carga masiva de artículos (ITEM, EAN, DESCRIPCION). aplicar=false: simulación. Idempotente por ITEM.';

REVOKE ALL ON FUNCTION despachos.fn_cargar_articulos(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_cargar_articulos(jsonb, boolean) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
