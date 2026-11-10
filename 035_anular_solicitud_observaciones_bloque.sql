-- =============================================================================
-- 035_anular_solicitud_observaciones_bloque.sql
-- Plataforma L&S · Portal de Despachos · 10-nov-2026
-- Requerimientos "9_Mejoras_Nov_10_2026_parte1"
--
-- QUÉ HACE
--  1. ANULAR una solicitud (req. 2). Práctica estándar de los sistemas de pedidos
--     (SAP «motivo de rechazo», Oracle Order Management «cancel reason»):
--       · un solo estado final ANULADA (ya existía en el catálogo desde 017);
--       · solo antes de procesar: se anula si está RADICADA. Una PROCESADA ya
--         salió en un bloque/Excel: primero el administrador revierte el bloque;
--       · motivo OBLIGATORIO de más de 10 caracteres;
--       · nunca se borra: queda quién, cuándo, el motivo y el evento en la línea
--         de tiempo; las anuladas no se pueden procesar.
--     Quién: el solicitante (solo las suyas), operador (supervisor) y admin.
--     despachos.fn_anular_solicitud(id, motivo)
--  2. vw_lote_lineas: + observacion_linea y observacion_general (req. 3, Excel
--     del bloque, hoja DESPACHO). Columnas nuevas al final.
--  3. vw_solicitud_lineas: + motivo_anulacion (se ve al pasar sobre «Anulada»).
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar SOLO este bloque → Run.
--  Idempotente. Requiere 017 a 034. Publicar el portal después.
-- =============================================================================
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estado ANULADA vuelve a ser asignable (019 lo dejó solo para historial)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE despachos.estados SET activo = true, orden = 30, es_final = true WHERE codigo = 'ANULADA';

CREATE OR REPLACE FUNCTION despachos.fn_anular_solicitud(p_solicitud_id bigint, p_motivo text)
RETURNS TABLE (solicitud_id bigint, numero text, estado_codigo text, anulado_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid    uuid   := auth.uid();
  v_cuenta bigint := core.fn_mi_cuenta();
  v_motivo text   := trim(regexp_replace(COALESCE(p_motivo, ''), '\s+', ' ', 'g'));
  v_sol    record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DSP001: sesión no válida' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['solicitante', 'operador', 'admin']) THEN
    RAISE EXCEPTION 'DSP041: no tiene permiso para anular solicitudes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(v_motivo) <= 10 THEN
    RAISE EXCEPTION 'DSP042: escriba el motivo de la anulación (más de 10 caracteres)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.id, s.numero, s.estado_codigo, s.solicitante_id, s.cuenta_id INTO v_sol
  FROM despachos.solicitudes s
  WHERE s.id = p_solicitud_id AND (v_cuenta IS NULL OR s.cuenta_id = v_cuenta)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DSP011: la solicitud % no existe', p_solicitud_id USING ERRCODE = 'no_data_found'; END IF;

  -- El solicitante solo anula las suyas; operador y admin, cualquiera de su cuenta
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['operador', 'admin']) AND v_sol.solicitante_id <> v_uid THEN
    RAISE EXCEPTION 'DSP043: solo puede anular sus propias solicitudes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_sol.estado_codigo <> 'RADICADA' THEN
    RAISE EXCEPTION 'DSP044: la solicitud % está %: solo se anula una solicitud Radicada%', v_sol.numero, initcap(v_sol.estado_codigo),
      CASE WHEN v_sol.estado_codigo = 'PROCESADA' THEN ' (un administrador debe revertir primero su bloque)' ELSE '' END
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE despachos.solicitudes s
     SET estado_codigo = 'ANULADA', anulado_at = now(), anulado_by = v_uid, motivo_anulacion = v_motivo
   WHERE s.id = v_sol.id;

  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  VALUES (v_sol.id, 'RADICADA', 'ANULADA', 'Anulada por ' || COALESCE(core.fn_mi_nombre(), 'usuario') || ' · ' || v_motivo, v_uid);

  RETURN QUERY SELECT s.id, s.numero, s.estado_codigo, s.anulado_at FROM despachos.solicitudes s WHERE s.id = v_sol.id;
END;
$$;
COMMENT ON FUNCTION despachos.fn_anular_solicitud(bigint, text) IS
  'Anula una solicitud RADICADA (motivo > 10 caracteres). Solicitante: solo las suyas; operador/admin: las de su cuenta. No borra nada.';
REVOKE ALL ON FUNCTION despachos.fn_anular_solicitud(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_anular_solicitud(bigint, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Líneas del bloque: + observaciones (al final; el resto igual al 031)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW despachos.vw_lote_lineas
WITH (security_invoker = true) AS
SELECT s.lote_id, s.id AS solicitud_id, s.numero AS solicitud_numero, s.area_solicitante,
       s.solicitante_nombre, s.origen, s.numero_pedido_origen, s.radicada_at,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_ciudad, li.material, li.producto_descripcion, li.cantidad, li.um, li.item, li.bodega,
       s.solicitante_correo, li.ean, li.destinatario_direccion, li.destinatario_departamento,
       li.destinatario_telefono,
       s.proceso,
       li.observaciones AS observacion_linea,
       s.observaciones  AS observacion_general
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
WHERE s.lote_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Líneas de solicitudes: + motivo_anulacion (al final; el resto igual al 034)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW despachos.vw_solicitud_lineas
WITH (security_invoker = true) AS
SELECT s.id AS solicitud_id, s.numero, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo, s.numero_pedido_origen,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.lote_id, lt.numero AS lote_numero,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_direccion, li.destinatario_ciudad, li.destinatario_departamento,
       li.destinatario_telefono, li.material, li.ean, li.producto_descripcion,
       li.cantidad, li.um, li.item, li.bodega, s.cuenta_id,
       s.proceso, li.observaciones,
       c.aceptado_at AS consentimiento_at, c.version AS consentimiento_version,
       s.observaciones AS observacion_general,
       s.motivo_anulacion
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
JOIN despachos.estados e     ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes lt ON lt.id = s.lote_id
LEFT JOIN despachos.consentimientos c ON c.solicitud_id = s.id;

GRANT SELECT ON despachos.vw_lote_lineas, despachos.vw_solicitud_lineas TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN (opcional)
-- SELECT codigo, activo FROM despachos.estados ORDER BY orden;          → ANULADA activo = true
-- SELECT * FROM despachos.fn_anular_solicitud(<id>, 'Cliente canceló el pedido por teléfono');
