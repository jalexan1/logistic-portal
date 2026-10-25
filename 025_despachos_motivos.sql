-- =============================================================================
-- 025_despachos_motivos.sql
-- Plataforma L&S · Portal de Despachos · 24-oct-2026
--
-- QUÉ HACE
--  "Proceso" pasa a llamarse "Motivo" en el portal. Se guarda en la misma
--  columna despachos.solicitudes.proceso (no se renombra para no romper vistas
--  ni consultas). Motivos permitidos:
--    VARIOS, RAPPI, MP        → todos los campos obligatorios (PDF / Excel)
--    LUEGO PAGO, FARMATODO    → sin datos de cliente: NIT, nombre, dirección,
--                               teléfono, ciudad y departamento se llenan con
--                               la palabra del motivo (lo hace el portal).
--  Las solicitudes ya radicadas con RAPPI / MP / VARIOS no cambian.
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere haber ejecutado antes 017 a 024.
-- =============================================================================
BEGIN;

ALTER TABLE despachos.solicitudes DROP CONSTRAINT IF EXISTS ck_solicitudes_proceso;
ALTER TABLE despachos.solicitudes ADD  CONSTRAINT ck_solicitudes_proceso
  CHECK (proceso IS NULL OR proceso IN ('VARIOS', 'RAPPI', 'LUEGO PAGO', 'FARMATODO', 'MP'));

COMMENT ON COLUMN despachos.solicitudes.proceso IS
  'MOTIVO de la solicitud: VARIOS | RAPPI | LUEGO PAGO | FARMATODO | MP (obligatorio en el portal). LUEGO PAGO y FARMATODO no exigen datos de cliente.';

CREATE OR REPLACE FUNCTION despachos.fn_crear_solicitud(
  p_idempotency_key    uuid,
  p_area_solicitante   text,
  p_solicitante_nombre text,
  p_solicitante_correo text,
  p_origen             text,
  p_lineas             jsonb,
  p_numero_pedido_origen text  DEFAULT NULL,
  p_archivo_origen     text  DEFAULT NULL,
  p_datos_origen       jsonb DEFAULT NULL,
  p_observaciones      text  DEFAULT NULL,
  p_proceso            text  DEFAULT NULL
)
RETURNS TABLE (solicitud_id bigint, numero text, radicada_at timestamptz,
               total_lineas integer, total_unidades numeric, es_reintento boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid   := auth.uid();
  v_cuenta   bigint := core.fn_mi_cuenta();
  v_id       bigint;
  v_numero   text;
  v_lineas   integer;
  v_unidades numeric;
  v_dup      text;
  v_seq      bigint;
  v_proceso  text := NULLIF(upper(trim(p_proceso)), '');
BEGIN
  -- 1) Autorización
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'DSP001: sesión no válida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['solicitante','operador','admin']) THEN
    RAISE EXCEPTION 'DSP002: el usuario no tiene permiso para radicar solicitudes' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2) Idempotencia: si este envío ya se procesó, devolver el mismo resultado
  RETURN QUERY
    SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, true
    FROM despachos.solicitudes s
    WHERE s.idempotency_key = p_idempotency_key AND s.solicitante_id = v_uid;
  IF FOUND THEN RETURN; END IF;

  -- 3) Validación del encabezado
  IF COALESCE(trim(p_area_solicitante),'') = '' OR COALESCE(trim(p_solicitante_nombre),'') = '' THEN
    RAISE EXCEPTION 'DSP003: área solicitante y solicitante son obligatorios' USING ERRCODE = 'check_violation';
  END IF;
  IF v_proceso IS NOT NULL AND v_proceso NOT IN ('VARIOS','RAPPI','LUEGO PAGO','FARMATODO','MP') THEN
    RAISE EXCEPTION 'DSP010: motivo inválido (%). Use Varios, Rappi, Luego Pago, Farmatodo o MP', p_proceso USING ERRCODE = 'check_violation';
  END IF;
  IF p_origen NOT IN ('MANUAL','PDF','EXCEL') THEN
    RAISE EXCEPTION 'DSP004: origen inválido (%)', p_origen USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'DSP005: la solicitud no tiene líneas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lineas) > 5000 THEN
    RAISE EXCEPTION 'DSP006: máximo 5000 líneas por solicitud' USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Validación de líneas (en tabla temporal de la transacción)
  CREATE TEMP TABLE IF NOT EXISTS tmp_lineas_v3 (
    linea_nro integer, entrega text, destinatario_nit text, destinatario_nombre text,
    destinatario_ciudad text, material text, producto_descripcion text, cantidad numeric,
    um text, item integer, bodega text, precio_unitario numeric, descuento_pct numeric,
    subtotal numeric, total numeric,
    ean text, direccion text, departamento text, telefono text, observaciones text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_lineas_v3;

  INSERT INTO pg_temp.tmp_lineas_v3
  SELECT o.ord::integer,
         upper(trim(l.entrega)), trim(l.destinatario), upper(trim(l.nombre)),
         upper(trim(l.lugar)),   upper(trim(l.material)), l.producto,
         l.cantidad, COALESCE(NULLIF(upper(trim(l.um)),''),'BUL'),
         l.item, NULLIF(trim(l.bodega),''),
         l.precio, l.descuento_pct, l.subtotal, l.total,
         NULLIF(trim(l.ean),''), NULLIF(upper(trim(l.direccion)),''),
         NULLIF(upper(trim(l.departamento)),''), NULLIF(trim(l.telefono),''),
         NULLIF(trim(l.observaciones),'')
  FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS l(entrega text, destinatario text, nombre text, lugar text,
                                    material text, producto text, cantidad numeric, um text,
                                    item integer, bodega text, precio numeric,
                                    descuento_pct numeric, subtotal numeric, total numeric,
                                    ean text, direccion text, departamento text, telefono text,
                                    observaciones text);

  SELECT string_agg(format('fila %s', t.linea_nro), ', ' ORDER BY t.linea_nro) INTO v_dup
  FROM pg_temp.tmp_lineas_v3 t
  WHERE COALESCE(t.entrega,'') = '' OR COALESCE(t.destinatario_nit,'') = ''
     OR COALESCE(t.destinatario_nombre,'') = '' OR COALESCE(t.destinatario_ciudad,'') = ''
     OR COALESCE(t.material,'') = '' OR t.cantidad IS NULL OR t.cantidad <= 0;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP007: campos obligatorios vacíos o cantidad <= 0 en %', v_dup USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('Entrega %s + Material %s', d.entrega, d.material), '; ') INTO v_dup
  FROM (SELECT t.entrega, t.material FROM pg_temp.tmp_lineas_v3 t
        GROUP BY t.entrega, t.material HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP008: líneas duplicadas: %', v_dup USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*), sum(t.cantidad) INTO v_lineas, v_unidades FROM pg_temp.tmp_lineas_v3 t;

  -- 5) Encabezado con consecutivo de la secuencia (único aunque radiquen 100 a la vez)
  --    Formato DSE-NNNNNN (10 caracteres). DSE = sede La Estrella.
  --    Sigue la MISMA secuencia de los DSP-AAAA-NNNNNN anteriores: no se pierde
  --    ni se repite la numeración. Futuras sedes: DS + letra de la sede.
  v_seq := nextval('despachos.seq_solicitud_numero');
  IF v_seq > 999999 THEN
    RAISE EXCEPTION 'DSP011: se agotó el consecutivo DSE (999999). Defina el nuevo formato.' USING ERRCODE = 'program_limit_exceeded';
  END IF;
  v_numero := 'DSE-' || lpad(v_seq::text, 6, '0');

  INSERT INTO despachos.solicitudes AS s (
    numero, idempotency_key, cuenta_id, origen, area_solicitante,
    solicitante_id, solicitante_nombre, solicitante_correo,
    numero_pedido_origen, archivo_origen, datos_origen,
    total_lineas, total_unidades, observaciones, proceso, created_by)
  VALUES (
    v_numero, p_idempotency_key, v_cuenta, p_origen, upper(trim(p_area_solicitante)),
    v_uid, upper(trim(p_solicitante_nombre)), lower(trim(p_solicitante_correo)),
    NULLIF(trim(p_numero_pedido_origen),''), p_archivo_origen, p_datos_origen,
    v_lineas, v_unidades, p_observaciones, v_proceso, v_uid)
  ON CONFLICT ON CONSTRAINT uq_solicitudes_idempotency_key DO NOTHING
  RETURNING s.id INTO v_id;

  IF v_id IS NULL THEN
    -- Carrera: otro request con la misma llave ganó la inserción → devolver ese
    RETURN QUERY
      SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, true
      FROM despachos.solicitudes s
      WHERE s.idempotency_key = p_idempotency_key AND s.solicitante_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DSP009: llave de idempotencia ya usada por otro usuario' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN;
  END IF;

  -- 6) Líneas + enlace al maestro de destinatarios y al maestro Item/EAN.
  --    Lo que viene digitado manda; si viene vacío se completa con el maestro.
  INSERT INTO despachos.solicitud_lineas (
    solicitud_id, linea_nro, entrega, destinatario_id, destinatario_nit,
    destinatario_nombre, destinatario_ciudad, material, producto_descripcion,
    cantidad, um, item, bodega, precio_unitario, descuento_pct, subtotal, total, created_by,
    ean, destinatario_direccion, destinatario_departamento, destinatario_telefono, observaciones)
  SELECT v_id, t.linea_nro, t.entrega, d.id, t.destinatario_nit,
         t.destinatario_nombre, t.destinatario_ciudad, t.material, t.producto_descripcion,
         t.cantidad, t.um, t.item, t.bodega, t.precio_unitario, t.descuento_pct,
         t.subtotal, t.total, v_uid,
         COALESCE(t.ean, ie.ean), COALESCE(t.direccion, d.direccion),
         COALESCE(t.departamento, d.departamento, core.fn_departamento_de_ciudad(t.destinatario_ciudad)),
         COALESCE(t.telefono, d.telefono), t.observaciones
  FROM pg_temp.tmp_lineas_v3 t
  LEFT JOIN core.destinatarios d
         ON d.nit = t.destinatario_nit AND d.activo
        AND d.cuenta_id IS NOT DISTINCT FROM v_cuenta
  LEFT JOIN LATERAL (
         SELECT x.ean FROM core.item_ean x
          WHERE x.activo AND (x.cuenta_id IS NULL OR x.cuenta_id = v_cuenta)
            AND x.item IN (t.material, core.fn_sku_base(t.material))
          ORDER BY (x.item = t.material) DESC, x.id
          LIMIT 1) ie ON true
  ORDER BY t.linea_nro;

  -- 7) Primer evento de la línea de tiempo
  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  VALUES (v_id, NULL, 'RADICADA', 'Radicada desde el portal (' || p_origen || ')', v_uid);

  RETURN QUERY
    SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, false
    FROM despachos.solicitudes s WHERE s.id = v_id;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
