-- =============================================================================
-- 032_consentimiento_inventario.sql
-- Plataforma L&S · Portal de Despachos · 29-oct-2026
--
-- QUÉ HACE
--  Constancia de que el solicitante aceptó la alerta de inventario ANTES de
--  cargar un pedido (Carga de pedidos: plantilla Excel o PDF).
--  1. despachos.consentimiento_textos: el texto oficial, con número de versión.
--     Se guarda en la base: lo que se acepta es el texto de la base, no lo que
--     mande el navegador.
--  2. despachos.consentimientos: una fila por cada aceptación (quién, cuándo,
--     versión y texto exacto, Excel/PDF, archivo) y la solicitud DSE-… en la
--     que terminó (se enlaza al radicar).
--  3. Funciones (únicas vías de escritura):
--       despachos.fn_registrar_consentimiento(version, origen, archivo) → id
--       despachos.fn_vincular_consentimiento(consentimiento_id, solicitud_id)
--  4. Vistas vw_solicitudes y vw_solicitud_lineas: + consentimiento_at y
--     consentimiento_version (columnas nuevas AL FINAL).
--  5. Mensaje de permisos de maestros: "clientes" → "maestros" (aplica también
--     a Artículos).
--
-- SEGURIDAD DE EJECUCIÓN (lecciones del 27-oct)
--  · statement_timeout 30 s y lock_timeout 5 s.
--  · No recorre tablas: solo crea objetos. Las vistas cruzan por igualdad
--    (c.solicitud_id = s.id) con índice único.
--  · Probado con 20.000 líneas y 5.000 solicitudes (ver LEEME).
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere 017 a 031. Ejecutar fuera de hora pico; si sale "lock timeout",
--  esperar un minuto y repetir.
-- =============================================================================
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Texto oficial versionado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despachos.consentimiento_textos (
  version     smallint    NOT NULL,
  titulo      text        NOT NULL,
  texto       text        NOT NULL,
  vigente     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_consentimiento_textos PRIMARY KEY (version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consentimiento_textos_vigente
  ON despachos.consentimiento_textos (vigente) WHERE vigente;
COMMENT ON TABLE despachos.consentimiento_textos IS
  'Texto de la alerta de inventario que acepta el solicitante. Una versión vigente.';

INSERT INTO despachos.consentimiento_textos (version, titulo, texto, vigente) VALUES (1,
  'Valide el inventario antes de radicar.',
  'Si radica sin validar el inventario disponible, el pedido queda autorizado para prepararse y despacharse con las cantidades existentes con las que cuenta el OPL. '
  || 'Recuerde que hay solicitudes pendientes por delante que pueden comprometer las cantidades que usted está solicitando. '
  || 'Si el pedido no está autorizado para ejecutarse de forma parcial, por favor no lo radique y consulte la disponibilidad con el OPL.',
  true)
ON CONFLICT (version) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Aceptaciones
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despachos.consentimientos (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  version       smallint    NOT NULL,
  titulo        text        NOT NULL,           -- copia del texto aceptado (no cambia aunque cambie la versión)
  texto         text        NOT NULL,
  perfil_id     uuid        NOT NULL,
  nombre        text,
  correo        text,
  origen        text        NOT NULL,
  archivo       text,
  aceptado_at   timestamptz NOT NULL DEFAULT now(),
  solicitud_id  bigint,
  vinculado_at  timestamptz,
  CONSTRAINT pk_consentimientos PRIMARY KEY (id),
  CONSTRAINT fk_consentimientos_texto     FOREIGN KEY (version)      REFERENCES despachos.consentimiento_textos (version),
  CONSTRAINT fk_consentimientos_perfil    FOREIGN KEY (perfil_id)    REFERENCES core.perfiles (id),
  CONSTRAINT fk_consentimientos_solicitud FOREIGN KEY (solicitud_id) REFERENCES despachos.solicitudes (id),
  CONSTRAINT ck_consentimientos_origen    CHECK (origen IN ('EXCEL', 'PDF'))
);
-- Una solicitud tiene a lo sumo un consentimiento (permite el LEFT JOIN de las vistas sin duplicar filas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_consentimientos_solicitud ON despachos.consentimientos (solicitud_id) WHERE solicitud_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_consentimientos_perfil ON despachos.consentimientos (perfil_id, aceptado_at DESC);
CREATE INDEX IF NOT EXISTS ix_consentimientos_fecha  ON despachos.consentimientos (aceptado_at DESC);
COMMENT ON TABLE despachos.consentimientos IS
  'Constancia de aceptación de la alerta de inventario antes de cargar un pedido (Excel/PDF). Enlazada a la solicitud radicada.';

-- Solo lectura por API; escritura únicamente por las funciones
REVOKE ALL ON despachos.consentimiento_textos, despachos.consentimientos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON despachos.consentimiento_textos, despachos.consentimientos TO authenticated;
GRANT ALL ON despachos.consentimiento_textos, despachos.consentimientos TO service_role;
ALTER TABLE despachos.consentimiento_textos ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos.consentimientos       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_consentimiento_textos_leer ON despachos.consentimiento_textos;
CREATE POLICY pol_consentimiento_textos_leer ON despachos.consentimiento_textos FOR SELECT TO authenticated
  USING ((SELECT core.fn_rol_en('DESPACHOS')) IS NOT NULL);

-- El solicitante ve los suyos; operador / consulta / admin ven todos
DROP POLICY IF EXISTS pol_consentimientos_leer ON despachos.consentimientos;
CREATE POLICY pol_consentimientos_leer ON despachos.consentimientos FOR SELECT TO authenticated
  USING (perfil_id = (SELECT auth.uid())
         OR (SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador', 'consulta', 'admin'])));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Funciones
-- ─────────────────────────────────────────────────────────────────────────────
-- Registra la aceptación con el texto de la BASE (versión vigente o la indicada)
CREATE OR REPLACE FUNCTION despachos.fn_registrar_consentimiento(
  p_version smallint, p_origen text, p_archivo text DEFAULT NULL)
RETURNS TABLE (id bigint, version smallint, aceptado_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t   record;
  v_id  bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DSP001: sesión no válida' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['solicitante', 'operador', 'admin']) THEN
    RAISE EXCEPTION 'DSP002: el usuario no tiene permiso para radicar solicitudes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_origen IS NULL OR p_origen NOT IN ('EXCEL', 'PDF') THEN
    RAISE EXCEPTION 'DSP020: origen del consentimiento inválido (%)', p_origen USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.version, t.titulo, t.texto INTO v_t
  FROM despachos.consentimiento_textos t
  WHERE (p_version IS NULL AND t.vigente) OR t.version = p_version
  ORDER BY t.vigente DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DSP021: no existe el texto de consentimiento (versión %)', p_version USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO despachos.consentimientos (version, titulo, texto, perfil_id, nombre, correo, origen, archivo)
  SELECT v_t.version, v_t.titulo, v_t.texto, v_uid, p.nombre, p.email, p_origen, NULLIF(left(trim(p_archivo), 255), '')
  FROM core.perfiles p WHERE p.id = v_uid
  RETURNING despachos.consentimientos.id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'DSP022: perfil no encontrado' USING ERRCODE = 'no_data_found'; END IF;

  RETURN QUERY SELECT c.id, c.version, c.aceptado_at FROM despachos.consentimientos c WHERE c.id = v_id;
END;
$$;

-- Enlaza la aceptación con la solicitud radicada (misma persona; una sola vez)
CREATE OR REPLACE FUNCTION despachos.fn_vincular_consentimiento(p_consentimiento_id bigint, p_solicitud_id bigint)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DSP001: sesión no válida' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT EXISTS (SELECT 1 FROM despachos.solicitudes s WHERE s.id = p_solicitud_id AND s.solicitante_id = v_uid) THEN
    RAISE EXCEPTION 'DSP023: la solicitud no existe o no es suya' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Idempotente: si ya está enlazado a esta solicitud, no hace nada
  IF EXISTS (SELECT 1 FROM despachos.consentimientos c WHERE c.solicitud_id = p_solicitud_id) THEN RETURN; END IF;

  UPDATE despachos.consentimientos c
  SET solicitud_id = p_solicitud_id, vinculado_at = now()
  WHERE c.id = p_consentimiento_id AND c.perfil_id = v_uid AND c.solicitud_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DSP024: consentimiento inválido o ya usado en otra solicitud' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION despachos.fn_registrar_consentimiento(smallint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_vincular_consentimiento(bigint, bigint)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_registrar_consentimiento(smallint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_vincular_consentimiento(bigint, bigint)        TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Vistas: + consentimiento (columnas nuevas AL FINAL; el resto igual al 023)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW despachos.vw_solicitudes
WITH (security_invoker = true) AS
SELECT s.id, s.numero, s.version, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo,
       s.numero_pedido_origen, s.total_lineas, s.total_unidades,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.anulado_at, s.motivo_anulacion, s.cuenta_id,
       s.lote_id, l.numero AS lote_numero, s.procesada_at,
       s.proceso,
       c.aceptado_at AS consentimiento_at, c.version AS consentimiento_version
FROM despachos.solicitudes s
JOIN despachos.estados e ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes l ON l.id = s.lote_id
LEFT JOIN despachos.consentimientos c ON c.solicitud_id = s.id;

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
       c.aceptado_at AS consentimiento_at, c.version AS consentimiento_version
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
JOIN despachos.estados e     ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes lt ON lt.id = s.lote_id
LEFT JOIN despachos.consentimientos c ON c.solicitud_id = s.id;

GRANT SELECT ON despachos.vw_solicitudes, despachos.vw_solicitud_lineas TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Mensaje de permisos de los maestros (Clientes y Artículos)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_exigir_supervisor()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['operador', 'admin']) THEN
    RAISE EXCEPTION 'CORE110: solo el supervisor (operador) o el administrador gestionan los maestros (clientes y artículos)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
