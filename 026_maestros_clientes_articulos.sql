-- =============================================================================
-- 026_maestros_clientes_articulos.sql
-- Plataforma L&S · Portal de Despachos · Mejoras 26-oct-2026
--
-- QUÉ HACE
--  1. Clientes: campo TELÉFONO 2 (opcional). El teléfono 1 es obligatorio al
--     crear / editar en la pantalla Clientes y en la carga masiva.
--  2. Carga MASIVA de clientes con plantilla (NIT, NOMBRE, DIRECCION,
--     TELEFONO, CIUDAD, DEPARTAMENTO, TELEFONO 2):
--       despachos.fn_cargar_clientes(filas, aplicar)
--       · aplicar = false → SIMULACIÓN (no cambia nada, solo informa)
--       · aplicar = true  → carga
--     Idempotente con el NIT como llave. El NIT se guarda SIN dígito de
--     verificación (900238615-7 o 9002386157 → 900238615) y se busca de
--     cualquier forma (900238615, 9002386157). Reglas:
--       CREAR        NIT nuevo → se crea APROBADO, origen CARGA_MASIVA
--       ACTUALIZAR   NIT existe con el mismo nombre → se actualizan dirección,
--                    teléfonos, ciudad y departamento (solo los que trae)
--       SIN_CAMBIOS  NIT existe y los datos son iguales
--       DUPLICADO    fila repetida idéntica en el archivo (se carga una vez)
--       NO_CARGADO   NIT existe con OTRO nombre, NIT repetido con datos
--                    distintos, NIT ambiguo o faltan datos obligatorios
--  3. Maestro de artículos (core.item_ean): crear, editar, inactivar y borrar
--     solo por funciones (supervisor = operador, y admin).
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere haber ejecutado antes 017 a 025.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Teléfono 2 y origen CARGA_MASIVA
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS telefono_2 text;
COMMENT ON COLUMN core.destinatarios.telefono_2 IS 'Segundo teléfono / celular (opcional). El teléfono principal va en telefono.';

ALTER TABLE core.destinatarios DROP CONSTRAINT IF EXISTS ck_destinatarios_origen;
ALTER TABLE core.destinatarios ADD  CONSTRAINT ck_destinatarios_origen
  CHECK (origen IN ('MAESTRO', 'DESPACHOS', 'CLIENTES', 'CARGA_MASIVA'));

-- Teléfono limpio: sin el indicativo de Colombia ('+57, +57 o 57 delante de
-- un celular 3XXXXXXXXX o fijo 60XXXXXXXX) y solo dígitos
CREATE OR REPLACE FUNCTION core.fn_telefono_limpio(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(regexp_replace(x, '^57(3[0-9]{9}|60[0-9]{8})$', '\1'), '')
  FROM (SELECT regexp_replace(regexp_replace(COALESCE(p, ''), '^\s*''?\s*\+\s*57', ''), '[^0-9]', '', 'g') AS x) s
$$;

-- NIT sin dígito de verificación:
--   '900238615-7' → '900238615'
--   '9002386157'  → '900238615'  (10 dígitos que empiezan por 8 o 9 = NIT de empresa + DV)
--   cédulas y demás → solo los dígitos
CREATE OR REPLACE FUNCTION core.fn_nit_base(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN x ~ '^[89][0-9]{9}$' THEN left(x, 9) ELSE NULLIF(x, '') END
  FROM (SELECT regexp_replace(split_part(COALESCE(p, ''), '-', 1), '[^0-9]', '', 'g') AS x) s
$$;

-- Nombre limpio: sin *, comillas dobles ni espacios de más
CREATE OR REPLACE FUNCTION core.fn_nombre_limpio(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(trim(regexp_replace(regexp_replace(COALESCE(p, ''), '[*"“”]', '', 'g'), '[\s\u00a0]+', ' ', 'g')), '')
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guardar cliente (pantalla Clientes): + teléfono 2, teléfono obligatorio
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS despachos.fn_guardar_cliente(bigint, text, text, text, text, text, text, integer);

CREATE OR REPLACE FUNCTION despachos.fn_guardar_cliente(
  p_id bigint, p_nit text, p_nombre text, p_direccion text, p_ciudad text,
  p_departamento text, p_telefono text, p_version integer DEFAULT NULL, p_telefono_2 text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nit    text := core.fn_nit_base(p_nit);   -- sin dígito de verificación
  v_nombre text := upper(core.fn_nombre_limpio(p_nombre));
  v_tel    text := core.fn_telefono_limpio(p_telefono);
  v_cuenta bigint;
  v_actual record;
  v_otro   text;
  v_id     bigint;
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF v_nit IS NULL OR length(v_nit) < 5 THEN
    RAISE EXCEPTION 'CORE103: digite un NIT válido (mínimo 5 dígitos, sin dígito de verificación)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'CORE104: el nombre del cliente es obligatorio' USING ERRCODE = 'check_violation';
  END IF;
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'CORE106: el teléfono es obligatorio' USING ERRCODE = 'check_violation';
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
    -- Al editar se conserva el NIT tal como está guardado si el usuario no lo cambió
    IF core.fn_nit_limpio(v_actual.nit) LIKE v_nit || '%' AND length(core.fn_nit_limpio(v_actual.nit)) <= length(v_nit) + 1 THEN
      v_nit := v_actual.nit;
    END IF;
  END IF;

  SELECT d.nombre INTO v_otro FROM core.destinatarios d
  WHERE d.cuenta_id IS NOT DISTINCT FROM v_cuenta AND d.id IS DISTINCT FROM p_id
    AND (core.fn_nit_limpio(d.nit) = v_nit OR core.fn_nit_base(d.nit) = v_nit
         OR (length(v_nit) >= 9 AND length(core.fn_nit_limpio(d.nit)) = length(v_nit) + 1 AND core.fn_nit_limpio(d.nit) LIKE v_nit || '%'))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'CORE105: el NIT % ya existe como «%»', v_nit, v_otro USING ERRCODE = 'unique_violation';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO core.destinatarios (cuenta_id, nit, nombre, direccion, ciudad, departamento, telefono, telefono_2,
                                    estado_revision, origen, creado_por_nombre, created_by)
    VALUES (v_cuenta, v_nit, v_nombre, NULLIF(upper(trim(p_direccion)), ''), NULLIF(upper(trim(p_ciudad)), ''),
            COALESCE(NULLIF(trim(p_departamento), ''), core.fn_departamento_de_ciudad(p_ciudad)),
            v_tel, core.fn_telefono_limpio(p_telefono_2),
            'APROBADO', 'CLIENTES', core.fn_mi_nombre(), auth.uid())
    RETURNING core.destinatarios.id INTO v_id;
  ELSE
    UPDATE core.destinatarios d SET
      nit = v_nit, nombre = v_nombre,
      direccion = NULLIF(upper(trim(p_direccion)), ''), ciudad = NULLIF(upper(trim(p_ciudad)), ''),
      departamento = COALESCE(NULLIF(trim(p_departamento), ''), core.fn_departamento_de_ciudad(p_ciudad)),
      telefono = v_tel, telefono_2 = core.fn_telefono_limpio(p_telefono_2)
    WHERE d.id = p_id
    RETURNING d.id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Carga masiva de clientes (simulación o carga)
--    p_filas: [{fila, nit, nombre, direccion, telefono, ciudad, departamento, telefono_2}]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_cargar_clientes(p_filas jsonb, p_aplicar boolean DEFAULT false)
RETURNS TABLE (fila integer, nit text, nombre text, accion text, detalle text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_cuenta bigint := core.fn_mi_cuenta();
  v_quien  text   := core.fn_mi_nombre();
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'CORE130: la plantilla no tiene filas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'CORE131: máximo 5000 clientes por carga' USING ERRCODE = 'check_violation';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_carga_clientes (
    fila int, nit_raw text, nit_base text, dv text, nombre text, direccion text, telefono text,
    telefono_2 text, ciudad text, departamento text, firma text,
    dest_id bigint, dest_nombre text, accion text, detalle text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_carga_clientes;

  INSERT INTO pg_temp.tmp_carga_clientes (fila, nit_raw, nit_base, dv, nombre, direccion, telefono, telefono_2, ciudad, departamento)
  SELECT COALESCE(x.fila, o.ord::int + 1), trim(x.nit),
         core.fn_nit_base(x.nit),
         NULLIF(regexp_replace(split_part(COALESCE(x.nit, ''), '-', 2), '[^0-9]', '', 'g'), ''),
         core.fn_nombre_limpio(x.nombre),
         NULLIF(trim(regexp_replace(COALESCE(x.direccion, ''), '[\s\u00a0]+', ' ', 'g')), ''),
         core.fn_telefono_limpio(x.telefono), core.fn_telefono_limpio(x.telefono_2),
         NULLIF(trim(regexp_replace(COALESCE(x.ciudad, ''), '[\s\u00a0]+', ' ', 'g')), ''),
         NULLIF(trim(regexp_replace(COALESCE(x.departamento, ''), '[\s\u00a0]+', ' ', 'g')), '')
  FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS x(fila int, nit text, nombre text, direccion text, telefono text,
                                    ciudad text, departamento text, telefono_2 text);

  UPDATE pg_temp.tmp_carga_clientes t SET
    departamento = COALESCE(t.departamento, core.fn_departamento_de_ciudad(t.ciudad)),
    firma = lower(concat_ws('|', core.fn_nombre_comparable(t.nombre), core.fn_normalizar_texto(t.direccion),
                            t.telefono, t.telefono_2, core.fn_normalizar_texto(t.ciudad)));

  -- a) Datos obligatorios
  UPDATE pg_temp.tmp_carga_clientes t SET accion = 'NO_CARGADO',
    detalle = CASE WHEN t.nit_base IS NULL OR length(t.nit_base) < 5 THEN 'NIT inválido o vacío'
                   WHEN t.nombre IS NULL THEN 'Falta el nombre'
                   ELSE 'Falta el teléfono (obligatorio)' END
  WHERE t.nit_base IS NULL OR length(t.nit_base) < 5 OR t.nombre IS NULL OR t.telefono IS NULL;

  -- b) NIT repetido en el archivo: con datos distintos → no se carga; idénticos → una sola vez
  WITH g AS (
    SELECT t.nit_base, count(DISTINCT t.firma) AS firmas, min(t.fila) AS primera,
           string_agg(t.fila::text, ', ' ORDER BY t.fila) AS filas
    FROM pg_temp.tmp_carga_clientes t WHERE t.accion IS NULL
    GROUP BY t.nit_base HAVING count(*) > 1)
  UPDATE pg_temp.tmp_carga_clientes t SET
    accion  = CASE WHEN g.firmas > 1 THEN 'NO_CARGADO' WHEN t.fila <> g.primera THEN 'DUPLICADO' ELSE NULL END,
    detalle = CASE WHEN g.firmas > 1 THEN 'NIT repetido en el archivo con datos distintos (filas ' || g.filas || ')'
                   WHEN t.fila <> g.primera THEN 'Fila repetida igual a la fila ' || g.primera || ': se carga una sola vez' END
  FROM g WHERE t.nit_base = g.nit_base AND t.accion IS NULL;

  -- c) Buscar el NIT en el maestro: exacto, con dígito de verificación, o con un dígito más al final
  UPDATE pg_temp.tmp_carga_clientes t SET dest_id = m.id, dest_nombre = m.nombre,
         accion = CASE WHEN m.n > 1 AND NOT m.exacto THEN 'NO_CARGADO' END,
         detalle = CASE WHEN m.n > 1 AND NOT m.exacto THEN 'NIT ambiguo: existe más de un cliente con ese NIT (' || m.lista || ')' END
  FROM (
    SELECT t2.fila, c.id, c.nombre, c.exacto, c.n, c.lista
    FROM pg_temp.tmp_carga_clientes t2
    CROSS JOIN LATERAL (
      SELECT d.id, d.nombre, (core.fn_nit_limpio(d.nit) = t2.nit_base) AS exacto,
             count(*) OVER () AS n,
             string_agg(d.nit || ' ' || d.nombre, '; ') OVER () AS lista
      FROM core.destinatarios d
      WHERE d.cuenta_id IS NOT DISTINCT FROM v_cuenta
        AND (core.fn_nit_limpio(d.nit) = t2.nit_base
             OR core.fn_nit_base(d.nit) = t2.nit_base
             OR core.fn_nit_limpio(d.nit) = t2.nit_base || COALESCE(t2.dv, '#')
             OR (length(t2.nit_base) >= 9 AND length(core.fn_nit_limpio(d.nit)) = length(t2.nit_base) + 1 AND core.fn_nit_limpio(d.nit) LIKE t2.nit_base || '%'))
      ORDER BY (core.fn_nit_limpio(d.nit) = t2.nit_base) DESC, d.id
      LIMIT 1) c
    WHERE t2.accion IS NULL
  ) m
  WHERE t.fila = m.fila;

  -- d) Existe con OTRO nombre → no se carga
  UPDATE pg_temp.tmp_carga_clientes t SET accion = 'NO_CARGADO',
    detalle = 'El NIT ya existe como «' || t.dest_nombre || '» (nombre distinto)'
  WHERE t.accion IS NULL AND t.dest_id IS NOT NULL
    AND NOT (core.fn_nombre_comparable(t.nombre) = core.fn_nombre_comparable(t.dest_nombre)
             OR core.fn_nombre_comparable(t.nombre) LIKE '%' || core.fn_nombre_comparable(t.dest_nombre) || '%'
             OR core.fn_nombre_comparable(t.dest_nombre) LIKE '%' || core.fn_nombre_comparable(t.nombre) || '%'
             OR extensions.similarity(core.fn_nombre_comparable(t.nombre), core.fn_nombre_comparable(t.dest_nombre)) >= 0.8);

  -- e) Existe con el mismo nombre → actualizar (solo lo que trae el archivo) o sin cambios
  UPDATE pg_temp.tmp_carga_clientes t SET
    accion = CASE WHEN (t.direccion IS NOT NULL AND t.direccion IS DISTINCT FROM d.direccion)
                    OR (t.telefono IS NOT NULL AND t.telefono IS DISTINCT FROM d.telefono)
                    OR (t.telefono_2 IS NOT NULL AND t.telefono_2 IS DISTINCT FROM d.telefono_2)
                    OR (t.ciudad IS NOT NULL AND t.ciudad IS DISTINCT FROM d.ciudad)
                    OR (t.departamento IS NOT NULL AND t.departamento IS DISTINCT FROM d.departamento)
                  THEN 'ACTUALIZAR' ELSE 'SIN_CAMBIOS' END,
    detalle = 'Existe como «' || d.nombre || '» (NIT ' || d.nit || ')' || CASE WHEN NOT d.activo THEN ' · inactivo' ELSE '' END
  FROM core.destinatarios d
  WHERE t.accion IS NULL AND t.dest_id = d.id;

  -- f) Nuevos
  UPDATE pg_temp.tmp_carga_clientes t SET accion = 'CREAR', detalle = 'Cliente nuevo (NIT ' || t.nit_base || ')'
  WHERE t.accion IS NULL AND t.dest_id IS NULL;

  -- Aplicar
  IF p_aplicar THEN
    INSERT INTO core.destinatarios (cuenta_id, nit, nombre, direccion, ciudad, departamento, telefono, telefono_2,
                                    estado_revision, origen, creado_por_nombre, created_by)
    SELECT v_cuenta, t.nit_base, t.nombre, t.direccion, t.ciudad, t.departamento, t.telefono, t.telefono_2,
           'APROBADO', 'CARGA_MASIVA', v_quien, auth.uid()
    FROM pg_temp.tmp_carga_clientes t WHERE t.accion = 'CREAR'
    ORDER BY t.fila;

    UPDATE core.destinatarios d SET
      direccion    = COALESCE(t.direccion, d.direccion),
      telefono     = COALESCE(t.telefono, d.telefono),
      telefono_2   = COALESCE(t.telefono_2, d.telefono_2),
      ciudad       = COALESCE(t.ciudad, d.ciudad),
      departamento = COALESCE(t.departamento, d.departamento)
    FROM pg_temp.tmp_carga_clientes t
    WHERE t.accion = 'ACTUALIZAR' AND t.dest_id = d.id;
  END IF;

  RETURN QUERY
    SELECT t.fila, COALESCE(t.nit_raw, ''), COALESCE(t.nombre, ''), t.accion, t.detalle
    FROM pg_temp.tmp_carga_clientes t ORDER BY t.fila;
END;
$$;
COMMENT ON FUNCTION despachos.fn_cargar_clientes(jsonb, boolean) IS
  'Carga masiva de clientes con plantilla. aplicar=false: simulación. Idempotente por NIT (sin dígito de verificación).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Maestro de artículos (core.item_ean)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_guardar_articulo(
  p_id bigint, p_item text, p_ean text, p_descripcion text, p_version integer DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item   text := NULLIF(upper(regexp_replace(COALESCE(p_item, ''), '\s+', '', 'g')), '');
  v_ean    text := NULLIF(regexp_replace(COALESCE(p_ean, ''), '\s+', '', 'g'), '');
  v_cuenta bigint;
  v_actual record;
  v_otro   text;
  v_id     bigint;
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF v_item IS NULL THEN RAISE EXCEPTION 'CORE140: el Item (SKU) es obligatorio' USING ERRCODE = 'check_violation'; END IF;
  IF v_ean IS NULL THEN RAISE EXCEPTION 'CORE141: el código EAN es obligatorio' USING ERRCODE = 'check_violation'; END IF;

  IF p_id IS NULL THEN
    v_cuenta := core.fn_mi_cuenta();
  ELSE
    SELECT a.* INTO v_actual FROM core.item_ean a WHERE a.id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORE142: el artículo ya no existe' USING ERRCODE = 'no_data_found'; END IF;
    IF p_version IS NOT NULL AND v_actual.version <> p_version THEN
      RAISE EXCEPTION 'CORE143: otro usuario modificó este artículo. Actualice la pantalla e intente de nuevo.' USING ERRCODE = 'serialization_failure';
    END IF;
    v_cuenta := v_actual.cuenta_id;
  END IF;

  SELECT a.ean INTO v_otro FROM core.item_ean a
  WHERE a.item = v_item AND a.cuenta_id IS NOT DISTINCT FROM v_cuenta AND a.id IS DISTINCT FROM p_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'CORE144: el Item % ya existe (EAN %)', v_item, v_otro USING ERRCODE = 'unique_violation'; END IF;

  SELECT a.item INTO v_otro FROM core.item_ean a
  WHERE a.ean = v_ean AND a.activo AND a.cuenta_id IS NOT DISTINCT FROM v_cuenta AND a.id IS DISTINCT FROM p_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'CORE145: el EAN % ya está asignado al Item %', v_ean, v_otro USING ERRCODE = 'unique_violation'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO core.item_ean (cuenta_id, item, ean, descripcion, created_by)
    VALUES (v_cuenta, v_item, v_ean, NULLIF(trim(p_descripcion), ''), auth.uid())
    RETURNING core.item_ean.id INTO v_id;
  ELSE
    UPDATE core.item_ean a SET item = v_item, ean = v_ean, descripcion = NULLIF(trim(p_descripcion), '')
    WHERE a.id = p_id RETURNING a.id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION despachos.fn_activo_articulo(p_id bigint, p_activo boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  UPDATE core.item_ean a SET activo = p_activo WHERE a.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE142: el artículo ya no existe' USING ERRCODE = 'no_data_found'; END IF;
END;
$$;

-- Borrado definitivo. Las solicitudes ya radicadas guardan su propia copia del SKU y del EAN.
CREATE OR REPLACE FUNCTION despachos.fn_borrar_articulo(p_id bigint)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  DELETE FROM core.item_ean a WHERE a.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE142: el artículo ya no existe' USING ERRCODE = 'no_data_found'; END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Permisos
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'despachos.fn_guardar_cliente(bigint, text, text, text, text, text, text, integer, text)',
    'despachos.fn_cargar_clientes(jsonb, boolean)',
    'despachos.fn_guardar_articulo(bigint, text, text, text, integer)',
    'despachos.fn_activo_articulo(bigint, boolean)',
    'despachos.fn_borrar_articulo(bigint)',
    'core.fn_telefono_limpio(text)', 'core.fn_nombre_limpio(text)', 'core.fn_nit_base(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- Escritura directa en artículos: solo por las funciones (validan rol, Item y EAN únicos)
REVOKE INSERT, UPDATE, DELETE ON core.item_ean FROM authenticated;
DROP POLICY IF EXISTS pol_item_ean_escribir   ON core.item_ean;
DROP POLICY IF EXISTS pol_item_ean_actualizar ON core.item_ean;

COMMIT;

NOTIFY pgrst, 'reload schema';
