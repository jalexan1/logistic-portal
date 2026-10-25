-- =============================================================================
-- 024_parametros_adjuntos_admon.sql
-- Plataforma L&S · Portal de Despachos · Toma de pedidos fase 7 (24-oct-2026)
--
-- QUÉ HACE
--  1. core.parametros: parámetros por aplicación, editables desde el portal
--     (menú Admon → Parámetros TomaPedido). Solo el ADMINISTRADOR los cambia.
--     Valores iniciales de TOMAPEDIDO:
--       adjuntos_max_mb              5      MB por archivo
--       adjuntos_max_archivos        5      archivos por solicitud
--       adjuntos_tipos               zip, jpg, jpeg, png, webp
--       adjuntos_retencion_meses     1      política de documentos
--       solicitudes_rango_max_dias   7      pestaña Solicitudes
--       historico_rango_max_dias     31     pantalla Histórico
--  2. Adjuntos de la solicitud (.zip, imágenes, QR):
--       despachos.solicitud_adjuntos (registro) + bucket privado de Storage
--       "despachos-adjuntos" (archivo). Ruta: <id solicitud>/<archivo>.
--  3. Funciones de administración (solo admin): resumen y control de los
--     adjuntos vencidos para pasarlos manualmente al disco duro.
--
-- POLÍTICA DE DOCUMENTOS (adjuntos): 1 mes en la aplicación → el administrador
-- los respalda manualmente en disco duro → se conservan 1 año → se destruyen.
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere haber ejecutado antes 017 a 023.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Parámetros
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.parametros (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  aplicacion   text        NOT NULL,
  clave        text        NOT NULL,
  valor        jsonb       NOT NULL,
  tipo         text        NOT NULL,           -- numero | lista
  etiqueta     text        NOT NULL,
  descripcion  text,
  unidad       text,
  minimo       numeric,
  maximo       numeric,
  orden        integer     NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid                 DEFAULT auth.uid(),
  updated_at   timestamptz,
  updated_by   uuid,
  version      integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_parametros PRIMARY KEY (id),
  CONSTRAINT uq_parametros_aplicacion_clave UNIQUE (aplicacion, clave),
  CONSTRAINT ck_parametros_tipo CHECK (tipo IN ('numero', 'lista'))
);
COMMENT ON TABLE core.parametros IS 'Parámetros por aplicación (menú Admon → Parámetros). Solo el administrador los modifica.';

INSERT INTO core.parametros (aplicacion, clave, valor, tipo, etiqueta, descripcion, unidad, minimo, maximo, orden) VALUES
  ('TOMAPEDIDO', 'adjuntos_max_mb',            '5',  'numero', 'Tamaño máximo por adjunto',      'Tamaño máximo de cada archivo adjunto (.zip, imagen, QR).', 'MB', 1, 50, 10),
  ('TOMAPEDIDO', 'adjuntos_max_archivos',      '5',  'numero', 'Adjuntos por solicitud',         'Cantidad máxima de archivos adjuntos por solicitud.', 'archivos', 1, 20, 20),
  ('TOMAPEDIDO', 'adjuntos_tipos',             '["zip","jpg","jpeg","png","webp"]', 'lista', 'Tipos de archivo permitidos', 'Extensiones permitidas para los adjuntos, separadas por coma.', NULL, NULL, NULL, 30),
  ('TOMAPEDIDO', 'adjuntos_retencion_meses',   '1',  'numero', 'Retención de adjuntos (política)', 'Meses que los adjuntos permanecen en la aplicación antes de pasarlos al disco duro.', 'meses', 1, 12, 40),
  ('TOMAPEDIDO', 'solicitudes_rango_max_dias', '7',  'numero', 'Rango máximo en Solicitudes',    'Días máximos que se pueden consultar en la pestaña Solicitudes (más: usar Histórico).', 'días', 1, 31, 50),
  ('TOMAPEDIDO', 'historico_rango_max_dias',   '31', 'numero', 'Rango máximo en Histórico',      'Días máximos por consulta en la pantalla Histórico (más: pedirlo al administrador).', 'días', 7, 93, 60)
ON CONFLICT ON CONSTRAINT uq_parametros_aplicacion_clave DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, descripcion = EXCLUDED.descripcion, unidad = EXCLUDED.unidad,
      minimo = EXCLUDED.minimo, maximo = EXCLUDED.maximo, orden = EXCLUDED.orden;   -- el VALOR no se pisa

-- Valor numérico de un parámetro (con valor por defecto si no existe)
CREATE OR REPLACE FUNCTION core.fn_parametro_num(p_aplicacion text, p_clave text, p_defecto numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT (p.valor #>> '{}')::numeric FROM core.parametros p
                    WHERE p.aplicacion = p_aplicacion AND p.clave = p_clave), p_defecto)
$$;

-- Guardar un parámetro (solo administrador). Valida tipo y rango.
CREATE OR REPLACE FUNCTION core.fn_guardar_parametro(p_aplicacion text, p_clave text, p_valor jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_par record;
  v_num numeric;
BEGIN
  IF NOT core.fn_es_admin_plataforma() THEN
    RAISE EXCEPTION 'CORE120: solo el administrador modifica los parámetros' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.* INTO v_par FROM core.parametros p WHERE p.aplicacion = p_aplicacion AND p.clave = p_clave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE121: parámetro inexistente (%.%)', p_aplicacion, p_clave USING ERRCODE = 'no_data_found'; END IF;

  IF v_par.tipo = 'numero' THEN
    BEGIN v_num := (p_valor #>> '{}')::numeric;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'CORE122: «%» debe ser un número', v_par.etiqueta USING ERRCODE = 'check_violation'; END;
    IF (v_par.minimo IS NOT NULL AND v_num < v_par.minimo) OR (v_par.maximo IS NOT NULL AND v_num > v_par.maximo) THEN
      RAISE EXCEPTION 'CORE123: «%» debe estar entre % y %', v_par.etiqueta, v_par.minimo, v_par.maximo USING ERRCODE = 'check_violation';
    END IF;
    p_valor := to_jsonb(v_num);
  ELSIF jsonb_typeof(p_valor) <> 'array' OR jsonb_array_length(p_valor) = 0 THEN
    RAISE EXCEPTION 'CORE124: «%» debe tener al menos un valor', v_par.etiqueta USING ERRCODE = 'check_violation';
  END IF;

  UPDATE core.parametros p SET valor = p_valor WHERE p.id = v_par.id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Adjuntos de la solicitud
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despachos.solicitud_adjuntos (
  id             bigint GENERATED ALWAYS AS IDENTITY,
  solicitud_id   bigint      NOT NULL,
  ruta           text        NOT NULL,          -- ruta en el bucket: <solicitud_id>/<archivo>
  nombre         text        NOT NULL,          -- nombre original del archivo
  tipo_mime      text,
  tamano_bytes   bigint      NOT NULL,
  respaldado_at  timestamptz,                   -- el admin confirmó que lo pasó al disco duro
  respaldado_por text,
  eliminado_at   timestamptz,                   -- se borró del Storage (ya respaldado)
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid                 DEFAULT auth.uid(),
  updated_at     timestamptz,
  updated_by     uuid,
  version        integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_solicitud_adjuntos PRIMARY KEY (id),
  CONSTRAINT uq_solicitud_adjuntos_ruta UNIQUE (ruta),
  CONSTRAINT fk_solicitud_adjuntos_solicitudes FOREIGN KEY (solicitud_id) REFERENCES despachos.solicitudes (id) ON DELETE CASCADE,
  CONSTRAINT ck_solicitud_adjuntos_tamano CHECK (tamano_bytes > 0)
);
CREATE INDEX IF NOT EXISTS ix_solicitud_adjuntos_solicitud ON despachos.solicitud_adjuntos (solicitud_id);
CREATE INDEX IF NOT EXISTS ix_solicitud_adjuntos_vigentes ON despachos.solicitud_adjuntos (created_at) WHERE eliminado_at IS NULL;
COMMENT ON TABLE despachos.solicitud_adjuntos IS 'Adjuntos (.zip, imágenes, QR) de cada solicitud. Archivo en Storage bucket despachos-adjuntos. Política: 1 mes en la app, luego respaldo manual en disco duro 1 año.';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('core','parametros'), ('despachos','solicitud_adjuntos')) AS t(esq, tab) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%2$s_actualizacion ON %1$I.%2$I', r.esq, r.tab);
    EXECUTE format('CREATE TRIGGER trg_%2$s_actualizacion BEFORE UPDATE ON %1$I.%2$I
                    FOR EACH ROW EXECUTE FUNCTION core.fn_marcar_actualizacion()', r.esq, r.tab);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%2$s_auditoria ON %1$I.%2$I', r.esq, r.tab);
    EXECUTE format('CREATE TRIGGER trg_%2$s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %1$I.%2$I
                    FOR EACH ROW EXECUTE FUNCTION core.fn_auditar()', r.esq, r.tab);
  END LOOP;
END $$;

-- ¿El usuario puede adjuntar a esta solicitud? (quien la radicó, supervisor o admin)
CREATE OR REPLACE FUNCTION despachos.fn_puede_adjuntar(p_solicitud_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM despachos.solicitudes s
     WHERE s.id = p_solicitud_id
       AND (s.solicitante_id = auth.uid() OR core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])))
$$;

-- Carpeta del bucket → id de solicitud ('273/qr.png' → 273); NULL si no es numérica
CREATE OR REPLACE FUNCTION despachos.fn_solicitud_de_ruta(p_ruta text)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN split_part(p_ruta, '/', 1) ~ '^[0-9]{1,18}$' THEN split_part(p_ruta, '/', 1)::bigint END
$$;

-- Registrar el adjunto ya subido al Storage. Valida parámetros (tamaño, cantidad, tipo).
CREATE OR REPLACE FUNCTION despachos.fn_registrar_adjunto(
  p_solicitud_id bigint, p_ruta text, p_nombre text, p_tipo_mime text, p_tamano_bytes bigint)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_max_mb   numeric := core.fn_parametro_num('TOMAPEDIDO', 'adjuntos_max_mb', 5);
  v_max_n    numeric := core.fn_parametro_num('TOMAPEDIDO', 'adjuntos_max_archivos', 5);
  v_tipos    text[];
  v_ext      text := lower(substring(COALESCE(p_nombre, '') FROM '\.([A-Za-z0-9]+)$'));
  v_id       bigint;
BEGIN
  IF NOT despachos.fn_puede_adjuntar(p_solicitud_id) THEN
    RAISE EXCEPTION 'DSP020: no puede adjuntar archivos a esta solicitud' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF despachos.fn_solicitud_de_ruta(p_ruta) IS DISTINCT FROM p_solicitud_id THEN
    RAISE EXCEPTION 'DSP021: ruta de adjunto inválida' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(array_agg(lower(x)), ARRAY['zip','jpg','jpeg','png','webp']) INTO v_tipos
    FROM core.parametros p, jsonb_array_elements_text(p.valor) x
   WHERE p.aplicacion = 'TOMAPEDIDO' AND p.clave = 'adjuntos_tipos';
  IF v_ext IS NULL OR NOT (v_ext = ANY (v_tipos)) THEN
    RAISE EXCEPTION 'DSP022: tipo de archivo no permitido (%). Permitidos: %', COALESCE(v_ext, 'sin extensión'), array_to_string(v_tipos, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_tamano_bytes > v_max_mb * 1024 * 1024 THEN
    RAISE EXCEPTION 'DSP023: «%» supera el tamaño máximo de % MB', p_nombre, v_max_mb USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM despachos.solicitud_adjuntos a WHERE a.solicitud_id = p_solicitud_id) >= v_max_n THEN
    RAISE EXCEPTION 'DSP024: la solicitud ya tiene el máximo de % adjuntos', v_max_n USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO despachos.solicitud_adjuntos (solicitud_id, ruta, nombre, tipo_mime, tamano_bytes, created_by)
  VALUES (p_solicitud_id, p_ruta, p_nombre, p_tipo_mime, p_tamano_bytes, auth.uid())
  ON CONFLICT ON CONSTRAINT uq_solicitud_adjuntos_ruta DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Administración de adjuntos (solo administrador)
-- ─────────────────────────────────────────────────────────────────────────────
-- Resumen: total en la app y lo vencido según la política (retención en meses)
CREATE OR REPLACE FUNCTION despachos.fn_resumen_adjuntos()
RETURNS TABLE (total_archivos bigint, total_mb numeric, vencidos_archivos bigint, vencidos_mb numeric,
               respaldados_pendientes_borrar bigint, retencion_meses numeric, fecha_corte date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_meses numeric := core.fn_parametro_num('TOMAPEDIDO', 'adjuntos_retencion_meses', 1);
  v_corte timestamptz := now() - make_interval(months => v_meses::int);
BEGIN
  IF NOT core.fn_es_admin_plataforma() THEN
    RAISE EXCEPTION 'CORE120: solo el administrador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT count(*), round(COALESCE(sum(a.tamano_bytes), 0) / 1048576.0, 2),
         count(*) FILTER (WHERE a.created_at < v_corte),
         round(COALESCE(sum(a.tamano_bytes) FILTER (WHERE a.created_at < v_corte), 0) / 1048576.0, 2),
         count(*) FILTER (WHERE a.respaldado_at IS NOT NULL),
         v_meses, (v_corte AT TIME ZONE 'America/Bogota')::date
  FROM despachos.solicitud_adjuntos a
  WHERE a.eliminado_at IS NULL;
END;
$$;

-- Adjuntos vencidos (para descargarlos y pasarlos al disco duro)
CREATE OR REPLACE FUNCTION despachos.fn_adjuntos_vencidos()
RETURNS TABLE (id bigint, solicitud_numero text, radicada_at timestamptz, nombre text, ruta text,
               tamano_bytes bigint, created_at timestamptz, respaldado_at timestamptz, respaldado_por text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_corte timestamptz := now() - make_interval(months => core.fn_parametro_num('TOMAPEDIDO', 'adjuntos_retencion_meses', 1)::int);
BEGIN
  IF NOT core.fn_es_admin_plataforma() THEN
    RAISE EXCEPTION 'CORE120: solo el administrador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT a.id, s.numero, s.radicada_at, a.nombre, a.ruta, a.tamano_bytes, a.created_at, a.respaldado_at, a.respaldado_por
  FROM despachos.solicitud_adjuntos a
  JOIN despachos.solicitudes s ON s.id = a.solicitud_id
  WHERE a.eliminado_at IS NULL AND a.created_at < v_corte
  ORDER BY a.created_at, a.id;
END;
$$;

-- Marcar respaldado (ya está en el disco duro) o eliminado (ya se borró del Storage)
CREATE OR REPLACE FUNCTION despachos.fn_marcar_adjuntos(p_ids bigint[], p_accion text)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF NOT core.fn_es_admin_plataforma() THEN
    RAISE EXCEPTION 'CORE120: solo el administrador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_accion = 'RESPALDADO' THEN
    UPDATE despachos.solicitud_adjuntos a SET respaldado_at = now(), respaldado_por = core.fn_mi_nombre()
     WHERE a.id = ANY (p_ids) AND a.eliminado_at IS NULL;
  ELSIF p_accion = 'ELIMINADO' THEN
    UPDATE despachos.solicitud_adjuntos a SET eliminado_at = now()
     WHERE a.id = ANY (p_ids) AND a.respaldado_at IS NOT NULL AND a.eliminado_at IS NULL;
  ELSE
    RAISE EXCEPTION 'CORE125: acción inválida (%)', p_accion USING ERRCODE = 'check_violation';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Permisos y RLS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON core.parametros TO authenticated;
GRANT ALL    ON core.parametros TO service_role;
GRANT SELECT ON despachos.solicitud_adjuntos TO authenticated;
GRANT ALL    ON despachos.solicitud_adjuntos TO service_role;

ALTER TABLE core.parametros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_parametros_leer ON core.parametros;
CREATE POLICY pol_parametros_leer ON core.parametros FOR SELECT TO authenticated USING (true);

ALTER TABLE despachos.solicitud_adjuntos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_solicitud_adjuntos_leer ON despachos.solicitud_adjuntos;
-- Ve el adjunto quien puede ver la solicitud (RLS de despachos.solicitudes)
CREATE POLICY pol_solicitud_adjuntos_leer ON despachos.solicitud_adjuntos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM despachos.solicitudes s WHERE s.id = solicitud_id));

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'core.fn_parametro_num(text, text, numeric)', 'core.fn_guardar_parametro(text, text, jsonb)',
    'despachos.fn_puede_adjuntar(bigint)', 'despachos.fn_solicitud_de_ruta(text)',
    'despachos.fn_registrar_adjunto(bigint, text, text, text, bigint)',
    'despachos.fn_resumen_adjuntos()', 'despachos.fn_adjuntos_vencidos()',
    'despachos.fn_marcar_adjuntos(bigint[], text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Storage: bucket privado y políticas
--    Subir: quien radicó la solicitud, supervisor o admin (carpeta = id solicitud)
--    Descargar: quien puede ver el adjunto registrado
--    Borrar: solo el administrador (después de respaldar en disco duro)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('despachos-adjuntos', 'despachos-adjuntos', false, 52428800)   -- tope técnico 50 MB; el límite real es el parámetro
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS pol_adjuntos_subir   ON storage.objects;
DROP POLICY IF EXISTS pol_adjuntos_leer    ON storage.objects;
DROP POLICY IF EXISTS pol_adjuntos_borrar  ON storage.objects;

CREATE POLICY pol_adjuntos_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'despachos-adjuntos'
              AND despachos.fn_puede_adjuntar(despachos.fn_solicitud_de_ruta(name)));
CREATE POLICY pol_adjuntos_leer ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'despachos-adjuntos'
         AND (EXISTS (SELECT 1 FROM despachos.solicitud_adjuntos a WHERE a.ruta = name)
              OR despachos.fn_puede_adjuntar(despachos.fn_solicitud_de_ruta(name))));
CREATE POLICY pol_adjuntos_borrar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'despachos-adjuntos' AND core.fn_es_admin_plataforma());

COMMIT;

NOTIFY pgrst, 'reload schema';
