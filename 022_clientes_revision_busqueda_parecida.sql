-- =============================================================================
-- 022_clientes_revision_busqueda_parecida.sql
-- Plataforma L&S · Portal de Despachos · Toma de pedidos fase 5 (22-oct-2026)
--
-- QUÉ HACE
--  1. Maestro de clientes (core.destinatarios) con REVISIÓN:
--       estado_revision  PENDIENTE | APROBADO | RECHAZADO
--       origen           MAESTRO (carga inicial) | DESPACHOS (popup) | CLIENTES (pantalla)
--     Todo lo que ya existe queda APROBADO / MAESTRO.
--  2. Búsqueda por PARECIDO (pg_trgm): ignora tildes, mayúsculas, signos,
--     "S.A.S / SAS / LTDA…" y pequeños errores de digitación.
--       despachos.fn_buscar_clientes_parecidos(texto, limite)
--  3. Crear cliente desde la pantalla Despachos (popup) → queda PENDIENTE y
--     se puede radicar con él de inmediato. Cualquier rol de Despachos.
--       despachos.fn_crear_cliente_despachos(nit, nombre, dirección, ciudad, departamento, teléfono)
--  4. Pantalla Clientes (solo operador = supervisor, y admin):
--       despachos.fn_guardar_cliente(...)          crear / editar
--       despachos.fn_revisar_cliente(id, aprobar, nota)  aprobar o rechazar con nota
--       despachos.fn_inactivar_cliente(id, activo)  inactivar / reactivar
--       despachos.fn_borrar_cliente(id)             borrar DEFINITIVO, solo si NO
--                                                   tiene solicitudes
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere haber ejecutado antes 017 a 021.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas de revisión en el maestro de clientes
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS estado_revision      text NOT NULL DEFAULT 'APROBADO';
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS origen               text NOT NULL DEFAULT 'MAESTRO';
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS creado_por_nombre    text;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS revisado_at          timestamptz;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS revisado_by          uuid;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS revisado_por_nombre  text;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS nota_revision        text;

ALTER TABLE core.destinatarios DROP CONSTRAINT IF EXISTS ck_destinatarios_estado_revision;
ALTER TABLE core.destinatarios ADD  CONSTRAINT ck_destinatarios_estado_revision
  CHECK (estado_revision IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));
ALTER TABLE core.destinatarios DROP CONSTRAINT IF EXISTS ck_destinatarios_origen;
ALTER TABLE core.destinatarios ADD  CONSTRAINT ck_destinatarios_origen
  CHECK (origen IN ('MAESTRO', 'DESPACHOS', 'CLIENTES'));

CREATE INDEX IF NOT EXISTS ix_destinatarios_pendientes
  ON core.destinatarios (created_at DESC) WHERE estado_revision = 'PENDIENTE';

COMMENT ON COLUMN core.destinatarios.estado_revision IS 'PENDIENTE = creado en Despachos, falta revisión del supervisor; APROBADO; RECHAZADO (queda inactivo)';
COMMENT ON COLUMN core.destinatarios.origen IS 'MAESTRO = carga inicial · DESPACHOS = creado desde el popup · CLIENTES = creado en la pantalla Clientes';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Comparación de nombres
--    'MÁQUINA DISPENSADORA TITÁN PLAZA S.A.S.' → 'maquina dispensadora titan plaza'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.fn_nombre_comparable(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(trim(regexp_replace(
           regexp_replace(
             ' ' || COALESCE(core.fn_normalizar_texto(p), '') || ' ',
             -- sufijos societarios (con o sin puntos: "s a s", "sas", "ltda"…)
             ' (s a s|sas|s a|sa|ltda|limitada|e u|eu|s en c|sociedad|y cia|cia|bic|s c a|sca|e s p|esp) ', ' ', 'g'),
           ' (s a s|sas|s a|sa|ltda|limitada|e u|eu|bic) ', ' ', 'g')), '')
$$;
COMMENT ON FUNCTION core.fn_nombre_comparable(text) IS 'Nombre sin tildes, signos ni sufijos societarios: base de la búsqueda por parecido';

-- Solo dígitos y letras del NIT: '901.443.866-0' → '9014438660'
CREATE OR REPLACE FUNCTION core.fn_nit_limpio(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

-- Nombre de quien hace la operación (para mostrar en pantalla sin exponer perfiles)
CREATE OR REPLACE FUNCTION core.fn_mi_nombre()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(NULLIF(trim(nombre), ''), email) FROM core.perfiles WHERE id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Búsqueda por parecido (lupa de Despachos)
--    Puntaje 0..1: 1 = contiene el texto; si no, similitud de trigramas.
--    Busca también por NIT (con o sin dígito de verificación).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_buscar_clientes_parecidos(p_texto text, p_limite integer DEFAULT 30)
RETURNS TABLE (id bigint, nit text, nombre text, direccion text, ciudad text, departamento text,
               telefono text, estado_revision text, similitud numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_q      text := core.fn_nombre_comparable(p_texto);
  v_nit    text := core.fn_nit_limpio(p_texto);
  v_cuenta bigint := core.fn_mi_cuenta();
BEGIN
  IF core.fn_rol_en('DESPACHOS') IS NULL THEN
    RAISE EXCEPTION 'CORE101: no tiene acceso a Despachos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_q IS NULL OR length(v_q) < 2 THEN RETURN; END IF;

  RETURN QUERY
  WITH c AS (
    SELECT d.*, core.fn_nombre_comparable(d.nombre) AS nc
    FROM core.destinatarios d
    WHERE d.activo AND d.estado_revision <> 'RECHAZADO'
      AND (v_cuenta IS NULL OR d.cuenta_id = v_cuenta)
  ), p AS (
    SELECT c.*,
      GREATEST(
        CASE WHEN c.nc LIKE '%' || v_q || '%' THEN 1.0 ELSE 0 END,
        CASE WHEN v_nit ~ '^[0-9]{5,}$' AND core.fn_nit_limpio(c.nit) LIKE v_nit || '%' THEN 1.0 ELSE 0 END,
        extensions.word_similarity(v_q, c.nc)::numeric,
        extensions.similarity(v_q, c.nc)::numeric
      ) AS puntaje
    FROM c
  )
  SELECT p.id, p.nit, p.nombre, p.direccion, p.ciudad, p.departamento, p.telefono,
         p.estado_revision, round(p.puntaje, 2)
  FROM p
  WHERE p.puntaje >= 0.45
  ORDER BY p.puntaje DESC, p.nombre
  LIMIT LEAST(GREATEST(COALESCE(p_limite, 30), 1), 200);
END;
$$;
COMMENT ON FUNCTION despachos.fn_buscar_clientes_parecidos(text, integer) IS
  'Clientes con nombre parecido (sin tildes, sufijos ni errores menores) o NIT que empieza igual. Ordenados del más parecido al menos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Crear cliente desde Despachos (popup) → PENDIENTE de revisión
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_crear_cliente_despachos(
  p_nit text, p_nombre text, p_direccion text DEFAULT NULL, p_ciudad text DEFAULT NULL,
  p_departamento text DEFAULT NULL, p_telefono text DEFAULT NULL)
RETURNS TABLE (id bigint, nit text, nombre text, direccion text, ciudad text, departamento text,
               telefono text, estado_revision text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nit    text := core.fn_nit_limpio(p_nit);
  v_nombre text := NULLIF(upper(trim(regexp_replace(COALESCE(p_nombre, ''), '\s+', ' ', 'g'))), '');
  v_cuenta bigint := core.fn_mi_cuenta();
  v_existe record;
  v_id     bigint;
BEGIN
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['solicitante', 'operador', 'admin']) THEN
    RAISE EXCEPTION 'CORE102: no tiene permiso para crear clientes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_nit IS NULL OR length(v_nit) < 5 THEN
    RAISE EXCEPTION 'CORE103: digite un NIT válido (mínimo 5 dígitos, sin puntos)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'CORE104: el nombre del cliente es obligatorio' USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.nit, d.nombre, d.activo, d.estado_revision INTO v_existe
  FROM core.destinatarios d
  WHERE core.fn_nit_limpio(d.nit) = v_nit AND d.cuenta_id IS NOT DISTINCT FROM v_cuenta
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'CORE105: el NIT % ya existe como «%»%. Búsquelo con la lupa y selecciónelo.',
      v_existe.nit, v_existe.nombre, CASE WHEN v_existe.activo THEN '' ELSE ' (inactivo: pida al supervisor reactivarlo)' END
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO core.destinatarios (cuenta_id, nit, nombre, direccion, ciudad, departamento, telefono,
                                  estado_revision, origen, creado_por_nombre, created_by)
  VALUES (v_cuenta, v_nit, v_nombre,
          NULLIF(upper(trim(p_direccion)), ''), NULLIF(upper(trim(p_ciudad)), ''),
          COALESCE(NULLIF(trim(p_departamento), ''), core.fn_departamento_de_ciudad(p_ciudad)),
          NULLIF(regexp_replace(COALESCE(p_telefono, ''), '[^0-9+]', '', 'g'), ''),
          'PENDIENTE', 'DESPACHOS', core.fn_mi_nombre(), auth.uid())
  RETURNING core.destinatarios.id INTO v_id;

  RETURN QUERY
    SELECT d.id, d.nit, d.nombre, d.direccion, d.ciudad, d.departamento, d.telefono, d.estado_revision
    FROM core.destinatarios d WHERE d.id = v_id;
END;
$$;
COMMENT ON FUNCTION despachos.fn_crear_cliente_despachos(text, text, text, text, text, text) IS
  'Popup de Despachos: crea el cliente PENDIENTE de revisión (se puede radicar con él de inmediato).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Pantalla Clientes (operador = supervisor, admin)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_exigir_supervisor()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['operador', 'admin']) THEN
    RAISE EXCEPTION 'CORE110: solo el supervisor (operador) o el administrador gestionan el maestro de clientes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- Crear (p_id NULL) o editar un cliente. Lo creado aquí queda APROBADO.
CREATE OR REPLACE FUNCTION despachos.fn_guardar_cliente(
  p_id bigint, p_nit text, p_nombre text, p_direccion text, p_ciudad text,
  p_departamento text, p_telefono text, p_version integer DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nit    text := core.fn_nit_limpio(p_nit);
  v_nombre text := NULLIF(upper(trim(regexp_replace(COALESCE(p_nombre, ''), '\s+', ' ', 'g'))), '');
  v_cuenta bigint;
  v_actual record;
  v_otro   text;
  v_id     bigint;
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF v_nit IS NULL OR length(v_nit) < 5 THEN
    RAISE EXCEPTION 'CORE103: digite un NIT válido (mínimo 5 dígitos, sin puntos)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'CORE104: el nombre del cliente es obligatorio' USING ERRCODE = 'check_violation';
  END IF;

  IF p_id IS NULL THEN
    v_cuenta := core.fn_mi_cuenta();
  ELSE
    SELECT d.* INTO v_actual FROM core.destinatarios d WHERE d.id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORE111: el cliente ya no existe' USING ERRCODE = 'no_data_found'; END IF;
    IF p_version IS NOT NULL AND v_actual.version <> p_version THEN
      RAISE EXCEPTION 'CORE112: otro usuario modificó este cliente. Actualice la pantalla e intente de nuevo.'
        USING ERRCODE = 'serialization_failure';
    END IF;
    v_cuenta := v_actual.cuenta_id;
  END IF;

  SELECT d.nombre INTO v_otro FROM core.destinatarios d
  WHERE core.fn_nit_limpio(d.nit) = v_nit AND d.cuenta_id IS NOT DISTINCT FROM v_cuenta
    AND d.id IS DISTINCT FROM p_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'CORE105: el NIT % ya existe como «%»', v_nit, v_otro USING ERRCODE = 'unique_violation';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO core.destinatarios (cuenta_id, nit, nombre, direccion, ciudad, departamento, telefono,
                                    estado_revision, origen, creado_por_nombre, created_by)
    VALUES (v_cuenta, v_nit, v_nombre, NULLIF(upper(trim(p_direccion)), ''), NULLIF(upper(trim(p_ciudad)), ''),
            COALESCE(NULLIF(trim(p_departamento), ''), core.fn_departamento_de_ciudad(p_ciudad)),
            NULLIF(regexp_replace(COALESCE(p_telefono, ''), '[^0-9+]', '', 'g'), ''),
            'APROBADO', 'CLIENTES', core.fn_mi_nombre(), auth.uid())
    RETURNING core.destinatarios.id INTO v_id;
  ELSE
    UPDATE core.destinatarios d SET
      nit = v_nit, nombre = v_nombre,
      direccion = NULLIF(upper(trim(p_direccion)), ''), ciudad = NULLIF(upper(trim(p_ciudad)), ''),
      departamento = COALESCE(NULLIF(trim(p_departamento), ''), core.fn_departamento_de_ciudad(p_ciudad)),
      telefono = NULLIF(regexp_replace(COALESCE(p_telefono, ''), '[^0-9+]', '', 'g'), '')
    WHERE d.id = p_id
    RETURNING d.id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Revisión: aprobar o rechazar un cliente PENDIENTE (nota obligatoria).
-- Rechazado = inactivo (deja de salir en las búsquedas).
CREATE OR REPLACE FUNCTION despachos.fn_revisar_cliente(p_id bigint, p_aprobar boolean, p_nota text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF NULLIF(trim(COALESCE(p_nota, '')), '') IS NULL THEN
    RAISE EXCEPTION 'CORE113: escriba la nota de la revisión' USING ERRCODE = 'check_violation';
  END IF;
  SELECT d.estado_revision INTO v_estado FROM core.destinatarios d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE111: el cliente ya no existe' USING ERRCODE = 'no_data_found'; END IF;
  IF v_estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'CORE114: este cliente ya fue revisado (%)', v_estado USING ERRCODE = 'check_violation';
  END IF;

  UPDATE core.destinatarios d SET
    estado_revision     = CASE WHEN p_aprobar THEN 'APROBADO' ELSE 'RECHAZADO' END,
    activo              = CASE WHEN p_aprobar THEN d.activo ELSE false END,
    revisado_at         = now(),
    revisado_by         = auth.uid(),
    revisado_por_nombre = core.fn_mi_nombre(),
    nota_revision       = trim(p_nota)
  WHERE d.id = p_id;
  RETURN CASE WHEN p_aprobar THEN 'APROBADO' ELSE 'RECHAZADO' END;
END;
$$;

-- Inactivar (se puede recuperar) o reactivar
CREATE OR REPLACE FUNCTION despachos.fn_inactivar_cliente(p_id bigint, p_activo boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  UPDATE core.destinatarios d SET activo = p_activo WHERE d.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE111: el cliente ya no existe' USING ERRCODE = 'no_data_found'; END IF;
END;
$$;

-- Borrar DEFINITIVO: no se puede recuperar. Bloqueado si el cliente ya tiene solicitudes.
CREATE OR REPLACE FUNCTION despachos.fn_borrar_cliente(p_id bigint)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lineas integer;
  v_nit    text;
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  SELECT d.nit INTO v_nit FROM core.destinatarios d WHERE d.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE111: el cliente ya no existe' USING ERRCODE = 'no_data_found'; END IF;

  SELECT count(*) INTO v_lineas FROM despachos.solicitud_lineas l
  WHERE l.destinatario_id = p_id OR l.destinatario_nit = v_nit;
  IF v_lineas > 0 THEN
    RAISE EXCEPTION 'CORE115: no se puede borrar: el cliente tiene % línea(s) en solicitudes. Puede inactivarlo.', v_lineas
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  DELETE FROM core.destinatarios d WHERE d.id = p_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permisos
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION despachos.fn_buscar_clientes_parecidos(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_crear_cliente_despachos(text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_exigir_supervisor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_guardar_cliente(bigint, text, text, text, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_revisar_cliente(bigint, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_inactivar_cliente(bigint, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_borrar_cliente(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.fn_mi_nombre() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_buscar_clientes_parecidos(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_crear_cliente_despachos(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_guardar_cliente(bigint, text, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_revisar_cliente(bigint, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_inactivar_cliente(bigint, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_borrar_cliente(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_exigir_supervisor() TO authenticated;
GRANT EXECUTE ON FUNCTION core.fn_mi_nombre() TO authenticated;
GRANT EXECUTE ON FUNCTION core.fn_nombre_comparable(text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.fn_nit_limpio(text) TO authenticated;

-- Escritura directa en la tabla: solo por las funciones de arriba (que validan
-- rol, NIT único y revisión). Se cierra el INSERT/UPDATE directo del 017.
REVOKE INSERT, UPDATE, DELETE ON core.destinatarios FROM authenticated;
DROP POLICY IF EXISTS pol_destinatarios_escribir   ON core.destinatarios;
DROP POLICY IF EXISTS pol_destinatarios_actualizar ON core.destinatarios;

COMMIT;

NOTIFY pgrst, 'reload schema';
