-- =============================================================================
-- PORTAL_DESPACHOS_BD_v01.sql
-- Plataforma L&S · Portal de Despachos + Inventario · Base de datos VERSIÓN 01
-- Consolidado el 06-nov-2026 · Proyecto Supabase: kpi-logistics
-- =============================================================================
--
-- QUÉ ES
--   Un solo archivo con TODOS los scripts de base de datos del portal, en el
--   orden en que se ejecutaron (017 → 034). Reemplaza los archivos sueltos.
--   Cada bloque conserva su contenido original sin cambios.
--
-- ⚠ CÓMO USARLO
--   · Base ACTUAL (kpi-logistics): YA tiene aplicados 017 a 033. Solo falta el
--     bloque 034 si aún no lo ha corrido. NO ejecute el archivo completo sobre
--     la base actual: algunos bloques reescriben datos (p. ej. 019 cambia
--     estados, 033 reactiva accesos de INVENTARIO).
--   · Base NUEVA (otro proyecto Supabase): ejecutar completo, de arriba abajo.
--     Requisitos: extensión pg_trgm en el esquema "extensions" y, después,
--     exponer core, despachos e inventario en Data API → Exposed schemas.
--   · No se incluyen 018, 027 ni 029: no están en el repositorio ni en el proyecto.
--
-- CONTENIDO
--   017  plataforma_core_despachos_inventario
--   019  despachos_lotes_procesamiento
--   020  despachos_toma_pedidos_fase3
--   021  destinatarios_direccion_departamento
--   022  clientes_revision_busqueda_parecida
--   023  despachos_dse_proceso_plantilla
--   024  parametros_adjuntos_admon
--   025  despachos_motivos
--   026  maestros_clientes_articulos
--   028  fix_carga_masiva
--   030  admin_validar_sql
--   031  motivo_bloque_carga_articulos
--   032  consentimiento_inventario
--   033  restaurar_pasillos_y_separar_tarjeta
--   034  manual_observacion_rechazo_cliente
-- =============================================================================



-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 017 · 017_plataforma_core_despachos_inventario.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 017_plataforma_core_despachos_inventario.sql
-- Plataforma L&S · Una base de datos, varias aplicaciones, un solo login
-- Proyecto Supabase destino: kpi-logistics (el mismo de NexusKPI)
-- =============================================================================
--
-- ESTÁNDAR DE BASE DE DATOS (resumen — detalle en el documento de arquitectura)
-- ---------------------------------------------------------------------------
--  Esquemas por dominio (el "diferencial" entre aplicaciones):
--    public      → NexusKPI (kpi_*, op_*, etl_log...). NO se toca en este script.
--    core        → transversal: perfiles, accesos por aplicación, cuentas,
--                  destinatarios, auditoría. Lo usan todas las apps.
--    despachos   → Portal de Despachos: solicitudes, líneas, eventos de estado.
--    inventario  → Inventario de Pasillos: pasillos y registros de ocupación.
--
--  Nombres:           snake_case, sin tildes ni ñ. Tablas en plural.
--  Llave primaria:    id  (bigint identity; uuid solo cuando viene de auth).
--  Llave foránea:     <entidad_singular>_id   (ej. solicitud_id, pasillo_id)
--  Fechas-hora:       <evento>_at  timestamptz (se guarda UTC, se muestra Bogotá)
--  Auditoría fila:    created_at, created_by, updated_at, updated_by, version
--  Borrado lógico:    anulado_at, anulado_by, motivo_anulacion (nunca DELETE)
--  Restricciones:     pk_<tabla>, fk_<tabla>_<ref>, uq_<tabla>_<cols>,
--                     ck_<tabla>_<regla>, ix_<tabla>_<cols>
--  Objetos:           fn_<verbo>_<objeto>, trg_<tabla>_<proposito>,
--                     vw_<proposito>, seq_<objeto>
--  Códigos/catálogos: MAYÚSCULAS (RADICADA, DESPACHOS, IL...)
--  Escrituras de negocio críticas: SOLO por funciones (RPC) → 1 transacción.
--
-- ANTES DE EJECUTAR
--  1. Backup MANUAL previo (en plan Free no hay backups automáticos y
--     pages/db_backup.html es un stub que no exporta nada):
--       supabase db dump --db-url "$DB_URL" -f esquema.sql
--       supabase db dump --db-url "$DB_URL" --data-only -f datos.sql
--     En plan Pro: Supabase → Database → Backups (diario, 7 días).
--  2. Ejecutar completo en Supabase → SQL Editor (es idempotente: se puede
--     re-ejecutar sin duplicar objetos).
--  3. Supabase → Project Settings → Data API → "Exposed schemas":
--     agregar  core, despachos, inventario   (además de public).
--  4. Dar el primer acceso de administrador (ver bloque final "ARRANQUE").
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. ESQUEMAS Y PERMISOS BASE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS despachos;
CREATE SCHEMA IF NOT EXISTS inventario;

COMMENT ON SCHEMA core       IS 'Transversal a la plataforma L&S: identidad, accesos, maestros compartidos, auditoría';
COMMENT ON SCHEMA despachos  IS 'Aplicación Portal de Despachos: solicitudes de despacho y su ciclo de vida';
COMMENT ON SCHEMA inventario IS 'Aplicación Inventario de Pasillos: registros de ocupación por pasillo';

-- Nadie anónimo entra a estos esquemas. Solo usuarios con login.
REVOKE ALL ON SCHEMA core, despachos, inventario FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA core, despachos, inventario TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CORE · funciones utilitarias de fila (updated_at / version / auditoría)
-- ─────────────────────────────────────────────────────────────────────────────

-- Mantiene updated_at, updated_by y version en cada UPDATE.
-- "version" habilita bloqueo optimista: el cliente actualiza con
-- ?id=eq.X&version=eq.N  → si otro usuario ya cambió la fila, afecta 0 filas.
CREATE OR REPLACE FUNCTION core.fn_marcar_actualizacion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  NEW.version    := OLD.version + 1;
  NEW.created_at := OLD.created_at;   -- inmutables
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END;
$$;

-- Bitácora única de auditoría para todas las apps nuevas.
CREATE TABLE IF NOT EXISTS core.auditoria (
  id             bigint GENERATED ALWAYS AS IDENTITY,
  esquema        text        NOT NULL,
  tabla          text        NOT NULL,
  registro_id    text        NOT NULL,
  accion         text        NOT NULL,
  datos_antes    jsonb,
  datos_despues  jsonb,
  campos_cambiados text[],
  usuario_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_auditoria PRIMARY KEY (id),
  CONSTRAINT ck_auditoria_accion CHECK (accion IN ('INSERT','UPDATE','DELETE'))
);
CREATE INDEX IF NOT EXISTS ix_auditoria_tabla_registro ON core.auditoria (esquema, tabla, registro_id);
CREATE INDEX IF NOT EXISTS ix_auditoria_created_at     ON core.auditoria (created_at);
COMMENT ON TABLE core.auditoria IS 'Historial de cambios (antes/después) de las tablas de negocio de core, despachos e inventario';

CREATE OR REPLACE FUNCTION core.fn_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_antes   jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_campos  text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_campos
    FROM jsonb_each(v_despues) n
    WHERE n.value IS DISTINCT FROM v_antes -> n.key
      AND n.key NOT IN ('updated_at','updated_by','version');
    IF v_campos IS NULL THEN RETURN NEW; END IF;   -- UPDATE sin cambios reales
  END IF;

  INSERT INTO core.auditoria (esquema, tabla, registro_id, accion,
                              datos_antes, datos_despues, campos_cambiados, usuario_id)
  VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME,
          COALESCE(v_despues ->> 'id', v_antes ->> 'id'),
          TG_OP, v_antes, v_despues, v_campos, auth.uid());
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CORE · identidad y accesos (fuente única de verdad de roles)
-- ─────────────────────────────────────────────────────────────────────────────

-- Cuentas = clientes de L&S (ej. Click Cosmetics). Permite multi-cliente.
CREATE TABLE IF NOT EXISTS core.cuentas (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  codigo      text        NOT NULL,
  nombre      text        NOT NULL,
  nit         text,
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid                 DEFAULT auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_cuentas PRIMARY KEY (id),
  CONSTRAINT uq_cuentas_codigo UNIQUE (codigo),
  CONSTRAINT ck_cuentas_codigo_mayus CHECK (codigo = upper(codigo))
);
COMMENT ON TABLE core.cuentas IS 'Clientes de L&S que operan en la plataforma (multi-cliente)';

-- Perfil 1:1 con auth.users (lo crea un trigger al registrar el usuario).
CREATE TABLE IF NOT EXISTS core.perfiles (
  id          uuid        NOT NULL,
  email       text        NOT NULL,
  nombre      text,
  area        text,
  cuenta_id   bigint,                 -- NULL = usuario interno L&S (ve todas las cuentas)
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_perfiles PRIMARY KEY (id),
  CONSTRAINT fk_perfiles_auth_users FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_perfiles_cuentas    FOREIGN KEY (cuenta_id) REFERENCES core.cuentas (id),
  CONSTRAINT uq_perfiles_email UNIQUE (email)
);
COMMENT ON TABLE core.perfiles IS 'Perfil de cada usuario de Supabase Auth. cuenta_id NULL = interno L&S';

-- Catálogo de aplicaciones = las TARJETAS del launcher.
CREATE TABLE IF NOT EXISTS core.aplicaciones (
  codigo       text     NOT NULL,
  nombre       text     NOT NULL,
  descripcion  text,
  ruta         text     NOT NULL,        -- ruta relativa en el dominio común
  icono        text,
  color        text,
  orden        smallint NOT NULL DEFAULT 100,
  roles_validos text[]  NOT NULL,
  activo       boolean  NOT NULL DEFAULT true,
  CONSTRAINT pk_aplicaciones PRIMARY KEY (codigo),
  CONSTRAINT ck_aplicaciones_codigo_mayus CHECK (codigo = upper(codigo))
);
COMMENT ON TABLE core.aplicaciones IS 'Aplicaciones de la plataforma; alimenta las tarjetas del launcher';

INSERT INTO core.aplicaciones (codigo, nombre, descripcion, ruta, icono, color, orden, roles_validos) VALUES
  ('DESPACHOS',   'Portal de Despachos',   'Radicar solicitudes de despacho manuales o desde PDF', '/despachos/',            '🚚', '#0F6E56', 10, ARRAY['solicitante','operador','consulta','admin']),
  ('INVENTARIO',  'Inventario de Pasillos','Registro de ocupación de posiciones por pasillo',      '/despachos/?vista=inventario','🗃️', '#2563EB', 20, ARRAY['registrador','supervisor','consulta','admin']),
  ('KPI',         'NexusKPI',              'Indicadores de gestión y consolidado gerencial',       '/pages/menu.html',       '📊', '#B45309', 30, ARRAY['viewer','admin']),
  ('OPERATIVIDAD','Operatividad',          'Productividad, olas, picking y recibo',                '/pages/op_dashboard_menu.html','⚙️','#7C3AED', 40, ARRAY['viewer','admin'])
ON CONFLICT (codigo) DO NOTHING;

-- Qué usuario entra a qué aplicación y con qué rol.
CREATE TABLE IF NOT EXISTS core.accesos (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  perfil_id        uuid        NOT NULL,
  aplicacion_codigo text       NOT NULL,
  rol              text        NOT NULL,
  activo           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid                 DEFAULT auth.uid(),
  updated_at       timestamptz,
  updated_by       uuid,
  version          integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_accesos PRIMARY KEY (id),
  CONSTRAINT fk_accesos_perfiles     FOREIGN KEY (perfil_id) REFERENCES core.perfiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_accesos_aplicaciones FOREIGN KEY (aplicacion_codigo) REFERENCES core.aplicaciones (codigo),
  CONSTRAINT uq_accesos_perfil_app UNIQUE (perfil_id, aplicacion_codigo)
);
COMMENT ON TABLE core.accesos IS 'Rol de cada usuario en cada aplicación. Reemplaza el rol en user_metadata';

-- Validación: el rol debe existir para esa aplicación.
CREATE OR REPLACE FUNCTION core.fn_validar_rol_acceso()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.aplicaciones a
                 WHERE a.codigo = NEW.aplicacion_codigo AND NEW.rol = ANY (a.roles_validos)) THEN
    RAISE EXCEPTION 'CORE001: rol "%" no válido para la aplicación %', NEW.rol, NEW.aplicacion_codigo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

-- Maestro de destinatarios (reemplaza BD_CLIENTES embebido en el JS público).
CREATE TABLE IF NOT EXISTS core.destinatarios (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  cuenta_id   bigint,
  nit         text        NOT NULL,
  nombre      text        NOT NULL,
  ciudad      text,
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid                 DEFAULT auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_destinatarios PRIMARY KEY (id),
  CONSTRAINT fk_destinatarios_cuentas FOREIGN KEY (cuenta_id) REFERENCES core.cuentas (id),
  CONSTRAINT uq_destinatarios_cuenta_nit UNIQUE NULLS NOT DISTINCT (cuenta_id, nit),
  CONSTRAINT ck_destinatarios_nit_digitos CHECK (nit ~ '^[0-9A-Za-z-]+$')
);
CREATE INDEX IF NOT EXISTS ix_destinatarios_nombre ON core.destinatarios (lower(nombre));
COMMENT ON TABLE core.destinatarios IS 'Destinatarios de mercancía (NIT, nombre, ciudad). Datos personales: protegido por login y RLS';

-- Perfil automático al crear usuario en Supabase Auth.
CREATE OR REPLACE FUNCTION core.fn_crear_perfil_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO core.perfiles (id, email, nombre)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'nombre', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auth_users_crear_perfil ON auth.users;
CREATE TRIGGER trg_auth_users_crear_perfil
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION core.fn_crear_perfil_usuario();

-- Columnas sensibles del perfil (activo, cuenta) solo las cambia un admin.
CREATE OR REPLACE FUNCTION core.fn_proteger_perfil()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.activo IS DISTINCT FROM OLD.activo OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
      OR NEW.email IS DISTINCT FROM OLD.email OR NEW.id IS DISTINCT FROM OLD.id)
     AND auth.uid() IS NOT NULL                    -- procesos de sistema (service_role / SQL Editor) pasan
     AND NOT core.fn_es_admin_plataforma() THEN
    RAISE EXCEPTION 'CORE002: solo un administrador puede cambiar estado, cuenta o correo del perfil'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;

-- Perfiles para los usuarios que YA existen (los de NexusKPI).
INSERT INTO core.perfiles (id, email, nombre)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data ->> 'nombre', u.email)
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ── Funciones de autorización (usadas por RLS y por las RPC) ─────────────────
-- SECURITY DEFINER + STABLE: se evalúan una vez por consulta, no por fila.
CREATE OR REPLACE FUNCTION core.fn_rol_en(p_aplicacion text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.rol
  FROM core.accesos a
  JOIN core.perfiles p ON p.id = a.perfil_id
  WHERE a.perfil_id = auth.uid()
    AND a.aplicacion_codigo = p_aplicacion
    AND a.activo AND p.activo
$$;

CREATE OR REPLACE FUNCTION core.fn_tiene_rol(p_aplicacion text, p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(core.fn_rol_en(p_aplicacion) = ANY (p_roles), false)
$$;

CREATE OR REPLACE FUNCTION core.fn_es_admin_plataforma()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM core.accesos a JOIN core.perfiles p ON p.id = a.perfil_id
                 WHERE a.perfil_id = auth.uid() AND a.rol = 'admin' AND a.activo AND p.activo)
$$;

CREATE OR REPLACE FUNCTION core.fn_mi_cuenta()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT cuenta_id FROM core.perfiles WHERE id = auth.uid()
$$;

-- Tarjetas del launcher para el usuario que inició sesión.
CREATE OR REPLACE FUNCTION core.fn_mis_aplicaciones()
RETURNS TABLE (codigo text, nombre text, descripcion text, ruta text,
               icono text, color text, rol text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ap.codigo, ap.nombre, ap.descripcion, ap.ruta, ap.icono, ap.color, ac.rol
  FROM core.accesos ac
  JOIN core.aplicaciones ap ON ap.codigo = ac.aplicacion_codigo
  JOIN core.perfiles pf     ON pf.id = ac.perfil_id
  WHERE ac.perfil_id = auth.uid() AND ac.activo AND ap.activo AND pf.activo
  ORDER BY ap.orden
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DESPACHOS · solicitudes transaccionales
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despachos.estados (
  codigo      text     NOT NULL,
  nombre      text     NOT NULL,
  orden       smallint NOT NULL,
  es_final    boolean  NOT NULL DEFAULT false,
  CONSTRAINT pk_estados PRIMARY KEY (codigo)
);
INSERT INTO despachos.estados (codigo, nombre, orden, es_final) VALUES
  ('RADICADA',        'Radicada',         10, false),
  ('EN_ALISTAMIENTO', 'En alistamiento',  20, false),
  ('DESPACHADA',      'Despachada',       30, false),
  ('ENTREGADA',       'Entregada',        40, true),
  ('ANULADA',         'Anulada',          99, true)
ON CONFLICT (codigo) DO NOTHING;

-- Transiciones permitidas (máquina de estados).
CREATE TABLE IF NOT EXISTS despachos.transiciones (
  estado_origen  text NOT NULL,
  estado_destino text NOT NULL,
  CONSTRAINT pk_transiciones PRIMARY KEY (estado_origen, estado_destino),
  CONSTRAINT fk_transiciones_origen  FOREIGN KEY (estado_origen)  REFERENCES despachos.estados (codigo),
  CONSTRAINT fk_transiciones_destino FOREIGN KEY (estado_destino) REFERENCES despachos.estados (codigo)
);
INSERT INTO despachos.transiciones VALUES
  ('RADICADA','EN_ALISTAMIENTO'), ('RADICADA','ANULADA'),
  ('EN_ALISTAMIENTO','DESPACHADA'), ('EN_ALISTAMIENTO','ANULADA'),
  ('DESPACHADA','ENTREGADA')
ON CONFLICT DO NOTHING;

-- Consecutivo único garantizado por PostgreSQL (reemplaza ddmmaaHHMM).
CREATE SEQUENCE IF NOT EXISTS despachos.seq_solicitud_numero AS bigint START 1 CACHE 1;

CREATE TABLE IF NOT EXISTS despachos.solicitudes (
  id                   bigint GENERATED ALWAYS AS IDENTITY,
  numero               text        NOT NULL,
  idempotency_key      uuid        NOT NULL,
  cuenta_id            bigint,
  origen               text        NOT NULL,
  estado_codigo        text        NOT NULL DEFAULT 'RADICADA',
  area_solicitante     text        NOT NULL,
  solicitante_id       uuid        NOT NULL,
  solicitante_nombre   text        NOT NULL,
  solicitante_correo   text        NOT NULL,
  numero_pedido_origen text,                    -- N° pedido del PDF (si origen = PDF)
  archivo_origen       text,                    -- nombre del PDF cargado
  datos_origen         jsonb,                   -- encabezado completo del PDF (totales, cliente...)
  total_lineas         integer     NOT NULL,
  total_unidades       numeric(14,3) NOT NULL,
  observaciones        text,
  radicada_at          timestamptz NOT NULL DEFAULT now(),
  anulado_at           timestamptz,
  anulado_by           uuid,
  motivo_anulacion     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid                 DEFAULT auth.uid(),
  updated_at           timestamptz,
  updated_by           uuid,
  version              integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_solicitudes PRIMARY KEY (id),
  CONSTRAINT uq_solicitudes_numero          UNIQUE (numero),
  CONSTRAINT uq_solicitudes_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT fk_solicitudes_cuentas  FOREIGN KEY (cuenta_id)     REFERENCES core.cuentas (id),
  CONSTRAINT fk_solicitudes_estados  FOREIGN KEY (estado_codigo) REFERENCES despachos.estados (codigo),
  CONSTRAINT fk_solicitudes_perfiles FOREIGN KEY (solicitante_id) REFERENCES core.perfiles (id),
  CONSTRAINT ck_solicitudes_origen   CHECK (origen IN ('MANUAL','PDF')),
  CONSTRAINT ck_solicitudes_correo   CHECK (solicitante_correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT ck_solicitudes_totales  CHECK (total_lineas > 0 AND total_unidades > 0),
  CONSTRAINT ck_solicitudes_anulacion CHECK ((anulado_at IS NULL) = (estado_codigo <> 'ANULADA'))
);
CREATE INDEX IF NOT EXISTS ix_solicitudes_radicada_at   ON despachos.solicitudes (radicada_at DESC);
CREATE INDEX IF NOT EXISTS ix_solicitudes_solicitante   ON despachos.solicitudes (solicitante_id, radicada_at DESC);
CREATE INDEX IF NOT EXISTS ix_solicitudes_estado        ON despachos.solicitudes (estado_codigo);
CREATE INDEX IF NOT EXISTS ix_solicitudes_cuenta        ON despachos.solicitudes (cuenta_id, radicada_at DESC);
CREATE INDEX IF NOT EXISTS ix_solicitudes_pedido_origen ON despachos.solicitudes (numero_pedido_origen);
COMMENT ON TABLE despachos.solicitudes IS 'Encabezado de cada solicitud de despacho radicada en el Portal de Despachos';
COMMENT ON COLUMN despachos.solicitudes.idempotency_key IS 'UUID generado por el navegador por cada envío: evita duplicados por doble clic o reintento de red';

CREATE TABLE IF NOT EXISTS despachos.solicitud_lineas (
  id                   bigint GENERATED ALWAYS AS IDENTITY,
  solicitud_id         bigint      NOT NULL,
  linea_nro            integer     NOT NULL,
  entrega              text        NOT NULL,
  destinatario_id      bigint,                   -- enlace al maestro si el NIT existe
  destinatario_nit     text        NOT NULL,     -- foto del dato al momento de radicar
  destinatario_nombre  text        NOT NULL,
  destinatario_ciudad  text        NOT NULL,
  material             text        NOT NULL,
  producto_descripcion text,
  cantidad             numeric(14,3) NOT NULL,
  um                   text        NOT NULL DEFAULT 'BUL',
  item                 integer,
  bodega               text,
  precio_unitario      numeric(16,2),
  descuento_pct        numeric(6,2),
  subtotal             numeric(16,2),
  total                numeric(16,2),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid                 DEFAULT auth.uid(),
  CONSTRAINT pk_solicitud_lineas PRIMARY KEY (id),
  CONSTRAINT fk_solicitud_lineas_solicitudes   FOREIGN KEY (solicitud_id)    REFERENCES despachos.solicitudes (id) ON DELETE RESTRICT,
  CONSTRAINT fk_solicitud_lineas_destinatarios FOREIGN KEY (destinatario_id) REFERENCES core.destinatarios (id),
  CONSTRAINT uq_solicitud_lineas_nro             UNIQUE (solicitud_id, linea_nro),
  CONSTRAINT uq_solicitud_lineas_entrega_material UNIQUE (solicitud_id, entrega, material),
  CONSTRAINT ck_solicitud_lineas_cantidad CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS ix_solicitud_lineas_material     ON despachos.solicitud_lineas (material);
CREATE INDEX IF NOT EXISTS ix_solicitud_lineas_destinatario ON despachos.solicitud_lineas (destinatario_nit);
COMMENT ON TABLE despachos.solicitud_lineas IS 'Detalle (una fila = una línea de la plantilla Excel) de cada solicitud. Inmutable tras radicar';

CREATE TABLE IF NOT EXISTS despachos.solicitud_eventos (
  id               bigint GENERATED ALWAYS AS IDENTITY,
  solicitud_id     bigint      NOT NULL,
  estado_anterior  text,
  estado_nuevo     text        NOT NULL,
  comentario       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid                 DEFAULT auth.uid(),
  CONSTRAINT pk_solicitud_eventos PRIMARY KEY (id),
  CONSTRAINT fk_solicitud_eventos_solicitudes FOREIGN KEY (solicitud_id) REFERENCES despachos.solicitudes (id),
  CONSTRAINT fk_solicitud_eventos_estado      FOREIGN KEY (estado_nuevo) REFERENCES despachos.estados (codigo)
);
CREATE INDEX IF NOT EXISTS ix_solicitud_eventos_solicitud ON despachos.solicitud_eventos (solicitud_id, created_at);
COMMENT ON TABLE despachos.solicitud_eventos IS 'Línea de tiempo de estados: base del Lead Time (KPI-DES-008) y OTD (KPI-DES-005)';

-- ── RPC: crear solicitud (TODO o NADA, en una sola transacción) ─────────────
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
  p_observaciones      text  DEFAULT NULL
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
  IF p_origen NOT IN ('MANUAL','PDF') THEN
    RAISE EXCEPTION 'DSP004: origen inválido (%)', p_origen USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'DSP005: la solicitud no tiene líneas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lineas) > 5000 THEN
    RAISE EXCEPTION 'DSP006: máximo 5000 líneas por solicitud' USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Validación de líneas (en tabla temporal de la transacción)
  CREATE TEMP TABLE IF NOT EXISTS tmp_lineas (
    linea_nro integer, entrega text, destinatario_nit text, destinatario_nombre text,
    destinatario_ciudad text, material text, producto_descripcion text, cantidad numeric,
    um text, item integer, bodega text, precio_unitario numeric, descuento_pct numeric,
    subtotal numeric, total numeric
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_lineas;

  INSERT INTO pg_temp.tmp_lineas
  SELECT o.ord::integer,
         upper(trim(l.entrega)), trim(l.destinatario), upper(trim(l.nombre)),
         upper(trim(l.lugar)),   upper(trim(l.material)), l.producto,
         l.cantidad, COALESCE(NULLIF(upper(trim(l.um)),''),'BUL'),
         l.item, NULLIF(trim(l.bodega),''),
         l.precio, l.descuento_pct, l.subtotal, l.total
  FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS l(entrega text, destinatario text, nombre text, lugar text,
                                    material text, producto text, cantidad numeric, um text,
                                    item integer, bodega text, precio numeric,
                                    descuento_pct numeric, subtotal numeric, total numeric);

  SELECT string_agg(format('fila %s', t.linea_nro), ', ' ORDER BY t.linea_nro) INTO v_dup
  FROM pg_temp.tmp_lineas t
  WHERE COALESCE(t.entrega,'') = '' OR COALESCE(t.destinatario_nit,'') = ''
     OR COALESCE(t.destinatario_nombre,'') = '' OR COALESCE(t.destinatario_ciudad,'') = ''
     OR COALESCE(t.material,'') = '' OR t.cantidad IS NULL OR t.cantidad <= 0;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP007: campos obligatorios vacíos o cantidad <= 0 en %', v_dup USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('Entrega %s + Material %s', d.entrega, d.material), '; ') INTO v_dup
  FROM (SELECT t.entrega, t.material FROM pg_temp.tmp_lineas t
        GROUP BY t.entrega, t.material HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP008: líneas duplicadas: %', v_dup USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*), sum(t.cantidad) INTO v_lineas, v_unidades FROM pg_temp.tmp_lineas t;

  -- 5) Encabezado con consecutivo de la secuencia (único aunque radiquen 100 a la vez)
  v_numero := 'DSP-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
              || lpad(nextval('despachos.seq_solicitud_numero')::text, 6, '0');

  INSERT INTO despachos.solicitudes AS s (
    numero, idempotency_key, cuenta_id, origen, area_solicitante,
    solicitante_id, solicitante_nombre, solicitante_correo,
    numero_pedido_origen, archivo_origen, datos_origen,
    total_lineas, total_unidades, observaciones, created_by)
  VALUES (
    v_numero, p_idempotency_key, v_cuenta, p_origen, upper(trim(p_area_solicitante)),
    v_uid, upper(trim(p_solicitante_nombre)), lower(trim(p_solicitante_correo)),
    NULLIF(trim(p_numero_pedido_origen),''), p_archivo_origen, p_datos_origen,
    v_lineas, v_unidades, p_observaciones, v_uid)
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

  -- 6) Líneas + enlace al maestro de destinatarios
  INSERT INTO despachos.solicitud_lineas (
    solicitud_id, linea_nro, entrega, destinatario_id, destinatario_nit,
    destinatario_nombre, destinatario_ciudad, material, producto_descripcion,
    cantidad, um, item, bodega, precio_unitario, descuento_pct, subtotal, total, created_by)
  SELECT v_id, t.linea_nro, t.entrega, d.id, t.destinatario_nit,
         t.destinatario_nombre, t.destinatario_ciudad, t.material, t.producto_descripcion,
         t.cantidad, t.um, t.item, t.bodega, t.precio_unitario, t.descuento_pct,
         t.subtotal, t.total, v_uid
  FROM pg_temp.tmp_lineas t
  LEFT JOIN core.destinatarios d
         ON d.nit = t.destinatario_nit AND d.activo
        AND d.cuenta_id IS NOT DISTINCT FROM v_cuenta
  ORDER BY t.linea_nro;

  -- 7) Primer evento de la línea de tiempo
  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  VALUES (v_id, NULL, 'RADICADA', 'Radicada desde el portal (' || p_origen || ')', v_uid);

  RETURN QUERY
    SELECT s.id, s.numero, s.radicada_at, s.total_lineas, s.total_unidades, false
    FROM despachos.solicitudes s WHERE s.id = v_id;
END;
$$;
COMMENT ON FUNCTION despachos.fn_crear_solicitud IS
  'Radica una solicitud con todas sus líneas en UNA transacción. Idempotente por p_idempotency_key.';

-- ── RPC: cambiar estado (operadores) con bloqueo de fila ────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_cambiar_estado(
  p_solicitud_id  bigint,
  p_estado_nuevo  text,
  p_version       integer,
  p_comentario    text DEFAULT NULL
)
RETURNS TABLE (solicitud_id bigint, estado_codigo text, version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actual  despachos.solicitudes%ROWTYPE;
  v_uid     uuid := auth.uid();
BEGIN
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin']) THEN
    RAISE EXCEPTION 'DSP010: solo operadores pueden cambiar el estado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- FOR UPDATE: si dos operadores tocan la misma solicitud, el segundo espera.
  SELECT * INTO v_actual FROM despachos.solicitudes s WHERE s.id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DSP011: la solicitud % no existe', p_solicitud_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_actual.version <> p_version THEN
    RAISE EXCEPTION 'DSP012: la solicitud fue modificada por otro usuario (versión % vs %). Recargue.',
      v_actual.version, p_version USING ERRCODE = 'serialization_failure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM despachos.transiciones t
                 WHERE t.estado_origen = v_actual.estado_codigo AND t.estado_destino = p_estado_nuevo) THEN
    RAISE EXCEPTION 'DSP013: transición no permitida % → %', v_actual.estado_codigo, p_estado_nuevo
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_estado_nuevo = 'ANULADA' AND COALESCE(trim(p_comentario),'') = '' THEN
    RAISE EXCEPTION 'DSP014: la anulación requiere motivo' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE despachos.solicitudes s
     SET estado_codigo    = p_estado_nuevo,
         anulado_at       = CASE WHEN p_estado_nuevo = 'ANULADA' THEN now() END,
         anulado_by       = CASE WHEN p_estado_nuevo = 'ANULADA' THEN v_uid END,
         motivo_anulacion = CASE WHEN p_estado_nuevo = 'ANULADA' THEN p_comentario END
   WHERE s.id = p_solicitud_id;

  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  VALUES (p_solicitud_id, v_actual.estado_codigo, p_estado_nuevo, p_comentario, v_uid);

  RETURN QUERY SELECT s.id, s.estado_codigo, s.version FROM despachos.solicitudes s WHERE s.id = p_solicitud_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. INVENTARIO · pasillos y registros de ocupación
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.pasillos (
  id                    smallint GENERATED ALWAYS AS IDENTITY,
  codigo                text     NOT NULL,
  descripcion           text     NOT NULL,
  capacidad_posiciones  integer,
  orden                 smallint NOT NULL DEFAULT 100,
  activo                boolean  NOT NULL DEFAULT true,
  CONSTRAINT pk_pasillos PRIMARY KEY (id),
  CONSTRAINT uq_pasillos_codigo UNIQUE (codigo),
  CONSTRAINT ck_pasillos_codigo_mayus CHECK (codigo = upper(codigo))
);
INSERT INTO inventario.pasillos (codigo, descripcion, orden) VALUES
  ('IL','I Izquierdo',10), ('IR','I Derecho',20), ('JR','J Derecho',30), ('JL','J Izquierdo',40)
ON CONFLICT (codigo) DO NOTHING;

-- Umbrales de semáforo configurables (hoy están quemados en el JSX).
CREATE TABLE IF NOT EXISTS inventario.umbrales_ocupacion (
  estado      text         NOT NULL,
  pct_desde   numeric(5,2) NOT NULL,
  color       text         NOT NULL,
  CONSTRAINT pk_umbrales_ocupacion PRIMARY KEY (estado)
);
INSERT INTO inventario.umbrales_ocupacion VALUES
  ('CRITICO',90,'#C0392B'), ('ALERTA',85,'#D97706'), ('BIEN',60,'#0F6E56'), ('BAJO',0,'#3B82F6')
ON CONFLICT (estado) DO NOTHING;

CREATE TABLE IF NOT EXISTS inventario.registros_pasillo (
  id                   bigint GENERATED ALWAYS AS IDENTITY,
  pasillo_id           smallint    NOT NULL,
  cuenta_id            bigint,
  registrado_at        timestamptz NOT NULL DEFAULT now(),
  posiciones_ocupadas  integer     NOT NULL,
  posiciones_vacias    integer     NOT NULL,
  posiciones_total     integer     GENERATED ALWAYS AS (posiciones_ocupadas + posiciones_vacias) STORED,
  pct_ocupacion        numeric(5,2) GENERATED ALWAYS AS (
                         CASE WHEN posiciones_ocupadas + posiciones_vacias = 0 THEN 0
                              ELSE round(posiciones_ocupadas * 100.0 / (posiciones_ocupadas + posiciones_vacias), 2) END
                       ) STORED,
  registrado_por       uuid        NOT NULL DEFAULT auth.uid(),
  usuario_operativo    text,                 -- nombre digitado en el formulario (campo "Usuario")
  observaciones        text,
  anulado_at           timestamptz,
  anulado_by           uuid,
  motivo_anulacion     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid                 DEFAULT auth.uid(),
  updated_at           timestamptz,
  updated_by           uuid,
  version              integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_registros_pasillo PRIMARY KEY (id),
  CONSTRAINT fk_registros_pasillo_pasillos FOREIGN KEY (pasillo_id) REFERENCES inventario.pasillos (id),
  CONSTRAINT fk_registros_pasillo_cuentas  FOREIGN KEY (cuenta_id)  REFERENCES core.cuentas (id),
  CONSTRAINT fk_registros_pasillo_perfiles FOREIGN KEY (registrado_por) REFERENCES core.perfiles (id),
  CONSTRAINT ck_registros_pasillo_no_negativos CHECK (posiciones_ocupadas >= 0 AND posiciones_vacias >= 0),
  CONSTRAINT ck_registros_pasillo_anulacion CHECK (anulado_at IS NULL OR COALESCE(trim(motivo_anulacion),'') <> '')
);
CREATE INDEX IF NOT EXISTS ix_registros_pasillo_pasillo_fecha ON inventario.registros_pasillo (pasillo_id, registrado_at DESC);
CREATE INDEX IF NOT EXISTS ix_registros_pasillo_fecha         ON inventario.registros_pasillo (registrado_at DESC);
COMMENT ON TABLE inventario.registros_pasillo IS 'Cada toma de ocupación de un pasillo. Sin límite de 500, sin sobrescritura de lista, con anulación lógica';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TRIGGERS (updated_at/version + auditoría + validaciones)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('core','cuentas'), ('core','perfiles'), ('core','accesos'), ('core','destinatarios'),
      ('despachos','solicitudes'), ('inventario','registros_pasillo')) AS t(esq, tab)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%2$s_actualizacion ON %1$I.%2$I', r.esq, r.tab);
    EXECUTE format('CREATE TRIGGER trg_%2$s_actualizacion BEFORE UPDATE ON %1$I.%2$I
                    FOR EACH ROW EXECUTE FUNCTION core.fn_marcar_actualizacion()', r.esq, r.tab);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%2$s_auditoria ON %1$I.%2$I', r.esq, r.tab);
    EXECUTE format('CREATE TRIGGER trg_%2$s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %1$I.%2$I
                    FOR EACH ROW EXECUTE FUNCTION core.fn_auditar()', r.esq, r.tab);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_perfiles_proteger ON core.perfiles;
CREATE TRIGGER trg_perfiles_proteger BEFORE UPDATE ON core.perfiles
  FOR EACH ROW EXECUTE FUNCTION core.fn_proteger_perfil();

DROP TRIGGER IF EXISTS trg_accesos_validar_rol ON core.accesos;
CREATE TRIGGER trg_accesos_validar_rol BEFORE INSERT OR UPDATE ON core.accesos
  FOR EACH ROW EXECUTE FUNCTION core.fn_validar_rol_acceso();

-- En inventario, quien registra solo puede cambiar datos operativos; no el autor ni la fecha de creación.
CREATE OR REPLACE FUNCTION inventario.fn_proteger_registro()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.registrado_por := COALESCE(auth.uid(), NEW.registrado_por);
    NEW.cuenta_id      := COALESCE(NEW.cuenta_id, core.fn_mi_cuenta());
  ELSE
    NEW.registrado_por := OLD.registrado_por;
    IF NEW.anulado_at IS NOT NULL AND OLD.anulado_at IS NULL THEN
      NEW.anulado_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_registros_pasillo_proteger ON inventario.registros_pasillo;
CREATE TRIGGER trg_registros_pasillo_proteger BEFORE INSERT OR UPDATE ON inventario.registros_pasillo
  FOR EACH ROW EXECUTE FUNCTION inventario.fn_proteger_registro();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. VISTAS (lectura para las apps y para NexusKPI)
--    security_invoker = true → la vista respeta el RLS de quien consulta.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW inventario.vw_registros_pasillo
WITH (security_invoker = true) AS
SELECT r.id, r.version, p.codigo AS pasillo, p.descripcion AS pasillo_descripcion,
       (r.registrado_at AT TIME ZONE 'America/Bogota')::date                AS fecha,
       to_char(r.registrado_at AT TIME ZONE 'America/Bogota', 'HH24:MI')    AS hora,
       r.registrado_at, r.posiciones_ocupadas, r.posiciones_vacias, r.posiciones_total,
       r.pct_ocupacion, u.estado, u.color, r.usuario_operativo, r.observaciones,
       r.registrado_por, r.anulado_at
FROM inventario.registros_pasillo r
JOIN inventario.pasillos p ON p.id = r.pasillo_id
LEFT JOIN LATERAL (SELECT x.estado, x.color FROM inventario.umbrales_ocupacion x
                   WHERE r.pct_ocupacion >= x.pct_desde ORDER BY x.pct_desde DESC LIMIT 1) u ON true;

CREATE OR REPLACE VIEW inventario.vw_ocupacion_actual
WITH (security_invoker = true) AS
SELECT DISTINCT ON (v.pasillo) v.*
FROM inventario.vw_registros_pasillo v
WHERE v.anulado_at IS NULL
ORDER BY v.pasillo, v.registrado_at DESC;

CREATE OR REPLACE VIEW despachos.vw_solicitudes
WITH (security_invoker = true) AS
SELECT s.id, s.numero, s.version, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo,
       s.numero_pedido_origen, s.total_lineas, s.total_unidades,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.anulado_at, s.motivo_anulacion, s.cuenta_id
FROM despachos.solicitudes s
JOIN despachos.estados e ON e.codigo = s.estado_codigo;

-- Para NexusKPI: volumen diario (reemplaza cargue de Excel para este dato).
CREATE OR REPLACE VIEW despachos.vw_kpi_solicitudes_diario
WITH (security_invoker = true) AS
SELECT (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha,
       to_char(s.radicada_at AT TIME ZONE 'America/Bogota', 'YYYY-MM') AS mes_id,
       s.area_solicitante, s.origen,
       count(*)                                          AS solicitudes,
       count(*) FILTER (WHERE s.estado_codigo = 'ANULADA') AS anuladas,
       sum(s.total_lineas)                               AS lineas,
       sum(s.total_unidades)                             AS unidades
FROM despachos.solicitudes s
GROUP BY 1, 2, 3, 4;

-- Para NexusKPI: tiempos de ciclo por solicitud (Lead Time / OTD).
CREATE OR REPLACE VIEW despachos.vw_kpi_ciclo_solicitud
WITH (security_invoker = true) AS
SELECT s.id, s.numero, s.area_solicitante, s.estado_codigo, s.radicada_at,
       max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'EN_ALISTAMIENTO') AS alistamiento_at,
       max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'DESPACHADA')      AS despachada_at,
       max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'ENTREGADA')       AS entregada_at,
       round(extract(epoch FROM (max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'DESPACHADA')
                                 - s.radicada_at)) / 3600.0, 2)              AS horas_radicada_a_despacho
FROM despachos.solicitudes s
LEFT JOIN despachos.solicitud_eventos ev ON ev.solicitud_id = s.id
GROUP BY s.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SEGURIDAD · GRANTS + RLS
--    Regla: lectura por RLS; escrituras críticas solo vía funciones.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA core, despachos, inventario FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core, despachos, inventario FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA core, despachos, inventario FROM PUBLIC, anon;

-- core
GRANT SELECT ON core.aplicaciones, core.cuentas, core.perfiles, core.accesos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON core.destinatarios TO authenticated;
GRANT UPDATE (nombre, area, activo, cuenta_id) ON core.perfiles TO authenticated;
GRANT INSERT (perfil_id, aplicacion_codigo, rol, activo), UPDATE (rol, activo) ON core.accesos TO authenticated;
GRANT EXECUTE ON FUNCTION core.fn_mis_aplicaciones(), core.fn_rol_en(text),
                          core.fn_tiene_rol(text, text[]), core.fn_es_admin_plataforma(),
                          core.fn_mi_cuenta() TO authenticated;
-- despachos (sin INSERT/UPDATE/DELETE directo: solo RPC)
GRANT SELECT ON despachos.estados, despachos.transiciones, despachos.solicitudes,
                despachos.solicitud_lineas, despachos.solicitud_eventos,
                despachos.vw_solicitudes, despachos.vw_kpi_solicitudes_diario,
                despachos.vw_kpi_ciclo_solicitud TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_crear_solicitud(uuid, text, text, text, text, jsonb, text, text, jsonb, text),
                          despachos.fn_cambiar_estado(bigint, text, integer, text) TO authenticated;
-- inventario (INSERT/UPDATE directo con RLS; nunca DELETE)
GRANT SELECT ON inventario.pasillos, inventario.umbrales_ocupacion, inventario.registros_pasillo,
                inventario.vw_registros_pasillo, inventario.vw_ocupacion_actual TO authenticated;
GRANT INSERT (pasillo_id, registrado_at, posiciones_ocupadas, posiciones_vacias, usuario_operativo, observaciones)
  ON inventario.registros_pasillo TO authenticated;
GRANT UPDATE (pasillo_id, registrado_at, posiciones_ocupadas, posiciones_vacias, usuario_operativo,
              observaciones, anulado_at, motivo_anulacion)
  ON inventario.registros_pasillo TO authenticated;

GRANT ALL ON ALL TABLES    IN SCHEMA core, despachos, inventario TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA core, despachos, inventario TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, despachos, inventario TO service_role;

ALTER TABLE core.auditoria                ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.cuentas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.perfiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.aplicaciones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.accesos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.destinatarios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos.estados             ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos.transiciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos.solicitudes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos.solicitud_lineas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos.solicitud_eventos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario.pasillos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario.umbrales_ocupacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario.registros_pasillo  ENABLE ROW LEVEL SECURITY;

-- core
DROP POLICY IF EXISTS pol_auditoria_admin ON core.auditoria;
CREATE POLICY pol_auditoria_admin ON core.auditoria FOR SELECT TO authenticated
  USING ((SELECT core.fn_es_admin_plataforma()));

DROP POLICY IF EXISTS pol_aplicaciones_leer ON core.aplicaciones;
CREATE POLICY pol_aplicaciones_leer ON core.aplicaciones FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pol_cuentas_leer ON core.cuentas;
CREATE POLICY pol_cuentas_leer ON core.cuentas FOR SELECT TO authenticated
  USING ((SELECT core.fn_mi_cuenta()) IS NULL OR id = (SELECT core.fn_mi_cuenta()));

DROP POLICY IF EXISTS pol_perfiles_leer ON core.perfiles;
CREATE POLICY pol_perfiles_leer ON core.perfiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT core.fn_es_admin_plataforma()));
DROP POLICY IF EXISTS pol_perfiles_editar_propio ON core.perfiles;
CREATE POLICY pol_perfiles_editar_propio ON core.perfiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT core.fn_es_admin_plataforma()))
  WITH CHECK (id = (SELECT auth.uid()) OR (SELECT core.fn_es_admin_plataforma()));

DROP POLICY IF EXISTS pol_accesos_leer ON core.accesos;
CREATE POLICY pol_accesos_leer ON core.accesos FOR SELECT TO authenticated
  USING (perfil_id = (SELECT auth.uid()) OR (SELECT core.fn_es_admin_plataforma()));
-- Alta/cambio de accesos: solo administradores (pantalla admin_accesos.html). Nunca DELETE: se desactiva.
DROP POLICY IF EXISTS pol_accesos_admin_crear ON core.accesos;
CREATE POLICY pol_accesos_admin_crear ON core.accesos FOR INSERT TO authenticated
  WITH CHECK ((SELECT core.fn_es_admin_plataforma()));
DROP POLICY IF EXISTS pol_accesos_admin_editar ON core.accesos;
CREATE POLICY pol_accesos_admin_editar ON core.accesos FOR UPDATE TO authenticated
  USING ((SELECT core.fn_es_admin_plataforma())) WITH CHECK ((SELECT core.fn_es_admin_plataforma()));

DROP POLICY IF EXISTS pol_destinatarios_leer ON core.destinatarios;
CREATE POLICY pol_destinatarios_leer ON core.destinatarios FOR SELECT TO authenticated
  USING ((SELECT core.fn_rol_en('DESPACHOS')) IS NOT NULL
         AND ((SELECT core.fn_mi_cuenta()) IS NULL OR cuenta_id = (SELECT core.fn_mi_cuenta())));
DROP POLICY IF EXISTS pol_destinatarios_escribir ON core.destinatarios;
CREATE POLICY pol_destinatarios_escribir ON core.destinatarios FOR INSERT TO authenticated
  WITH CHECK ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));
DROP POLICY IF EXISTS pol_destinatarios_actualizar ON core.destinatarios;
CREATE POLICY pol_destinatarios_actualizar ON core.destinatarios FOR UPDATE TO authenticated
  USING ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));

-- despachos: catálogos visibles para quien tenga acceso
DROP POLICY IF EXISTS pol_estados_leer ON despachos.estados;
CREATE POLICY pol_estados_leer ON despachos.estados FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_transiciones_leer ON despachos.transiciones;
CREATE POLICY pol_transiciones_leer ON despachos.transiciones FOR SELECT TO authenticated USING (true);

-- Solicitante ve las suyas; operador/consulta/admin ven todas (de su cuenta);
-- usuarios de NexusKPI leen para indicadores.
DROP POLICY IF EXISTS pol_solicitudes_leer ON despachos.solicitudes;
CREATE POLICY pol_solicitudes_leer ON despachos.solicitudes FOR SELECT TO authenticated
  USING (
    solicitante_id = (SELECT auth.uid())
    OR (
      ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','consulta','admin']))
        OR (SELECT core.fn_rol_en('KPI')) IS NOT NULL)
      AND ((SELECT core.fn_mi_cuenta()) IS NULL OR cuenta_id = (SELECT core.fn_mi_cuenta()))
    )
  );

DROP POLICY IF EXISTS pol_solicitud_lineas_leer ON despachos.solicitud_lineas;
CREATE POLICY pol_solicitud_lineas_leer ON despachos.solicitud_lineas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM despachos.solicitudes s WHERE s.id = solicitud_id));

DROP POLICY IF EXISTS pol_solicitud_eventos_leer ON despachos.solicitud_eventos;
CREATE POLICY pol_solicitud_eventos_leer ON despachos.solicitud_eventos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM despachos.solicitudes s WHERE s.id = solicitud_id));

-- inventario
DROP POLICY IF EXISTS pol_pasillos_leer ON inventario.pasillos;
CREATE POLICY pol_pasillos_leer ON inventario.pasillos FOR SELECT TO authenticated
  USING ((SELECT core.fn_rol_en('INVENTARIO')) IS NOT NULL OR (SELECT core.fn_rol_en('KPI')) IS NOT NULL);
DROP POLICY IF EXISTS pol_umbrales_leer ON inventario.umbrales_ocupacion;
CREATE POLICY pol_umbrales_leer ON inventario.umbrales_ocupacion FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pol_registros_pasillo_leer ON inventario.registros_pasillo;
CREATE POLICY pol_registros_pasillo_leer ON inventario.registros_pasillo FOR SELECT TO authenticated
  USING (((SELECT core.fn_rol_en('INVENTARIO')) IS NOT NULL OR (SELECT core.fn_rol_en('KPI')) IS NOT NULL)
         AND ((SELECT core.fn_mi_cuenta()) IS NULL OR cuenta_id = (SELECT core.fn_mi_cuenta())));

DROP POLICY IF EXISTS pol_registros_pasillo_crear ON inventario.registros_pasillo;
CREATE POLICY pol_registros_pasillo_crear ON inventario.registros_pasillo FOR INSERT TO authenticated
  WITH CHECK ((SELECT core.fn_tiene_rol('INVENTARIO', ARRAY['registrador','supervisor','admin'])));

-- Registrador: edita/anula lo suyo dentro de 24 h. Supervisor/admin: todo.
DROP POLICY IF EXISTS pol_registros_pasillo_editar ON inventario.registros_pasillo;
CREATE POLICY pol_registros_pasillo_editar ON inventario.registros_pasillo FOR UPDATE TO authenticated
  USING (
    (SELECT core.fn_tiene_rol('INVENTARIO', ARRAY['supervisor','admin']))
    OR (registrado_por = (SELECT auth.uid()) AND created_at > now() - interval '24 hours'
        AND anulado_at IS NULL
        AND (SELECT core.fn_tiene_rol('INVENTARIO', ARRAY['registrador'])))
  )
  WITH CHECK (
    (SELECT core.fn_tiene_rol('INVENTARIO', ARRAY['registrador','supervisor','admin']))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. MIGRACIÓN ÚNICA del historial de Redis (Inventario de Pasillos)
--    Uso (como admin, en SQL Editor):
--      SELECT inventario.fn_importar_historial_redis('<pegar aquí el JSON de GET /api/inventario>'::jsonb);
--    Formato esperado: {"historial":[{"fecha":"dd/mm/aaaa","hora":"HH:MM","pasillo":"IL",
--                       "posOcupadas":10,"posVacias":5,"usuario":"X","observaciones":""}]}
--    Después de migrar: DROP FUNCTION inventario.fn_importar_historial_redis(jsonb, uuid);
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventario.fn_importar_historial_redis(p_json jsonb, p_registrado_por uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO inventario.registros_pasillo
    (pasillo_id, registrado_at, posiciones_ocupadas, posiciones_vacias,
     usuario_operativo, observaciones, registrado_por, created_by)
  SELECT p.id,
         (to_timestamp(h.fecha || ' ' || COALESCE(h.hora,'00:00'), 'DD/MM/YYYY HH24:MI')::timestamp
            AT TIME ZONE 'America/Bogota'),
         COALESCE(h."posOcupadas",0), COALESCE(h."posVacias",0),
         upper(NULLIF(trim(h.usuario),'')), NULLIF(trim(h.observaciones),''),
         p_registrado_por, p_registrado_por
  FROM jsonb_to_recordset(p_json -> 'historial')
       AS h(fecha text, hora text, pasillo text, "posOcupadas" integer, "posVacias" integer,
            usuario text, observaciones text)
  JOIN inventario.pasillos p ON p.codigo = upper(h.pasillo);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
REVOKE EXECUTE ON FUNCTION inventario.fn_importar_historial_redis(jsonb, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- ARRANQUE (ejecutar aparte, una vez, reemplazando el correo)
-- -----------------------------------------------------------------------------
-- INSERT INTO core.accesos (perfil_id, aplicacion_codigo, rol)
-- SELECT p.id, a.codigo, 'admin'
-- FROM core.perfiles p CROSS JOIN core.aplicaciones a
-- WHERE p.email = 'tu_correo@dominio.com'
-- ON CONFLICT (perfil_id, aplicacion_codigo) DO UPDATE SET rol = EXCLUDED.rol;
--
-- Usuarios actuales de NexusKPI → conservan exactamente lo que tienen hoy
-- (acceso a KPI y a Operatividad con su rol actual de user_metadata):
-- INSERT INTO core.accesos (perfil_id, aplicacion_codigo, rol)
-- SELECT u.id, app.codigo,
--        CASE WHEN COALESCE(u.raw_app_meta_data->>'role', u.raw_user_meta_data->>'role') = 'admin'
--             THEN 'admin' ELSE 'viewer' END
-- FROM auth.users u JOIN core.perfiles p ON p.id = u.id
-- CROSS JOIN (VALUES ('KPI'), ('OPERATIVIDAD')) AS app(codigo)
-- ON CONFLICT (perfil_id, aplicacion_codigo) DO NOTHING;
-- =============================================================================


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 019 · 019_despachos_lotes_procesamiento.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 019_despachos_lotes_procesamiento.sql
-- Plataforma L&S · Portal de Despachos
--
-- QUÉ HACE
--  1. Deja SOLO dos estados operativos: RADICADA → PROCESADA.
--     Los estados anteriores (EN_ALISTAMIENTO, DESPACHADA, ENTREGADA, ANULADA)
--     quedan en el catálogo marcados como inactivos, solo para conservar el
--     historial; ya no se pueden asignar.
--  2. Crea el PROCESAMIENTO POR BLOQUE (lote): se marcan varias solicitudes
--     radicadas y pasan juntas a PROCESADA en UNA sola transacción
--     (todas o ninguna). Cada bloque recibe un número LOT-AAAA-######, que
--     permite volver a descargar su Excel consolidado.
--  3. Permite a un administrador REVERTIR un bloque (devuelve sus solicitudes
--     a RADICADA dejando el rastro en la línea de tiempo).
--
-- CÓMO EJECUTAR
--  Supabase → proyecto kpi-logistics → SQL Editor → pegar TODO → Run.
--  Es idempotente: se puede ejecutar más de una vez sin duplicar nada.
--  EJECUTAR ANTES de publicar la nueva versión del portal.
--
-- DATOS EXISTENTES
--  Las solicitudes que estén EN_ALISTAMIENTO, DESPACHADA o ENTREGADA pasan a
--  PROCESADA (queda el evento en su línea de tiempo). Las ANULADAS no se tocan.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo de estados: PROCESADA + marca de activo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE despachos.estados ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

INSERT INTO despachos.estados (codigo, nombre, orden, es_final)
VALUES ('PROCESADA', 'Procesada', 20, true)
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, es_final = EXCLUDED.es_final;

UPDATE despachos.estados SET orden = 10, es_final = false, activo = true WHERE codigo = 'RADICADA';
UPDATE despachos.estados SET activo = true WHERE codigo = 'PROCESADA';
UPDATE despachos.estados SET activo = false
 WHERE codigo IN ('EN_ALISTAMIENTO', 'DESPACHADA', 'ENTREGADA', 'ANULADA');
-- Orden de los históricos después de los dos vigentes
UPDATE despachos.estados SET orden = 91 WHERE codigo = 'EN_ALISTAMIENTO';
UPDATE despachos.estados SET orden = 92 WHERE codigo = 'DESPACHADA';
UPDATE despachos.estados SET orden = 93 WHERE codigo = 'ENTREGADA';

-- El cambio de estado individual queda cerrado: el único camino a PROCESADA
-- es el bloque (fn_procesar_lote), que deja la trazabilidad del lote.
DELETE FROM despachos.transiciones;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lotes (bloques de procesamiento)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS despachos.seq_lote_numero AS bigint START 1 CACHE 1;

CREATE TABLE IF NOT EXISTS despachos.lotes (
  id                 bigint GENERATED ALWAYS AS IDENTITY,
  numero             text        NOT NULL,
  idempotency_key    uuid        NOT NULL,
  cuenta_id          bigint,
  total_solicitudes  integer     NOT NULL,
  total_lineas       integer     NOT NULL,
  total_unidades     numeric(14,3) NOT NULL,
  comentario         text,
  procesado_at       timestamptz NOT NULL DEFAULT now(),
  procesado_by       uuid        NOT NULL,
  procesado_por      text        NOT NULL,          -- nombre visible de quien procesó
  revertido_at       timestamptz,
  revertido_by       uuid,
  motivo_reversion   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid                 DEFAULT auth.uid(),
  updated_at         timestamptz,
  updated_by         uuid,
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_lotes PRIMARY KEY (id),
  CONSTRAINT uq_lotes_numero          UNIQUE (numero),
  CONSTRAINT uq_lotes_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT fk_lotes_cuentas  FOREIGN KEY (cuenta_id)    REFERENCES core.cuentas (id),
  CONSTRAINT fk_lotes_perfiles FOREIGN KEY (procesado_by) REFERENCES core.perfiles (id),
  CONSTRAINT ck_lotes_totales   CHECK (total_solicitudes > 0 AND total_lineas > 0 AND total_unidades > 0),
  CONSTRAINT ck_lotes_reversion CHECK (revertido_at IS NULL OR COALESCE(trim(motivo_reversion), '') <> '')
);
CREATE INDEX IF NOT EXISTS ix_lotes_procesado_at ON despachos.lotes (procesado_at DESC);
COMMENT ON TABLE despachos.lotes IS 'Bloque de solicitudes procesadas juntas (un Excel consolidado por lote)';

ALTER TABLE despachos.solicitudes ADD COLUMN IF NOT EXISTS lote_id      bigint;
ALTER TABLE despachos.solicitudes ADD COLUMN IF NOT EXISTS procesada_at timestamptz;
ALTER TABLE despachos.solicitudes ADD COLUMN IF NOT EXISTS procesada_by uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_solicitudes_lotes') THEN
    ALTER TABLE despachos.solicitudes
      ADD CONSTRAINT fk_solicitudes_lotes FOREIGN KEY (lote_id) REFERENCES despachos.lotes (id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_solicitudes_lote ON despachos.solicitudes (lote_id);

-- Triggers estándar (updated_at/version + auditoría) para la tabla nueva
DROP TRIGGER IF EXISTS trg_lotes_actualizacion ON despachos.lotes;
CREATE TRIGGER trg_lotes_actualizacion BEFORE UPDATE ON despachos.lotes
  FOR EACH ROW EXECUTE FUNCTION core.fn_marcar_actualizacion();
DROP TRIGGER IF EXISTS trg_lotes_auditoria ON despachos.lotes;
CREATE TRIGGER trg_lotes_auditoria AFTER INSERT OR UPDATE OR DELETE ON despachos.lotes
  FOR EACH ROW EXECUTE FUNCTION core.fn_auditar();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Datos existentes: estados intermedios → PROCESADA
-- ─────────────────────────────────────────────────────────────────────────────
WITH migradas AS (
  UPDATE despachos.solicitudes s
     SET estado_codigo = 'PROCESADA',
         procesada_at  = COALESCE(
           (SELECT max(ev.created_at) FROM despachos.solicitud_eventos ev WHERE ev.solicitud_id = s.id),
           now())
   WHERE s.estado_codigo IN ('EN_ALISTAMIENTO', 'DESPACHADA', 'ENTREGADA')
  RETURNING s.id
)
INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario)
SELECT m.id,
       (SELECT ev.estado_nuevo FROM despachos.solicitud_eventos ev
         WHERE ev.solicitud_id = m.id ORDER BY ev.created_at DESC, ev.id DESC LIMIT 1),
       'PROCESADA',
       'Unificación de estados: el portal pasa a manejar solo Radicada y Procesada'
FROM migradas m;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: procesar un bloque de solicitudes (TODAS o NINGUNA)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_procesar_lote(
  p_solicitud_ids    bigint[],
  p_idempotency_key  uuid,
  p_comentario       text DEFAULT NULL
)
RETURNS TABLE (lote_id bigint, numero text, total_solicitudes integer, total_lineas integer,
               total_unidades numeric, procesado_at timestamptz, es_reintento boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid       uuid   := auth.uid();
  v_cuenta    bigint := core.fn_mi_cuenta();
  v_ids       bigint[];
  v_pedidas   integer;
  v_halladas  integer;
  v_no_rad    text;
  v_lineas    integer;
  v_unidades  numeric;
  v_lote_id   bigint;
  v_numero    text;
  v_nombre    text;
BEGIN
  -- 1) Autorización
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'DSP001: sesión no válida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['operador', 'admin']) THEN
    RAISE EXCEPTION 'DSP020: solo operadores o administradores pueden procesar solicitudes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2) Idempotencia: doble clic o reintento por red devuelve el MISMO lote
  RETURN QUERY
    SELECT l.id, l.numero, l.total_solicitudes, l.total_lineas, l.total_unidades, l.procesado_at, true
    FROM despachos.lotes l
    WHERE l.idempotency_key = p_idempotency_key AND l.procesado_by = v_uid;
  IF FOUND THEN RETURN; END IF;

  -- 3) Validación de la selección
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_solicitud_ids) AS x WHERE x IS NOT NULL;
  v_pedidas := COALESCE(array_length(v_ids, 1), 0);
  IF v_pedidas = 0 THEN
    RAISE EXCEPTION 'DSP021: seleccione al menos una solicitud' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pedidas > 500 THEN
    RAISE EXCEPTION 'DSP022: máximo 500 solicitudes por bloque (seleccionó %)', v_pedidas USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Bloqueo de filas en orden fijo (evita interbloqueos si dos operadores
  --    procesan al tiempo: el segundo espera y luego ve que ya no están radicadas)
  PERFORM 1 FROM despachos.solicitudes s
   WHERE s.id = ANY (v_ids)
     AND (v_cuenta IS NULL OR s.cuenta_id = v_cuenta)
   ORDER BY s.id
   FOR UPDATE;

  SELECT count(*),
         string_agg(s.numero || ' (' || e.nombre || ')', ', ' ORDER BY s.numero)
           FILTER (WHERE s.estado_codigo <> 'RADICADA'),
         sum(s.total_lineas), sum(s.total_unidades)
    INTO v_halladas, v_no_rad, v_lineas, v_unidades
    FROM despachos.solicitudes s
    JOIN despachos.estados e ON e.codigo = s.estado_codigo
   WHERE s.id = ANY (v_ids)
     AND (v_cuenta IS NULL OR s.cuenta_id = v_cuenta);

  IF v_halladas <> v_pedidas THEN
    RAISE EXCEPTION 'DSP023: % de las % solicitudes seleccionadas no existen o no pertenecen a su cuenta. Actualice la lista.',
      v_pedidas - v_halladas, v_pedidas USING ERRCODE = 'no_data_found';
  END IF;
  IF v_no_rad IS NOT NULL THEN
    RAISE EXCEPTION 'DSP024: estas solicitudes ya no están Radicadas: %. Actualice la lista y vuelva a seleccionar.', v_no_rad
      USING ERRCODE = 'check_violation';
  END IF;

  -- 5) Lote
  SELECT COALESCE(NULLIF(trim(p.nombre), ''), p.email) INTO v_nombre FROM core.perfiles p WHERE p.id = v_uid;
  v_numero := 'LOT-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
              || lpad(nextval('despachos.seq_lote_numero')::text, 6, '0');

  INSERT INTO despachos.lotes AS l (numero, idempotency_key, cuenta_id, total_solicitudes, total_lineas,
                                    total_unidades, comentario, procesado_by, procesado_por, created_by)
  VALUES (v_numero, p_idempotency_key, v_cuenta, v_pedidas, v_lineas, v_unidades,
          NULLIF(trim(p_comentario), ''), v_uid, COALESCE(v_nombre, 'Usuario'), v_uid)
  ON CONFLICT ON CONSTRAINT uq_lotes_idempotency_key DO NOTHING
  RETURNING l.id INTO v_lote_id;

  IF v_lote_id IS NULL THEN
    -- Carrera: otra petición con la misma llave ganó → devolver ese lote
    RETURN QUERY
      SELECT l.id, l.numero, l.total_solicitudes, l.total_lineas, l.total_unidades, l.procesado_at, true
      FROM despachos.lotes l
      WHERE l.idempotency_key = p_idempotency_key AND l.procesado_by = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DSP025: llave de idempotencia ya usada por otro usuario' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN;
  END IF;

  -- 6) Solicitudes → PROCESADA + evento en la línea de tiempo de cada una
  UPDATE despachos.solicitudes s
     SET estado_codigo = 'PROCESADA', lote_id = v_lote_id, procesada_at = now(), procesada_by = v_uid
   WHERE s.id = ANY (v_ids);

  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  SELECT x, 'RADICADA', 'PROCESADA',
         'Procesada en el bloque ' || v_numero || COALESCE(' · ' || NULLIF(trim(p_comentario), ''), ''),
         v_uid
  FROM unnest(v_ids) AS x;

  RETURN QUERY
    SELECT l.id, l.numero, l.total_solicitudes, l.total_lineas, l.total_unidades, l.procesado_at, false
    FROM despachos.lotes l WHERE l.id = v_lote_id;
END;
$$;
COMMENT ON FUNCTION despachos.fn_procesar_lote IS
  'Pasa un bloque de solicitudes RADICADAS a PROCESADA en una transacción (todas o ninguna). Idempotente por p_idempotency_key.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: revertir un bloque (solo administrador)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_revertir_lote(
  p_lote_id  bigint,
  p_motivo   text
)
RETURNS TABLE (lote_id bigint, numero text, solicitudes_revertidas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid     uuid   := auth.uid();
  v_cuenta  bigint := core.fn_mi_cuenta();
  v_lote    despachos.lotes%ROWTYPE;
  v_n       integer;
BEGIN
  IF v_uid IS NULL OR NOT core.fn_tiene_rol('DESPACHOS', ARRAY['admin']) THEN
    RAISE EXCEPTION 'DSP030: solo un administrador puede revertir un bloque' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'DSP031: la reversión requiere motivo' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_lote FROM despachos.lotes l
   WHERE l.id = p_lote_id AND (v_cuenta IS NULL OR l.cuenta_id = v_cuenta)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DSP032: el bloque % no existe', p_lote_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_lote.revertido_at IS NOT NULL THEN
    RAISE EXCEPTION 'DSP033: el bloque % ya fue revertido', v_lote.numero USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM despachos.solicitudes s WHERE s.lote_id = p_lote_id ORDER BY s.id FOR UPDATE;

  INSERT INTO despachos.solicitud_eventos (solicitud_id, estado_anterior, estado_nuevo, comentario, created_by)
  SELECT s.id, 'PROCESADA', 'RADICADA', 'Reversión del bloque ' || v_lote.numero || ' · ' || trim(p_motivo), v_uid
  FROM despachos.solicitudes s WHERE s.lote_id = p_lote_id;

  UPDATE despachos.solicitudes s
     SET estado_codigo = 'RADICADA', lote_id = NULL, procesada_at = NULL, procesada_by = NULL
   WHERE s.lote_id = p_lote_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE despachos.lotes l
     SET revertido_at = now(), revertido_by = v_uid, motivo_reversion = trim(p_motivo)
   WHERE l.id = p_lote_id;

  RETURN QUERY SELECT v_lote.id, v_lote.numero, v_n;
END;
$$;
COMMENT ON FUNCTION despachos.fn_revertir_lote IS
  'Devuelve a RADICADA todas las solicitudes de un bloque (solo admin, con motivo). El bloque queda marcado como revertido.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Vistas (las columnas nuevas van al final: CREATE OR REPLACE no permite reordenar)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW despachos.vw_solicitudes
WITH (security_invoker = true) AS
SELECT s.id, s.numero, s.version, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo,
       s.numero_pedido_origen, s.total_lineas, s.total_unidades,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.anulado_at, s.motivo_anulacion, s.cuenta_id,
       s.lote_id, l.numero AS lote_numero, s.procesada_at
FROM despachos.solicitudes s
JOIN despachos.estados e ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes l ON l.id = s.lote_id;

-- Bloques procesados (historial + re-descarga del Excel)
CREATE OR REPLACE VIEW despachos.vw_lotes
WITH (security_invoker = true) AS
SELECT l.id, l.numero, l.version, l.total_solicitudes, l.total_lineas, l.total_unidades,
       l.comentario, l.procesado_at, (l.procesado_at AT TIME ZONE 'America/Bogota')::date AS fecha_proceso,
       l.procesado_por, l.revertido_at, l.motivo_reversion, l.cuenta_id
FROM despachos.lotes l;

-- Líneas consolidadas de un bloque (una sola consulta para armar el Excel)
CREATE OR REPLACE VIEW despachos.vw_lote_lineas
WITH (security_invoker = true) AS
SELECT s.lote_id, s.id AS solicitud_id, s.numero AS solicitud_numero, s.area_solicitante,
       s.solicitante_nombre, s.origen, s.numero_pedido_origen, s.radicada_at,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_ciudad, li.material, li.producto_descripcion, li.cantidad, li.um, li.item, li.bodega
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
WHERE s.lote_id IS NOT NULL;

-- KPI diario: se agrega el conteo de procesadas
CREATE OR REPLACE VIEW despachos.vw_kpi_solicitudes_diario
WITH (security_invoker = true) AS
SELECT (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha,
       to_char(s.radicada_at AT TIME ZONE 'America/Bogota', 'YYYY-MM') AS mes_id,
       s.area_solicitante, s.origen,
       count(*)                                          AS solicitudes,
       count(*) FILTER (WHERE s.estado_codigo = 'ANULADA') AS anuladas,
       sum(s.total_lineas)                               AS lineas,
       sum(s.total_unidades)                             AS unidades,
       count(*) FILTER (WHERE s.estado_codigo = 'PROCESADA') AS procesadas
FROM despachos.solicitudes s
GROUP BY 1, 2, 3, 4;

-- KPI de ciclo: tiempo de radicada a procesada
CREATE OR REPLACE VIEW despachos.vw_kpi_ciclo_solicitud
WITH (security_invoker = true) AS
SELECT s.id, s.numero, s.area_solicitante, s.estado_codigo, s.radicada_at,
       max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'EN_ALISTAMIENTO') AS alistamiento_at,
       max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'DESPACHADA')      AS despachada_at,
       max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'ENTREGADA')       AS entregada_at,
       round(extract(epoch FROM (max(ev.created_at) FILTER (WHERE ev.estado_nuevo = 'DESPACHADA')
                                 - s.radicada_at)) / 3600.0, 2)              AS horas_radicada_a_despacho,
       s.procesada_at,
       round(extract(epoch FROM (s.procesada_at - s.radicada_at)) / 3600.0, 2) AS horas_radicada_a_procesada
FROM despachos.solicitudes s
LEFT JOIN despachos.solicitud_eventos ev ON ev.solicitud_id = s.id
GROUP BY s.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Permisos y RLS
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON despachos.lotes FROM anon, authenticated;
REVOKE ALL ON SEQUENCE despachos.seq_lote_numero FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION despachos.fn_procesar_lote(bigint[], uuid, text),
                           despachos.fn_revertir_lote(bigint, text) FROM PUBLIC, anon;

GRANT SELECT ON despachos.lotes, despachos.vw_solicitudes, despachos.vw_lotes, despachos.vw_lote_lineas,
                despachos.vw_kpi_solicitudes_diario, despachos.vw_kpi_ciclo_solicitud TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_procesar_lote(bigint[], uuid, text),
                          despachos.fn_revertir_lote(bigint, text) TO authenticated;

GRANT ALL ON despachos.lotes TO service_role;
GRANT ALL ON SEQUENCE despachos.seq_lote_numero TO service_role;
GRANT SELECT ON despachos.vw_lotes, despachos.vw_lote_lineas TO service_role;
GRANT EXECUTE ON FUNCTION despachos.fn_procesar_lote(bigint[], uuid, text),
                          despachos.fn_revertir_lote(bigint, text) TO service_role;

ALTER TABLE despachos.lotes ENABLE ROW LEVEL SECURITY;

-- Ven los bloques: operador / consulta / admin de Despachos y usuarios de NexusKPI.
-- (Escritura solo por las funciones fn_procesar_lote / fn_revertir_lote.)
DROP POLICY IF EXISTS pol_lotes_leer ON despachos.lotes;
CREATE POLICY pol_lotes_leer ON despachos.lotes FOR SELECT TO authenticated
  USING (
    ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador', 'consulta', 'admin']))
      OR (SELECT core.fn_rol_en('KPI')) IS NOT NULL
      OR procesado_by = (SELECT auth.uid()))
    AND ((SELECT core.fn_mi_cuenta()) IS NULL OR cuenta_id = (SELECT core.fn_mi_cuenta()))
  );

COMMIT;

-- Recarga el esquema de la API para que las vistas y funciones nuevas queden disponibles de inmediato
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACIÓN (ejecutar aparte)
--   SELECT codigo, nombre, activo FROM despachos.estados ORDER BY orden;
--     → RADICADA y PROCESADA con activo = true; el resto en false.
--   SELECT estado_codigo, count(*) FROM despachos.solicitudes GROUP BY 1;
--     → solo RADICADA / PROCESADA (y ANULADA si había anuladas).
--
-- SI HAY QUE VOLVER ATRÁS
--   Publicar de nuevo la versión anterior del portal (Vercel → Promote) NO basta:
--   esa versión usa los estados anteriores. Para reabrirlos:
--     UPDATE despachos.estados SET activo = true;
--     INSERT INTO despachos.transiciones VALUES
--       ('RADICADA','EN_ALISTAMIENTO'), ('RADICADA','ANULADA'),
--       ('EN_ALISTAMIENTO','DESPACHADA'), ('EN_ALISTAMIENTO','ANULADA'),
--       ('DESPACHADA','ENTREGADA') ON CONFLICT DO NOTHING;
--   Las tablas, columnas y funciones nuevas pueden quedarse: no estorban.
-- =============================================================================


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 020 · 020_despachos_toma_pedidos_fase3.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 020_despachos_toma_pedidos_fase3.sql
-- Plataforma L&S · Portal de Despachos · Toma de pedidos fase 3 (19-oct-2026)
--
-- QUÉ HACE
--  1. Maestro de destinatarios: agrega DIRECCIÓN, DEPARTAMENTO y TELÉFONO
--     (quedan vacíos hasta que se carguen; el portal los usa si existen).
--  2. Crea el maestro core.item_ean (Item / EAN / Descripción) y lo carga con
--     la hoja "MAESTRO ACTUAL" de DESPACHOS.xlsx (257 ítems).
--  3. Líneas de solicitud: guardan EAN, dirección, departamento y teléfono
--     del destinatario (foto del dato al radicar, igual que NIT y nombre).
--  4. fn_crear_solicitud: recibe esos campos y, si llegan vacíos, los
--     completa con los maestros (EAN por SKU; dirección/depto/teléfono por NIT).
--  5. Vista despachos.vw_solicitud_lineas: una fila por línea con todos los
--     campos de la plantilla (tabla "Solicitudes de hoy" y descargas).
--
-- CÓMO EJECUTAR
--  Supabase → proyecto kpi-logistics → SQL Editor → pegar TODO → Run.
--  Es idempotente (se puede ejecutar más de una vez).
--  EJECUTAR ANTES de publicar la nueva versión del portal.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Maestro de destinatarios: campos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS direccion    text;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS departamento text;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS telefono     text;
COMMENT ON COLUMN core.destinatarios.direccion    IS 'Dirección de entrega del destinatario (pendiente de cargar)';
COMMENT ON COLUMN core.destinatarios.departamento IS 'Departamento del destinatario (pendiente de cargar)';
COMMENT ON COLUMN core.destinatarios.telefono     IS 'Teléfono de contacto del destinatario';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Maestro Item / EAN
-- ─────────────────────────────────────────────────────────────────────────────
-- SKU base: quita espacios y el sufijo de año que traen los PDF de Click
--   'PTC7300-2025' → 'PTC7300' · 'PTC8200 - 2026' → 'PTC8200' · 'MP0205-1' → 'MP0205-1'
CREATE OR REPLACE FUNCTION core.fn_sku_base(p_sku text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(regexp_replace(upper(regexp_replace(COALESCE(p_sku, ''), '\s+', '', 'g')), '-(19|20)[0-9]{2}$', ''), '')
$$;
COMMENT ON FUNCTION core.fn_sku_base(text) IS 'Normaliza el SKU del PDF al código del maestro Item/EAN (sin espacios ni sufijo -AAAA)';

CREATE TABLE IF NOT EXISTS core.item_ean (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  cuenta_id    bigint,
  item         text        NOT NULL,
  ean          text        NOT NULL,
  descripcion  text,
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid                 DEFAULT auth.uid(),
  updated_at   timestamptz,
  updated_by   uuid,
  version      integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_item_ean PRIMARY KEY (id),
  CONSTRAINT fk_item_ean_cuentas FOREIGN KEY (cuenta_id) REFERENCES core.cuentas (id),
  CONSTRAINT uq_item_ean_cuenta_item UNIQUE NULLS NOT DISTINCT (cuenta_id, item),
  CONSTRAINT ck_item_ean_item_mayus CHECK (item = upper(trim(item)) AND item <> ''),
  CONSTRAINT ck_item_ean_ean CHECK (trim(ean) <> '')
);
CREATE INDEX IF NOT EXISTS ix_item_ean_ean         ON core.item_ean (ean);
CREATE INDEX IF NOT EXISTS ix_item_ean_descripcion ON core.item_ean (lower(descripcion));
COMMENT ON TABLE  core.item_ean             IS 'Maestro Item / EAN: código de barras de cada SKU (fuente: hoja MAESTRO ACTUAL de DESPACHOS.xlsx)';
COMMENT ON COLUMN core.item_ean.item        IS 'Código del ítem / SKU base (ej. PTC7300). El PDF puede traerlo con sufijo de año (PTC7300-2025)';
COMMENT ON COLUMN core.item_ean.ean         IS 'Código EAN (código de barras) que se envía al WMS';
COMMENT ON COLUMN core.item_ean.descripcion IS 'Descripción del producto';

DROP TRIGGER IF EXISTS trg_item_ean_actualizacion ON core.item_ean;
CREATE TRIGGER trg_item_ean_actualizacion BEFORE UPDATE ON core.item_ean
  FOR EACH ROW EXECUTE FUNCTION core.fn_marcar_actualizacion();
DROP TRIGGER IF EXISTS trg_item_ean_auditoria ON core.item_ean;
CREATE TRIGGER trg_item_ean_auditoria AFTER INSERT OR UPDATE OR DELETE ON core.item_ean
  FOR EACH ROW EXECUTE FUNCTION core.fn_auditar();

-- Carga inicial (MAESTRO ACTUAL). Si el ítem ya existe, actualiza EAN y descripción.
INSERT INTO core.item_ean (item, ean, descripcion) VALUES
  ('11000101', '77011000101', 'COUNTER MUEBLE STAND'),
  ('1111000111', '7701111000111', 'EXHIBIDOR TORRE'),
  ('1313000113', '7701313000113', 'DUMMIE PERFUME'),
  ('1414000114', '7701414000114', 'DUMMIE MIEL'),
  ('1515000115', '7701515000115', 'CAJONERA CON 2 ALAS'),
  ('1616000116', '7701616000116', '1 PISO CAUCHO'),
  ('1717000117', '7701717000117', 'HABLADOR EN METAL'),
  ('1818000118', '7701818000118', 'AVISO LUMINOSO'),
  ('1919000119', '7701919000119', 'NEVERA'),
  ('2020000120', '7702020000120', 'ESTANTERIA ALTA'),
  ('2121000121', '7702121000121', 'RULETA BRANDEADA'),
  ('2222000122', '7702222000122', 'ESPEJO TOCADOR'),
  ('2323000123', '7702323000123', 'LAMPARA ESCRITORIO'),
  ('2424000124', '7702424000124', 'CILINDORS METAL EXHIBIDORES GRANDE'),
  ('2525000125', '7702525000125', 'CILINDORS METAL EXHIBIDORES MEDIANO'),
  ('2626000126', '7702626000126', 'CILINDORS METAL EXHIBIDORES PEQUEÑO'),
  ('2828000128', '7702828000128', 'STAND EVA'),
  ('2929000129', '7702929000129', 'POP BLACKDAYS'),
  ('3030000130', '7703030000130', 'POLI SOMBRA'),
  ('33000103', '77033000103', 'ESTRUCTURA PISO SILLA ACOLCHADA'),
  ('3434000134', '7703434000134', 'MUEBLE REDONDO CON CAJONERA'),
  ('3434000135', '7703434000135', 'DUMMI PERFUME DE MIEL (2 PIEZAS)'),
  ('3434000136', '7703434000136', 'ESTRUCTURA SUPERIOR MAQUINA VENDIG INSSA'),
  ('3434000137', '7703434000137', 'STAN SPO BELLEZA'),
  ('3434000138', '3434000138', 'BOLSA ROSADA GRANDE MARKETING'),
  ('3434000139', '3434000139', 'CONCHA CLICK'),
  ('3434000140', '3434000140', 'MUEBLE VENTAS'),
  ('3434000141', '7703434000141', 'GLORIFICADOR PIEZA 1'),
  ('3434000142', '7703434000142', 'GLORIFICADOR PIEZA 2'),
  ('3434000143', '7703434000143', 'VITRINA NEVERA'),
  ('3434000144', '7703434000144', 'BODEGA GLORIFICADOR'),
  ('3434000145', '7703434000145', 'COUNTER CIRCULAR'),
  ('3434000146', '7703434000146', 'DUMMY VASO CON BASE'),
  ('3434000148', '7703434000148', 'BASE PARA AVISOS'),
  ('3434000149', '7703434000149', 'DINTELES CHORRIADOS'),
  ('3434000150', '7703434000150', 'CABEZOTES PARA VITRINAS'),
  ('3434000151', '7703434000151', 'AVISOS GRANDES'),
  ('3434000152', '7703434000152', 'REFUERZO TUBO 2" REDONDO'),
  ('44000104', '77044000104', 'VITRINA/BODEGA HAIR STAND'),
  ('66000106', '77066000106', 'VITRINA/BODEGA BODY STAND'),
  ('77000107', '77077000107', 'EXIBIDOR BLANCO'),
  ('88000108', '77088000108', 'RULETA STAND'),
  ('99000109', '77099000109', 'PUFF STAND'),
  ('MK9311', '770MK9311', 'CAMISETAS FERIA MARKETING'),
  ('MKT05', '770MKT05', 'UNIFORMES LECHERO MUJER'),
  ('MKT058', '770MKT058', 'UNIFORMES LECHERO'),
  ('MKT059', '770MKT059', 'UNIFORMES APIARIO'),
  ('MKT060', '770MKT060', 'GORRAS LECHERO 1'),
  ('MKT061', '770MKT061', 'GORRAS LECHERO 2'),
  ('MP0100', '770MP0100', 'FOIL AUTOADHESIVO (SH + ENERG + ACOND)'),
  ('MP0203', '770MP0203', 'ENVASE CILINDRICO 20ML DE 5.3 GR'),
  ('MP0204', '770MP0204', 'ENVASE PERFUME CAPILAR 120 ML'),
  ('MP0205', '770MP0205', 'ENVASE CILINDRICO Y TAPA 250 ML (SH + ENERG)'),
  ('MP0205-0', '770MP0205-0', 'ENVASE CILINDRICO 250 ML (SH + ENERG)'),
  ('MP0205-1', '770MP0205-1', 'TAPA ENVASE CILINDRICO Y TAPA 250 ML (SH + ENERG)'),
  ('MP0301', '770MP0301', 'VALVULA 18/415 NATURAL LISA'),
  ('MP0302', '770MP0302', 'MINI GATILLO PERFUME CAPILAR'),
  ('MP0400', '770MP0400', 'ETQ PERFUME PARA EL CABELLO MINI 20ML'),
  ('MP0401', '770MP0401', 'ETIQUETA SELLO AGITE ANTES DE USAR'),
  ('MP0403', '770MP0403', 'ETQ PERFUEM PARA EL CABELLO 120 ML'),
  ('MP0501', '770MP0501', 'BANDA PVC35 MIC TRNASP ABIERTA GRAFILADA 165MM X90 MM MANTEQUILLA CORPOPRAL'),
  ('MP0602', '770MP0602', 'CAJA EMBALAJE MINI'),
  ('MP0603', '770MP0603', 'CAJA EMBALAJE PEQUEÑA'),
  ('MP0604', '770MP0604', 'CAJA EMBALAJE MEDIANA'),
  ('MP0605', '770MP0605', 'CAJA EMBALAJE GRANDE'),
  ('MP0608', '770MP0608', 'CAJA KIT PERFUME X3 MIX'),
  ('MP0610', '770MP0610', 'CINTA PARA EMBALAJE'),
  ('MP1101', '770MP1101', 'ETQ ACONDICIONADOR 4EN 1-ET14641V00'),
  ('MP1103', '770MP1103', 'ENVASE ACONDICIONADOR 300 ML CON TAPA FLIP TOP'),
  ('MP1105', '770MP1105-1', 'TERMOENCOGIBLE ACONDICIONADOR 300ML'),
  ('MP1702', '770MP1702', 'ETQ ENERGIZANTE 300ML'),
  ('MP2103', '770MP2103', 'ENVASE EXFOLIANTE SIN ETIQUETA'),
  ('MP2104', '770MP2104', 'ENVASE EXFOLIANTE CON ETIQUETA'),
  ('MP2402', '770MP2402', 'CAJA CLICK GUM 240 MG'),
  ('MP2403', '770MP2403', 'ETIQUETA ENVASE GUMMIES CABELLO'),
  ('MP2601', '770MP2601', 'CREMERA -GATILLO JABON CREMOSO'),
  ('MP2701', '770MP2701', 'ENVASE MANTEQUILLA CORPORAL 250G'),
  ('MP2702', '770MP2702', 'ETIQUETA RESPALDO MANTEQUILLA CORPORL 250ML ET-14853V00'),
  ('MP2703', '770MP2703', 'ETIQUETA FRENTE MANTEQUILLA CORPORL 250ML ET-14852 V00'),
  ('MP2802', '770MP2802', 'TAPA MIEL CAPILAR 50 ML'),
  ('MP2803', '770MP2803', 'ETIQUETA MIEL PARA EL CABELLO 50 ML RESPALDO'),
  ('MP2804', '770MP2804', 'ETIQUETA MIEL PARA EL CABELLO 50 ML FRENTE'),
  ('MP2807', '770MP2807', 'TERMOENCOGIBLE MIEL CAPILAR 50ML'),
  ('MP4002', '770MP4002', 'CONTRA ETQ PERFUME PARA EL CABELLO AMARILLO'),
  ('MP4102', '770MP4102', 'ETQ DORSO PERFUME AZUL 120ML'),
  ('MP4202', '770MP4202', 'ETQ DORSO PERFUME MORADO 120ML'),
  ('MP4803', '770MP4803', 'ETIQUETA SHAMPOO DE AJI 300 ML'),
  ('MP4806', '770MP4806', 'ETIQUETA SHAMPOO MIEL X 300ML (ENVOLVENTE)'),
  ('MP4808', '770MP4808', 'ENVASE SHAMPOO MIEL X 300ML'),
  ('MP4809', '770MP4809', 'TAPA SHAMPOO MIEL'),
  ('MP5401', '770MP5401', 'ENVASE JABON CREMOSO 250 ML'),
  ('MP5403', '770MP5403', 'ETIQUETA SPRAY DE ONDAS'),
  ('MP5601', '770MP5601', 'ENVASE SUERO RECONSTRUCTOR CON TAPA FLIP TOP 120 ML (SIN IMPRESIÓN)'),
  ('MP5602', '770MP5602', 'ETIQUETA SUERO RECONSTRUCTOR 120 ML'),
  ('MP5702', '770MP5702', 'TERMOENCOGIBLE SUERO RECONSTRUCTOR 120ML'),
  ('MP5801', '770MP5801', 'ENVASE PET BALA TONICO 120ML'),
  ('MP5802', '770MP5802', 'ETIQUETA TONICO CAPILAR 120ML ET14759V00'),
  ('MP5902', '770MP5902', 'ETIQUETA TONICO 60 ML'),
  ('MP5905', '770MP5905', 'BANDA PVC 35MIC TRANSP SELLO CURVO CONICO B TONICO CAPILAR 120ML 75MM X170 MM'),
  ('MP5906', '770MP5906', 'ENVASE BALA ROSADO 60ML'),
  ('MP5907', '770MP5907', 'SPRAY ROSA TONICO'),
  ('MP5908', '770MP5908', 'ANILLO PERFUME CAPILAR DE MIEL 100 ML (NACIONAL)'),
  ('MP5909', '770MP5909', 'SPRAY PERFUME MIEL CAPILAR 100 ML (NACIONAL)'),
  ('MP5911', '770MP5911', 'ETIQUETA TÓNICO DE AJI 60 ML'),
  ('MP7403', '770MP7403', 'ETIQUETA MASCARILLA MIEL X300ML'),
  ('MP7404', '770MP7404', 'CAJA MASCARILLA MIEL X 300ML'),
  ('MP7406', '770MP7406', 'ESPATULA ROSADA MASCARILLA'),
  ('MP7407', '770MP7407', 'LINER MASCARILLA DE MIEL X 300 ML'),
  ('MP7409', '770MP7409', 'TAPA MASCARILLA MIEL X300ML'),
  ('MP8101', '770MP8101', 'TERMOENCOGIBLE PERFUME MINI 40 ML'),
  ('MP8204', '770MP8204', 'CAJA PERFUME MIEL 100 ML'),
  ('MP8208', '770MP8208', 'ANILLO PERFUME CAPILAR DE MIEL BRILLO INTENSO 100ML'),
  ('MP8210', '770MP8210', 'TAPA PERFUME MIEL 100ML'),
  ('MP8302', '770MP8302', 'ENVASE DE MIEL CAPILAR 15ML'),
  ('MP8304', '770MP8304', 'ETIQUETA MIEL CAPILAR 15 ML'),
  ('MP8306', '770MP8306', 'TERMOENCOGIBLE MIEL CAPILAR 15 ML'),
  ('MP8802', '770MP8802', 'ENVASE ACONDICIONADOR MIEL 300ML'),
  ('MP8802-1', '770MP8802-1', 'TAPA ENVASE ACONDICIONADOR MIEL 300ML'),
  ('MP9002', '770MP9002', 'ENVASE PERFUME PRINCESA ROSADO 100 ML'),
  ('MP9006', '770MP9006', 'TAPA PERFUME PRINCESA ROSADO 100ML'),
  ('MP9007', '770MP9007', 'VALVULA PERFUME PRINCESA ROSADO 100ML'),
  ('MP9105', '770MP9105', 'TERMOENCOGIBLE PERFUME PRINCESA 100ML'),
  ('MP9107', '770MP9107', 'ENVASE PERFUME CORPORAL Y CAPILAR 100 ML'),
  ('MP9110', '770MP9110', 'TAPA PERFUME PLACE GARDEN( ROSA) 100ML'),
  ('MP9112', '770MP9112', 'SPRAY NEGRO PERFUME CORPORAL Y CAPILAR PALACE GARDEN 100 ML'),
  ('MP9113', '770MP9113', 'ENVASE PERFUME CORPORAL Y CAPILAR PALACE GARDEN 100 ML'),
  ('MP9115', '770MP9115', 'TAPA PERFUME MERMAID KISS (VERDE) 100ML'),
  ('MP9117', '770MP9117', 'ANILLO NEGRO PERFUME CORPORAL Y CAPILAR MERMAID KISS 100 ML'),
  ('MP9118', '770MP9118', 'SPRAY NEGRO PERFUME CORPORAL Y CAPILAR MERMAID KISS 100 ML'),
  ('MP9119', '770MP9119', 'CAJA PERFUME CAPILAR MASMELO 100ML'),
  ('MP9120', '770MP9120', 'TAPA PERFUME CAPILAR DE MASMELO 100ML'),
  ('MP9121', '770MP9121', 'ENVASE IMPRESO PERFUME CAPILAR DE MASMELO 100ML'),
  ('MP9122', '770MP9122', 'ENVASE PERFUME CORPORAL Y CAPILAR MERMAID KISS 100ML'),
  ('MP9124', '770MP9124', 'CAJA PERFUME CAPILAR PISTACHO 100ML'),
  ('MP9125', '770MP9125', 'TAPA PERFUME CAPILAR DE PISTACHO 100ML'),
  ('MP9126', '770MP9126', 'ENVASE IMPRESO PERFUME CAPILAR DE PISTACHO 100ML'),
  ('MP9133', '770MP9133', 'TAPA PERFUME CAPILAR SEDUCTION FLOWER 100 ML'),
  ('MP9134', '770MP9134', 'SPRAY PERFUME CAPILAR CANDY TOY 100ML'),
  ('MP9135', '770MP9135', 'TAPA PERFUME CAPILAR CANDY TOY 100 ML'),
  ('MP9137', '770MP9137', 'TAPA PERFUME CAPILAR TROPICAL CRUSH 100 ML'),
  ('MP9138', '770MP9138', 'SPRAY PERFUME CAPILAR MOCCA 100 ML'),
  ('MP9139', '770MP9139', 'TAPA PERFUME CAPILAR MOCCA 100 ML'),
  ('MP9140', '770MP9140', 'SPRAY PERFUME CAPILAR VAINILLA GLASEADA 100 ML'),
  ('MP9141', '770MP9141', 'TAPA PERFUME CAPILAR VAINILLA GLASEADA 100 ML'),
  ('MP9143', '770MP9143', 'TAPA PERFUME CAPILAR GOLDEN TOFFE 100 ML'),
  ('MP9144', '770MP9144', 'SPRAY PERFUME CAPILAR SEDUCTION FLOWER 32 ML'),
  ('MP9145', '770MP9145', 'TAPA PERFUME CAPILAR SEDUCTION FLOWER 32 ML'),
  ('MP9146', '770MP9146', 'SPRAY PERFUME CAPILAR CANDY TOY 32 ML'),
  ('MP9147', '770MP9147', 'TAPA PERFUME CAPILAR CANDY TOY 32 ML'),
  ('MP9148', '770MP9148', 'SPRAY PERFUME CAPILAR TROPICAL CRUSHY 32 ML'),
  ('MP9149', '770MP9149', 'TAPA PERFUME CAPILAR TROPICAL CRUSHY 32 ML'),
  ('MP9158', '770MP9158', 'ENVASE IMPRESO PERFUME CAPILAR CANDY TOY 100 ML'),
  ('MP9159', '770MP9159', 'ENVASE IMPRESO PERFUME CAPILAR TROPICAL CRUSH 100 ML'),
  ('MP9160', '770MP9160', 'ENVASE PERFUME CAPILAR MOCCA 100ML'),
  ('MP9162', '770MP9162', 'PERFUME CAPILAR GOLDEN TOFFEE 100ML'),
  ('MP9163', '770MP9163', 'ENVASE PERFUME CAPILAR SEDUCTION FLOWER 32ML'),
  ('MP9164', '770MP9164', 'ENVASE PERFUME CAPILAR CANDY TOY 32ML'),
  ('MP9165', '770MP9165', 'ENVASE PERFUME CAPILAR TROPICAL CRUSH 32ML'),
  ('MP9166', '770MP9166', 'ENVASE PERFUME CAPILAR MOCCA 32ML'),
  ('MP9167', '770MP9167', 'PERFUME CAPILAR VAINILLA GLASEADA 32ML'),
  ('MP9168', '770MP9168', 'ENVASE PERFUME CAPILAR GOLDEN TOFFEE 32ML'),
  ('MP9169', '770MP9169', 'CAJA MASTER MINI PERFUME PARA EL CABELLO 32 ML'),
  ('MP9171', '770MP9171', 'CAJA MASTER ACONDICIONADOR 300 ML'),
  ('MP9172', '770MP9172', 'CAJA MASTER TONICO CAPILAR AJI 60 ML'),
  ('MP9173', '770MP9173', 'TERMOENCOGIBLE DEL TERMO PROTECTOR BIFASICO LECHE Y MIEL 150 ML'),
  ('MP9200', '770MP9200', 'CAJA EMBALAJE PERFUME PARA EL CABELLO 120 ML'),
  ('MP9201', '770MP9201', 'CAJA MASTER MIEL CAPILAR 15 ML'),
  ('MP9202', '770MP9202', 'CAJA EMBALAJE ENERGIZANTE'),
  ('MP9203', '7700MP9203', 'CAJA CORRUMED DE MASCARILLA - MANTEQUILLA'),
  ('MP9204', '770MP9204', 'CAJA DE EMBALAJE ACONDICIONADOR DE MIEL 300 ML'),
  ('MP9206', '770MP9206', 'TERMO ENCOGIBLE TONICO CAPILAR 60 ML'),
  ('MP9207', '770MP9207', 'CAJA CORRUGADO MIEL 50ML'),
  ('MP9208', '770MP9208', 'CAJA EMBALAJE PERFUME MIEL 100ML'),
  ('MP9210', '770MP9210', 'FOIL N28 AUTOADHESIVO ENVASE SHAMPOO MIEL 300 ML'),
  ('MP9235', '770MP9235', 'ENVASE PERFUME CAPILAR MOCCA 100 ML'),
  ('MP9240', '770MP9240', 'ENVASE PERFUME CAPILAR VAINILLA GLASEADA 100 ML'),
  ('MP9242', '770MP9242', 'CAJA DE LUJO 26,6X13X8 CM'),
  ('MP9278', '770MP9278', 'SPRAY Y TAPA TERMO PROTECTOR BIFASICO LECHE Y MIEL 150 ML'),
  ('MP9281', '770MP9281', 'CAJA MASTER TERMOPROTECTOR BIFASICO LECHE Y MIEL X12 UNDS'),
  ('MP9284', '770MP9284', 'ETIQUETA MIEL CAPILAR 50 ML (ENVOLVENTE)'),
  ('MP9298', '770MP9298', 'CAJA PERFUMES SUGAR FLOWER 32 ML X 3 UND'),
  ('MP9299', '770MP9299', 'CAJA PERFUMES VANILLA CANDY 32 ML X 3 UND'),
  ('MP9300', '770MP9300', 'CAJA PERFUMES CREAMY CAKE 32 ML X 3 UND'),
  ('MP9312', '770MP9312', 'ENVASE IMPRESO MIEL CAPILAR 50 ML'),
  ('MP9325', '770MP9325', 'ENVASE IMPRESO PERFUME CAPILAR DE MIEL BRILLO INTENSO 100ML (NACIONAL)'),
  ('MP9672', '770MP9672', 'CAJA PLEGADIZA MASCARILLA DE PROTEINA 300ML'),
  ('MP9672-1', '770MP9672-1', 'PARRILLA PLEGADIZA MASCARILLA DE PROTEINA 300ML'),
  ('MP9678', '770MP9678', 'CAJA MASTER SHAMPOO PROTEINA'),
  ('MP9679', '770MP9679', 'CAJA MASTER MASCARILLA 300ML'),
  ('PT0003', '770PT0003', 'BOLSA X 10 UNIDADES'),
  ('PT0005', '770PT0005', 'CAJA ROSA MEDIANA'),
  ('PT0006', '770PT0006', 'CAJA ROSA PEQUEÑA'),
  ('PT0007', '659525889708', 'BOLSA MINI X 10'),
  ('PT008', '770PT008', 'BOLSA BIODEGRADABLE E-COMERCE'),
  ('PT009', '770PT009', 'BOLSA BIODEGRADABLE E-COMERCE PEQUEÑA'),
  ('PTB2100', '658325658415', 'EXFOLIANTE CORPORAL'),
  ('PTB2600', '658325658408', 'JABON CREMOSO'),
  ('PTB2700', '658325658392', 'MANTEQUILLA CORPORAL'),
  ('PTC1100', '781718679381', 'ACONDICIONADOR 4 EN 1 300ML'),
  ('PTC2800', '781718679428', 'MIEL PARA EL CABELLO 50ML'),
  ('PTC3100', '770PTC3100', 'PERFUME PARA EL CABELLO AMARILLO CONT 20 ML'),
  ('PTC3200', '770PTC3200', 'PERFUME PARA EL CABELLO AZUL CONT 20 ML'),
  ('PTC3300', '770PTC3300', 'PERFUME PARA EL CABELLO MORADO CONT 20 ML'),
  ('PTC3500', '770PTC3500', 'PERFUME PARA EL CABELLO VERDE CONT 20 ML'),
  ('PTC4000', '6595258896610', 'PERFUME PARA EL CABELLO AMARILLO 120ML'),
  ('PTC4100', '770PTC4100', 'PERFUME PARA EL CABELLO AZUL 120ML'),
  ('PTC4200', '781718679350', 'PERFUME PARA EL CABELLO MORADO 120ML'),
  ('PTC4300', '659525889630', 'PERFUME ROSADO 120ML'),
  ('PTC4400', '659525889647', 'PERFUME PARA EL CABELLO VERDE 120ML'),
  ('PTC4805', '677144930236', 'SHAMPOO DE AJI 300 ML'),
  ('PTC5400', '770PTC5400', 'SPRAY MOLDEADOR DE ONDAS'),
  ('PTC5600', '781718679367', 'SUERO RECONSTRUCTOR 120ML'),
  ('PTC5900', '659525889678', 'TONICO CAPILAR 60ML'),
  ('PTC6100', '781718679398', 'ENERGIZANTE CAPILAR 300ML'),
  ('PTC6600', '799192109102', 'PERFUME PARA EL CABELLO TRANSPARENTE 120ML'),
  ('PTC6700', '799192109119', 'PERFUME PARA EL CABELLO NARANJADO 120ML'),
  ('PTC7100', '770PTC7100', 'PERFUME PARA EL CABELLO TRASPARENTE CONT 20 ML'),
  ('PTC7200', '770PTC7200', 'PERFUME PARA EL CABELLO NARANJADO CONT 20 ML'),
  ('PTC7300', '799192109157', 'SHAMPOO MIEL X 300ML'),
  ('PTC7400', '799192109164', 'MASCARILLA DE MIEL BRILLO INTENSO 300ML'),
  ('PTC7500', '793969805471', 'PERFUME MORADO 40 ML (TROPICAL CRUSH)'),
  ('PTC7600', '793969805464', 'PERFUME ROSADO 40 ML (SEDUCTION FLOWER)'),
  ('PTC7700', '793969805440', 'PERFUME AZUL 40 ML (CANDY TOY)'),
  ('PTC7900', '793969805488', 'PERFUME VERDE 40 ML (FRESH AMBER)'),
  ('PTC8100', '793969805457', 'PERFUME TRANSPARENTE 40 ML (VAINILLA GLOW)'),
  ('PTC8200', '793969805563', 'PERFUME CAPILAR DE MIEL BRILLO INTENSO 100ML'),
  ('PTC8301', '793969805600', 'MIEL PARA EL CABELLO X 20 ML'),
  ('PTC8800', '793969805570', 'ACONDICIONADOR MIEL'),
  ('PTC8806', '793969805648', 'ACONDICIONADOR DE AJÍ 300 ML'),
  ('PTC8900', '793969805556', 'PERFUME DE PRINCESA - MAGIC STEP'),
  ('PTC9000', '770PTC9000', 'PERFUME DE PRINCESA - SLEEPING ROSE'),
  ('PTC9100', '7939698055320', 'PERFUME DE PRINCESA - PURPLE WAVES-1'),
  ('PTC9106', '770PTC9106', 'PERFUME CORPORAL Y CAPILAR PALACE GARDEN 110ML'),
  ('PTC9113', '770PTC9113', 'PERFUME CORPORAL Y CAPILAR MERMAID KISS 110ML'),
  ('PTC9119', '677144930205', 'PERFUME DE MIEL Y MASMELO'),
  ('PTC9121', '7709268279632', 'TERMOPROTECTOR BIFASICO LECHE Y MIEL 150 ML'),
  ('PTC9124', '677144930199', 'PERFUME DE MIEL Y PISTACHO'),
  ('PTC9130', '7709360339302', 'SHAMPOO DE PROTEINA 300 ML'),
  ('PTC9131', '7709360339395', 'ACONDICIONADOR DE PROTEINA 300 ML'),
  ('PTC9132', '7709360339319', 'MASCARILLA DE PROTEINA 300 ML'),
  ('PTC9133', '7709360339340', 'POLVO DE PROTEINA SACHET X 3GR'),
  ('PTC9215', '7709076081892', 'PERFUME CAPILAR SEDUCTION FLOWER 100ML (ROSADO)'),
  ('PTC9219', '7709268279670', 'PERFUME CAPILAR CANDY TOY 100 ML (AZUL)'),
  ('PTC9224', '7709268279601', 'PERFUME CAPILAR TROPICAL CRUSH 100 ML (MORADO)'),
  ('PTC9233', '7709268279656', 'PERFUME CAPILAR MOCCA 100 ML'),
  ('PTC9238', '7709268279625', 'PERFUME CAPILAR VAINILLA GLASEADA 100 M'),
  ('PTC9239', '7709268279694', 'PERFUME CAPILAR GOLDEN TOFFEE 100M'),
  ('PTC9270', '770PTC9270', 'TONICO CAPILAR DE AJI 60 ML'),
  ('PTK8023', '770PTK8023', 'KIT ONDAS SALUDABLES'),
  ('PTK9057', '793969805495', 'KIT MINI PERFUMES DULCES 40 ML X 3 UNIDADES'),
  ('PTK9058', '793969805518', 'KIT MINI PERFUMES CÍTRICOS 40 ML X 3 UNIDADES'),
  ('PTK9059', '793969805525', 'KIT MINI PERFUMES MIX 40 ML X 3 UNIDADES'),
  ('PTK9063', '7709360339371', 'KIT PERFUMES CANDY CRUSH (CANDY TOY, VANILLA GLAZE, GOLDEN TOFFEE) 32ML'),
  ('PTK9068', '7709360339388', 'KIT PERFUMES CREAMY CAKE (MOCCA SHAKE, VANILLA GLAZE, GOLDEN TOFFEE)32ML'),
  ('PTK9070', '677144930182', 'KIT GLOW UP 2 PERFUME MIEL Y MIEL'),
  ('PTK9291', '7709949388202', 'MASCARILLA DE PROTEINA 300 ML CON SACHET 3 G'),
  ('UNI006', '770UNI006', 'CAMISETAS VACA')
ON CONFLICT ON CONSTRAINT uq_item_ean_cuenta_item
DO UPDATE SET ean = EXCLUDED.ean, descripcion = EXCLUDED.descripcion
WHERE core.item_ean.ean IS DISTINCT FROM EXCLUDED.ean OR core.item_ean.descripcion IS DISTINCT FROM EXCLUDED.descripcion;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Líneas de solicitud: campos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS ean                       text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS destinatario_direccion    text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS destinatario_departamento text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS destinatario_telefono     text;
COMMENT ON COLUMN despachos.solicitud_lineas.ean IS 'EAN del SKU al radicar (digitado o tomado de core.item_ean)';

-- Solicitudes ya radicadas: completar EAN desde el maestro (las líneas no tienen trigger de actualización)
UPDATE despachos.solicitud_lineas l
   SET ean = (SELECT ie.ean FROM core.item_ean ie
               WHERE ie.activo AND ie.item IN (l.material, core.fn_sku_base(l.material))
               ORDER BY (ie.item = l.material) DESC, ie.id LIMIT 1)
 WHERE l.ean IS NULL
   AND EXISTS (SELECT 1 FROM core.item_ean ie
                WHERE ie.activo AND ie.item IN (l.material, core.fn_sku_base(l.material)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. fn_crear_solicitud (misma firma: el portal anterior sigue funcionando)
-- ─────────────────────────────────────────────────────────────────────────────
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
  p_observaciones      text  DEFAULT NULL
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
  IF p_origen NOT IN ('MANUAL','PDF') THEN
    RAISE EXCEPTION 'DSP004: origen inválido (%)', p_origen USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'DSP005: la solicitud no tiene líneas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lineas) > 5000 THEN
    RAISE EXCEPTION 'DSP006: máximo 5000 líneas por solicitud' USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Validación de líneas (en tabla temporal de la transacción)
  CREATE TEMP TABLE IF NOT EXISTS tmp_lineas_v2 (
    linea_nro integer, entrega text, destinatario_nit text, destinatario_nombre text,
    destinatario_ciudad text, material text, producto_descripcion text, cantidad numeric,
    um text, item integer, bodega text, precio_unitario numeric, descuento_pct numeric,
    subtotal numeric, total numeric,
    ean text, direccion text, departamento text, telefono text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_lineas_v2;

  INSERT INTO pg_temp.tmp_lineas_v2
  SELECT o.ord::integer,
         upper(trim(l.entrega)), trim(l.destinatario), upper(trim(l.nombre)),
         upper(trim(l.lugar)),   upper(trim(l.material)), l.producto,
         l.cantidad, COALESCE(NULLIF(upper(trim(l.um)),''),'BUL'),
         l.item, NULLIF(trim(l.bodega),''),
         l.precio, l.descuento_pct, l.subtotal, l.total,
         NULLIF(trim(l.ean),''), NULLIF(upper(trim(l.direccion)),''),
         NULLIF(upper(trim(l.departamento)),''), NULLIF(trim(l.telefono),'')
  FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS l(entrega text, destinatario text, nombre text, lugar text,
                                    material text, producto text, cantidad numeric, um text,
                                    item integer, bodega text, precio numeric,
                                    descuento_pct numeric, subtotal numeric, total numeric,
                                    ean text, direccion text, departamento text, telefono text);

  SELECT string_agg(format('fila %s', t.linea_nro), ', ' ORDER BY t.linea_nro) INTO v_dup
  FROM pg_temp.tmp_lineas_v2 t
  WHERE COALESCE(t.entrega,'') = '' OR COALESCE(t.destinatario_nit,'') = ''
     OR COALESCE(t.destinatario_nombre,'') = '' OR COALESCE(t.destinatario_ciudad,'') = ''
     OR COALESCE(t.material,'') = '' OR t.cantidad IS NULL OR t.cantidad <= 0;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP007: campos obligatorios vacíos o cantidad <= 0 en %', v_dup USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('Entrega %s + Material %s', d.entrega, d.material), '; ') INTO v_dup
  FROM (SELECT t.entrega, t.material FROM pg_temp.tmp_lineas_v2 t
        GROUP BY t.entrega, t.material HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP008: líneas duplicadas: %', v_dup USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*), sum(t.cantidad) INTO v_lineas, v_unidades FROM pg_temp.tmp_lineas_v2 t;

  -- 5) Encabezado con consecutivo de la secuencia (único aunque radiquen 100 a la vez)
  v_numero := 'DSP-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
              || lpad(nextval('despachos.seq_solicitud_numero')::text, 6, '0');

  INSERT INTO despachos.solicitudes AS s (
    numero, idempotency_key, cuenta_id, origen, area_solicitante,
    solicitante_id, solicitante_nombre, solicitante_correo,
    numero_pedido_origen, archivo_origen, datos_origen,
    total_lineas, total_unidades, observaciones, created_by)
  VALUES (
    v_numero, p_idempotency_key, v_cuenta, p_origen, upper(trim(p_area_solicitante)),
    v_uid, upper(trim(p_solicitante_nombre)), lower(trim(p_solicitante_correo)),
    NULLIF(trim(p_numero_pedido_origen),''), p_archivo_origen, p_datos_origen,
    v_lineas, v_unidades, p_observaciones, v_uid)
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
    ean, destinatario_direccion, destinatario_departamento, destinatario_telefono)
  SELECT v_id, t.linea_nro, t.entrega, d.id, t.destinatario_nit,
         t.destinatario_nombre, t.destinatario_ciudad, t.material, t.producto_descripcion,
         t.cantidad, t.um, t.item, t.bodega, t.precio_unitario, t.descuento_pct,
         t.subtotal, t.total, v_uid,
         COALESCE(t.ean, ie.ean), COALESCE(t.direccion, d.direccion),
         COALESCE(t.departamento, d.departamento), COALESCE(t.telefono, d.telefono)
  FROM pg_temp.tmp_lineas_v2 t
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Vistas
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por línea con TODOS los campos de la plantilla de despacho
CREATE OR REPLACE VIEW despachos.vw_solicitud_lineas
WITH (security_invoker = true) AS
SELECT s.id AS solicitud_id, s.numero, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo, s.numero_pedido_origen,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.lote_id, lt.numero AS lote_numero,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_direccion, li.destinatario_ciudad, li.destinatario_departamento,
       li.destinatario_telefono, li.material, li.ean, li.producto_descripcion,
       li.cantidad, li.um, li.item, li.bodega, s.cuenta_id
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
JOIN despachos.estados e     ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes lt ON lt.id = s.lote_id;

-- Líneas de un bloque: se agregan al final los campos nuevos
CREATE OR REPLACE VIEW despachos.vw_lote_lineas
WITH (security_invoker = true) AS
SELECT s.lote_id, s.id AS solicitud_id, s.numero AS solicitud_numero, s.area_solicitante,
       s.solicitante_nombre, s.origen, s.numero_pedido_origen, s.radicada_at,
       li.id AS linea_id, li.linea_nro, li.entrega, li.destinatario_nit, li.destinatario_nombre,
       li.destinatario_ciudad, li.material, li.producto_descripcion, li.cantidad, li.um, li.item, li.bodega,
       s.solicitante_correo, li.ean, li.destinatario_direccion, li.destinatario_departamento,
       li.destinatario_telefono
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
WHERE s.lote_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permisos y RLS
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON core.item_ean FROM anon, authenticated;
GRANT SELECT ON core.item_ean TO authenticated;
GRANT INSERT (item, ean, descripcion, activo, cuenta_id), UPDATE (ean, descripcion, activo) ON core.item_ean TO authenticated;
GRANT ALL ON core.item_ean TO service_role;
GRANT SELECT ON despachos.vw_solicitud_lineas, despachos.vw_lote_lineas TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.fn_sku_base(text) TO authenticated, service_role;

ALTER TABLE core.item_ean ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_item_ean_leer ON core.item_ean;
CREATE POLICY pol_item_ean_leer ON core.item_ean FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_item_ean_escribir ON core.item_ean;
CREATE POLICY pol_item_ean_escribir ON core.item_ean FOR INSERT TO authenticated
  WITH CHECK ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));
DROP POLICY IF EXISTS pol_item_ean_actualizar ON core.item_ean;
CREATE POLICY pol_item_ean_actualizar ON core.item_ean FOR UPDATE TO authenticated
  USING ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACIÓN (ejecutar aparte)
--   SELECT count(*) FROM core.item_ean;                        → 257
--   SELECT core.fn_sku_base('PTC7300-2025'), core.fn_sku_base('PTC8200 - 2026');  → PTC7300 | PTC8200
--   SELECT numero, material, ean FROM despachos.vw_solicitud_lineas ORDER BY linea_id DESC LIMIT 20;
--
-- NOTA: en MAESTRO ACTUAL el ítem PTK9070 viene dos veces (EAN 677144930182 y 770PTK9070).
--       Se cargó el primero. Corrija en core.item_ean si el correcto es el otro.
-- =============================================================================


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 021 · 021_destinatarios_direccion_departamento.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 021_destinatarios_direccion_departamento.sql
-- Plataforma L&S · Portal de Despachos · Toma de pedidos fase 4 (19-oct-2026)
--
-- QUÉ HACE
--  1. Completa el maestro core.destinatarios con DIRECCIÓN, DEPARTAMENTO y
--     TELÉFONO tomados de BD_clientes.xlsx (1114 NIT del maestro actual).
--     No cambia NIT, nombre ni ciudad (el archivo trae NIT repetidos con
--     nombres distintos; se toma el registro que coincide con el maestro).
--  2. Crea core.ciudades (ciudad → departamento, 185 ciudades) para deducir
--     el departamento cuando solo se conoce la ciudad, y la función
--     core.fn_departamento_de_ciudad(ciudad).
--  3. fn_crear_solicitud: si el departamento no llega ni está en el maestro,
--     lo deduce por la ciudad.
--  4. Completa dirección / departamento / teléfono en las líneas ya radicadas.
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere haber ejecutado antes el 020.
--
--  ⚠ Este archivo trae direcciones y teléfonos de clientes (datos personales,
--    Ley 1581): NO lo suba al repositorio de GitHub. Solo se ejecuta en Supabase.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Normalización de texto (sin tildes, minúsculas, solo letras y números)
--    'MEDELLÍN' / 'Medellin' / 'medellín ' → 'medellin'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.fn_normalizar_texto(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(trim(regexp_replace(
           translate(lower(COALESCE(p, '')), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc'),
           '[^a-z0-9]+', ' ', 'g')), '')
$$;
COMMENT ON FUNCTION core.fn_normalizar_texto(text) IS 'Texto en minúsculas, sin tildes ni signos: para comparar ciudades y nombres';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Catálogo ciudad → departamento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.ciudades (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  ciudad        text        NOT NULL,
  ciudad_norm   text        GENERATED ALWAYS AS (core.fn_normalizar_texto(ciudad)) STORED,
  departamento  text        NOT NULL,
  activo        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid                 DEFAULT auth.uid(),
  updated_at    timestamptz,
  updated_by    uuid,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT pk_ciudades PRIMARY KEY (id),
  CONSTRAINT uq_ciudades_ciudad_norm UNIQUE (ciudad_norm)
);
COMMENT ON TABLE core.ciudades IS 'Ciudad → departamento (Colombia). Fuente: BD_clientes.xlsx; se usa para completar el departamento por la ciudad';

DROP TRIGGER IF EXISTS trg_ciudades_actualizacion ON core.ciudades;
CREATE TRIGGER trg_ciudades_actualizacion BEFORE UPDATE ON core.ciudades
  FOR EACH ROW EXECUTE FUNCTION core.fn_marcar_actualizacion();
DROP TRIGGER IF EXISTS trg_ciudades_auditoria ON core.ciudades;
CREATE TRIGGER trg_ciudades_auditoria AFTER INSERT OR UPDATE OR DELETE ON core.ciudades
  FOR EACH ROW EXECUTE FUNCTION core.fn_auditar();

INSERT INTO core.ciudades (ciudad, departamento) VALUES
  ('ACACÍAS', 'Meta'),
  ('ACEVEDO', 'Huila'),
  ('AGUACHICA', 'Cesar'),
  ('AGUAZUL', 'Casanare'),
  ('AGUSTÍN CODAZZI', 'Cesar'),
  ('AMALFI', 'Antioquia'),
  ('ANDES', 'Antioquia'),
  ('APARTADÓ', 'Antioquia'),
  ('ARBOLETES', 'Antioquia'),
  ('ARJONA', 'Bolívar'),
  ('ARMENIA', 'Quindío'),
  ('BARBOSA', 'Antioquia'),
  ('BARRANCABERMEJA', 'Santander'),
  ('BARRANQUILLA', 'Atlántico'),
  ('BELÉN DE UMBRÍA', 'Risaralda'),
  ('BELEN MEDELLIN', 'Antioquia'),
  ('BELLO', 'Antioquia'),
  ('BOGOTA', 'Bogotá, D.C.'),
  ('BOGOTÁ, D.C.', 'Bogotá, D.C.'),
  ('BOGOTA DC', 'Bogotá, D.C.'),
  ('BOSCONIA', 'Cesar'),
  ('BUCARAMANGA', 'Santander'),
  ('BUENAVENTURA', 'Valle del Cauca'),
  ('CAJICA', 'Cundinamarca'),
  ('CALI', 'Valle del Cauca'),
  ('CAÑASGORDAS', 'Antioquia'),
  ('CANDELARIA', 'Valle del Cauca'),
  ('CAROLINA DEL PRÍNCIPE', 'Antioquia'),
  ('CARTAGENA DE INDIAS', 'Bolívar'),
  ('CARTAGO', 'Valle del Cauca'),
  ('CAUCASIA', 'Antioquia'),
  ('CHAPARRAL', 'Tolima'),
  ('CHÍA', 'Cundinamarca'),
  ('CHIGORODÓ', 'Antioquia'),
  ('CHIQUINQUIRÁ', 'Boyacá'),
  ('COPACABANA', 'Antioquia'),
  ('COTA', 'Cundinamarca'),
  ('CÚCUTA', 'Norte de Santander'),
  ('CUMBITARA', 'Nariño'),
  ('CURUMANÍ', 'Cesar'),
  ('DOSQUEBRADAS', 'Risaralda'),
  ('DUITAMA', 'Boyacá'),
  ('EL BANCO', 'Magdalena'),
  ('EL CARMEN DE VIBORAL', 'Antioquia'),
  ('EL DONCELLO', 'Caquetá'),
  ('EL DOVIO', 'Valle del Cauca'),
  ('EL RETIRO', 'Antioquia'),
  ('EL ROSAL', 'Cundinamarca'),
  ('EL SANTUARIO', 'Antioquia'),
  ('EL TAMBO', 'Cauca'),
  ('ENVIGADO', 'Antioquia'),
  ('FACATATIVÁ', 'Cundinamarca'),
  ('FLANDES', 'Tolima'),
  ('FLORENCIA', 'Caquetá'),
  ('FLORIDABLANCA', 'Santander'),
  ('FRESNO', 'Tolima'),
  ('FRONTINO', 'Antioquia'),
  ('FUNDACIÓN', 'Magdalena'),
  ('FUNZA', 'Cundinamarca'),
  ('FUSAGASUGÁ', 'Cundinamarca'),
  ('GALERAS', 'Sucre'),
  ('GARAGOA', 'Boyacá'),
  ('GARZÓN', 'Huila'),
  ('GIRARDOT', 'Cundinamarca'),
  ('GIRARDOTA', 'Antioquia'),
  ('GIRÓN', 'Santander'),
  ('GRANADA', 'Meta'),
  ('GUACARÍ', 'Valle del Cauca'),
  ('GUADALAJARA DE BUGA', 'Valle del Cauca'),
  ('GUADUAS', 'Cundinamarca'),
  ('GUAMO', 'Tolima'),
  ('GUARNE', 'Antioquia'),
  ('IBAGUÉ', 'Tolima'),
  ('INÍRIDA', 'Guainía'),
  ('IPIALES', 'Nariño'),
  ('IPIALIS', 'Nariño'),
  ('ISTMINA', 'Chocó'),
  ('ITAGÜÍ', 'Antioquia'),
  ('JAMUNDÍ', 'Valle del Cauca'),
  ('LA CALERA', 'Cundinamarca'),
  ('LA CEJA', 'Antioquia'),
  ('LA DORADA', 'Caldas'),
  ('LA ESTRELLA', 'Antioquia'),
  ('LA HORMIGA', 'Putumayo'),
  ('LA MESA', 'Cundinamarca'),
  ('LA PLATA', 'Huila'),
  ('LA TEBAIDA', 'Quindío'),
  ('LA VIRGINIA', 'Risaralda'),
  ('LANDÁZURI', 'Santander'),
  ('LEJANÍAS', 'Meta'),
  ('LETICIA', 'Amazonas'),
  ('LÍBANO', 'Tolima'),
  ('LOS PATIOS', 'Norte de Santander'),
  ('MAICAO', 'La Guajira'),
  ('MALAMBO', 'Atlántico'),
  ('MANIZALES', 'Caldas'),
  ('MAPIRIPÁN', 'Meta'),
  ('MARINILLA', 'Antioquia'),
  ('MARSELLA', 'Risaralda'),
  ('MEDELLÍN', 'Antioquia'),
  ('MOCOA', 'Putumayo'),
  ('MONTERÍA', 'Córdoba'),
  ('MONTERREY', 'Casanare'),
  ('MOSQUERA', 'Cundinamarca'),
  ('NEIVA', 'Huila'),
  ('OCAÑA', 'Norte de Santander'),
  ('ORITO', 'Putumayo'),
  ('OTANCHE', 'Boyacá'),
  ('PACHO', 'Cundinamarca'),
  ('PALMIRA', 'Valle del Cauca'),
  ('PAMPLONA', 'Norte de Santander'),
  ('PASTO', 'Nariño'),
  ('PEREIRA', 'Risaralda'),
  ('PIEDECUESTA', 'Santander'),
  ('PITALITO', 'Huila'),
  ('POLICARPA', 'Nariño'),
  ('POPAYÁN', 'Cauca'),
  ('PUERTO ASÍS', 'Putumayo'),
  ('PUERTO BERRÍO', 'Antioquia'),
  ('PUERTO BOYACÁ', 'Boyacá'),
  ('PUERTO CARREÑO', 'Vichada'),
  ('PUERTO LÓPEZ', 'Meta'),
  ('PUERTO SALGAR', 'Cundinamarca'),
  ('PUERTO TRIUNFO', 'Antioquia'),
  ('PUMACO', 'Nariño'),
  ('QUIBDÓ', 'Chocó'),
  ('QUIMBAYA', 'Quindío'),
  ('REMEDIOS', 'Antioquia'),
  ('RESTREPO', 'Meta'),
  ('RIONEGRO', 'Antioquia'),
  ('RIOSUCIO', 'Caldas'),
  ('ROLDANILLO', 'Valle del Cauca'),
  ('ROVIRA', 'Tolima'),
  ('SABANETA', 'Antioquia'),
  ('SAN ALBERTO', 'Cesar'),
  ('SAN ANDRÉS DE TUMACO', 'Nariño'),
  ('SAN CARLOS', 'Antioquia'),
  ('SAN GIL', 'Santander'),
  ('SAN JOSÉ DE CÚCUTA', 'Norte de Santander'),
  ('SAN JOSÉ DEL GUAVIARE', 'Guaviare'),
  ('SAN MIGUEL', 'Putumayo'),
  ('SAN PEDRO DE LOS MILAGROS', 'Antioquia'),
  ('SAN PELAYO', 'Córdoba'),
  ('SAN RAFAEL', 'Antioquia'),
  ('SAN SEBASTIÁN DE MARIQUITA', 'Tolima'),
  ('SANTA FÉ DE ANTIOQUIA', 'Antioquia'),
  ('SANTA MARTA', 'Magdalena'),
  ('SANTA ROSA DEL SUR', 'Bolívar'),
  ('SANTIAGO DE CALI', 'Valle del Cauca'),
  ('SANTIAGO DE TOLÚ', 'Sucre'),
  ('SARAVENA', 'Arauca'),
  ('SEVILLA', 'Valle del Cauca'),
  ('SINCÉ', 'Sucre'),
  ('SINCELEJO', 'Sucre'),
  ('SOACHA', 'Cundinamarca'),
  ('SOLEDAD', 'Atlántico'),
  ('SONSÓN', 'Antioquia'),
  ('SOPÓ', 'Cundinamarca'),
  ('TAME', 'Arauca'),
  ('TARAZÁ', 'Antioquia'),
  ('TIBASOSA', 'Boyacá'),
  ('TIBÚ', 'Norte de Santander'),
  ('TORO', 'Valle del Cauca'),
  ('TULUÁ', 'Valle del Cauca'),
  ('TUNJA', 'Boyacá'),
  ('TÚQUERRES', 'Nariño'),
  ('TURBACO', 'Bolívar'),
  ('TURBO', 'Antioquia'),
  ('URIBE', 'Meta'),
  ('VALLE DE SAN JOSÉ', 'Santander'),
  ('VALLE DEL GUAMUEZ', 'Putumayo'),
  ('VALLEDUPAR', 'Cesar'),
  ('VEGACHÍ', 'Antioquia'),
  ('VILLA DE SAN DIEGO DE UBATÉ', 'Cundinamarca'),
  ('VILLA DEL ROSARIO', 'Norte de Santander'),
  ('VILLAMARÍA', 'Caldas'),
  ('VILLANUEVA', 'Casanare'),
  ('VILLAVICENCIO', 'Meta'),
  ('VILLETA', 'Cundinamarca'),
  ('YARUMAL', 'Antioquia'),
  ('YOPAL', 'Casanare'),
  ('YOTOCO', 'Valle del Cauca'),
  ('YUMBO', 'Valle del Cauca'),
  ('ZARZAL', 'Valle del Cauca'),
  ('ZIPAQUIRÁ', 'Cundinamarca')
ON CONFLICT ON CONSTRAINT uq_ciudades_ciudad_norm
DO UPDATE SET departamento = EXCLUDED.departamento
WHERE core.ciudades.departamento IS DISTINCT FROM EXCLUDED.departamento;

CREATE OR REPLACE FUNCTION core.fn_departamento_de_ciudad(p_ciudad text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.departamento FROM core.ciudades c
   WHERE c.activo AND c.ciudad_norm = core.fn_normalizar_texto(p_ciudad)
   LIMIT 1
$$;
COMMENT ON FUNCTION core.fn_departamento_de_ciudad(text) IS 'Departamento de una ciudad según core.ciudades (NULL si no se conoce)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Maestro de destinatarios: dirección, departamento y teléfono
-- ─────────────────────────────────────────────────────────────────────────────
WITH archivo (nit, direccion, departamento, telefono) AS (VALUES
  ('1007316192', 'Calle 96#101-13 barrio el jardin 2', 'Antioquia', '5158137406581'),
  ('1012327648', 'Calle 2 #7-129 etapa 2 torre 1 apartamento 102', 'Cundinamarca', '573234405589'),
  ('1018496555', 'Diagonal 5A # 37B -60 Int 16 Apro 103 Conjunto Bosques de los Comuneros 2', 'Bogotá, D.C.', '573152931853'),
  ('1020769308', 'Av Colon con calle 2 almacen happy memories', 'Archipiélago de San Andrés, Providencia y Santa Catalina', '573186083970'),
  ('1026263752', NULL, 'Meta', NULL),
  ('1038106362', 'CL 10A # 22 15 negocio Mejias Spa, Esquina, Barrio el triangulo.', 'Antioquia', '2865066629940'),
  ('1075794709', 'Calle 21 #30-60 barrio el jardin', 'Huila', '573117189995'),
  ('1085312823', 'Barrio Los Alpes, manzana 3 Casa # 15', 'Putumayo', '573157905777'),
  ('1090488079', 'Av 7#5-53 Brr prados del este', 'Norte de Santander', '7449078539214'),
  ('1112785941', 'CRA 2A #16-28 Barrio la Isabella', 'Valle del Cauca', '573244341482'),
  ('1121932662', 'calle 25#13-25 conjunto la aurora casa 29', 'Meta', '4011747051886'),
  ('1124994805', 'Calle 33#8-31 barrio seis de abril', 'Meta', '6878503935360'),
  ('1146434663', 'carrera 45b #29 sur 71 Barrio jardines', 'Antioquia', '573053356445'),
  ('2100374715', 'OFICINA PRINCIPAL SERVIENTREGA', 'Putumayo', '3985525404'),
  ('25196657', 'CARRERA 9 N 41a- 23 BARRO CUBIS LA 70 PUNTO DE REFERENCIA AL FRENTE DEL HOTEL TOLON', 'Chocó', '573207326674'),
  ('30389726', 'Calle 16 # 1-45 edificio comite de ganaderos', 'Caldas', '3116211180'),
  ('32349370', 'Calle 33#50-27', 'Antioquia', '5730097498240'),
  ('39796469', 'Carrera 19 #12-66 LOCAL 08 CENTRO COMERCIAL FECOMERCOR', 'Bogotá, D.C.', '573144626942'),
  ('901262219', 'Cr 52 # 45-116 LC 112 CENTRO', 'Antioquia', '70669075246'),
  ('901844848', 'Cra 11#10-40 San Joaquin', 'Cesar', '573012009070'),
  ('901856110', 'direccion cr 54 46 45 cc el Rio local 224', 'Antioquia', '4585081604208'),
  ('902033359', 'dirección Carrera 5 # 1 - 14 Cajica Cundinamarca', 'Cundinamarca', '56235848760'),
  ('901996845', 'Crr 4 14 46 cc punto 14 local D1 98', 'Valle del Cauca', '573218965186'),
  ('901871095', 'MANZANA 33 LOTE 25 ETAPA 3 SEGUNDO PISO BARRIO EL CAMPESTRE', 'Bolívar', '573145420918'),
  ('901507447', 'Cr 103 b 152- 51 torre 2 oficina 1 Villa imperial Turingia suba', 'Bogotá, D.C.', '573115337620'),
  ('41945561', 'proviteq unidad 2 bloque 8 apto 1b', 'Quindío', '3207346647'),
  ('365149982', 'Cr 70 30 a 51 FedEx.', 'Antioquia', '5213333878664'),
  ('30722869', 'Manzana f casa 5 Barrio granada', 'Nariño', '573164102121'),
  ('24694870', 'Calle 21 # 19-92 local 1 Alma Multimarca la pradera', 'Risaralda', '573206520709'),
  ('20423816', 'Calle3#6-62', 'Cundinamarca', '573115713886'),
  ('1193545017', 'DG 8 sur #39-172 local 214 Hacienda Rosablanca centro comercial', 'Meta', '573116651517'),
  ('1233689950', 'Cl 53b #25 - 21 Centro comercial galerias Local 2056 Galerias', 'Bogotá, D.C.', '573202553837'),
  ('1152450893', 'Diagonal 75c 2A 146 Torre 2 apto 405 Salamanca de la mota', 'Antioquia', '573104915486'),
  ('1126128743', 'Calle 12 #2-72 Local 1 al lado del Hotel Barrio La Playa', 'Norte de Santander', '584228000362'),
  ('1118204016', 'TV 32 #8- 35 senderos de villa Maria torre 13 apto 304', 'Cundinamarca', '573208579429'),
  ('1114001104', 'Manzana 8 casa 22, villa Alexandra Dosquebradas', 'Risaralda', '573113049006'),
  ('1093791155', 'av 11e 8n -78 salon angelnailspa barrio guaimaral', 'Norte de Santander', '573124144278'),
  ('1085320468', 'Calle 23 # 4e-42 Conjunto residencial Campo verde, Manzana B casa 14. Barrio la Carolina', 'Nariño', '573148973034'),
  ('1090474246', 'Barrio centro Calle 10 #6-34 CC casa rubi 206', 'Cundinamarca', '573132524057'),
  ('1075260473', 'Calle 46 sur No. 33 - 178 conjunto valle de san remo casa f29', 'Huila', '573132179522'),
  ('1072747429', 'calle 2 n 3-35 calle de la Pola centro', 'Cundinamarca', '573112859110'),
  ('1061771434', 'Ciudad jardin Calle 21 norte # 6A 35', 'Cauca', '573227380694'),
  ('1044921336', 'calle bellavista # 44-68', 'Bolívar', '3002427827'),
  ('1053805170', 'calle 9 #22A 20 barrio el japon', 'Risaralda', '573148088354'),
  ('1037629491', 'calle 40 b sur cr 27 b-7(segundo piso)', 'Antioquia', '573195551758'),
  ('1028018882', 'Tercera de Policarpa Crr 77 # 102 - 18 ( local comercial Emebe )', 'Antioquia', '573136882709'),
  ('1034310325', 'Calle 54 a sur #37a 11 Portal de Santa Fe 4 Torre 4 apto 403 Barrio Fatima localidad tunjuelito', 'Bogotá, D.C.', '584143961112'),
  ('1022382138', 'Av19#5-72 local 103 hotel dann', 'Bogotá, D.C.', '573202248831'),
  ('1015414820', 'Bellavista calle 2 #1211', 'Casanare', '573144778339'),
  ('1016953214', 'torcoroma calle 54 #20-76', 'Santander', '573144914102'),
  ('1004967098', 'Av 7 16N-09 corral de piedra, Sevilla', 'Norte de Santander', '5727391965'),
  ('1052838346', 'Tv92bis#129c-55', 'Bogotá, D.C.', '573138138914'),
  ('1072710019', 'calle 9 # 8-88 barrio centro (Alfrente de las piscinas de bomberos) Almacen aguamarina', 'Valle del Cauca', '573150265945'),
  ('1112165530', 'Carrera 10a 33-17 etapa 3 unifamiliar', 'Valle del Cauca', '573128058696'),
  ('1110588433', 'Cr 8 # 53-53 Toscana torre 2 apto 304', 'Tolima', '573012199116'),
  ('1143327457', 'Carrera 11#14-66, Benjamin Plaza', 'Nariño', '573006553876'),
  ('1116437042', 'Calle 11 # 11-25 local 2 centro galeria', 'Valle del Cauca', '573116018399'),
  ('1120353896', 'calle 6 # 9-52 local rosado brush loli', 'Meta', '573222910132'),
  ('1042445716', 'Calle 22-15a-60 barrio la floresta', 'Atlántico', '573004118902'),
  ('1053850370', 'Calle 53a # 28 - 80 oficina 3 B Belalcazar', 'Bogotá, D.C.', '573102577806'),
  ('1005851999', 'VILLEMAR - CALLE 17A # 96H 76 - CASA 101', 'Bogotá, D.C.', '573112409717'),
  ('1006005310', 'Cra 1 # 7-47 B Centenario', 'Tolima', '573223246537'),
  ('1014596312', 'CALLE 19 # 5 -74 LOCAL 101 - AFUERA DEL HOTEL DANN', 'Bogotá, D.C.', '573142344571'),
  ('1022423059', 'Carrera 34C 16 62 sur Barrio El Remanso PISO 2', 'Bogotá, D.C.', '573058648162'),
  ('1020761226', 'Cra. 5A # 1C-18, Barrio Jaramillo.', 'Tolima', '573107909558'),
  ('1192716334', 'Carrera 16a #27-55 seis de octubre', 'Arauca', '573102969133'),
  ('15441517', 'CLL 51 N 50 35 ALMACEN SANANDRESITO', 'Antioquia', '573136972239'),
  ('1024566822', 'CLL 26 a #3-54 piso 4 Camilo Torres 2 sector', 'Cundinamarca', '573193956891'),
  ('1007417914', 'Carrera 19#15-54', 'Antioquia', '573215872150'),
  ('1004682009', 'Manzana 2 casa 86 villa Elisa barrio cuba, Pereira Risaralda', 'Risaralda', '34614531147'),
  ('1000118530', 'Calle 20# 82-52 local 142 CC Hayuelos (instashoping)', 'Bogotá, D.C.', '573005777908'),
  ('1061758173', 'Calle 5#10-84 local khalu Centro', 'Cauca', '573108028193'),
  ('1088356335', 'KR 51 # 81 C MZN 7 CS- 25 PS- 3 Barrio Montelibano', 'Risaralda', '573128073508'),
  ('1044506590', 'Carrera 11 # 10-10 Llanos del cuiva', 'Antioquia', '573235363048'),
  ('1073823627', 'Carrera 8 n 5-09 san pelayo Cordoba', 'Córdoba', '573106208591'),
  ('1117543683', 'Cra 5#32-11 villa del recreo', 'Caquetá', '573144246886'),
  ('1151960970', 'calle 31 # 28 - 62 barrio centro', 'Valle del Cauca', '573135465341'),
  ('1001504884', 'Calle 77 numero 52 A 12', 'Antioquia', '573023822827'),
  ('1005911254', 'Barrio picalena Calle 143#43-134', 'Tolima', '18622967202'),
  ('1007325976', 'Cra 51 #10b sur - 17', 'Antioquia', '3108842039'),
  ('1026587489', 'Carrera 112A #74a 15 local comercial primer piso', 'Bogotá, D.C.', '573132078058'),
  ('1037072363', 'Calle 18 # 19-13', 'Antioquia', '573206291063'),
  ('1233189579', 'manzana 33 casa11 barrio chambu primera etapa diagonal al cai', 'Nariño', '573022403265'),
  ('37122226', 'Carrera 10 #12-18 Barrio Jose Antonio Galan', 'Nariño', '573159854675'),
  ('47188326', 'Carrera 5 # 11 - 42 - Peluqueria Patys Barrio Libertad', 'Nariño', '51981501903'),
  ('60283973', 'Carrera 6 # 7-102 local 2', 'Norte de Santander', '573184144953'),
  ('70692665', 'calle 12b #9-40 edificio Neos bodega 847-857 mundo belleza', 'Bogotá, D.C.', '573173689922'),
  ('900880568', 'CALLE 16 43 F 56', 'Antioquia', '6042681140'),
  ('8110252891', 'Kilómetro2 víaRionegro', 'Antioquia', '3655701'),
  ('901549954', 'carrera 55 # 46 - 64 Centro comercial Manhattan Piso 6 bodega 602, Medellin HORARIO RECIBO MERCANCIA LUNES A VIERNES DE 830 AM a 500 PM SABADO 830 AM a 200 PM NOTA SE RECIBE EN ORDEN DE LLEGADA', 'Antioquia', '573127910536'),
  ('39447700', 'calle 14 #55a-138 San Antonio', 'Antioquia', '573192136373'),
  ('39651003', 'Carrera 49 #90-65 Barrio Aranjuez - Medellin', 'Antioquia', '573012920420'),
  ('24023091', 'Calle 12A No. 71B-41 Torre 6 apto 303- Alsacia Real', 'Bogotá, D.C.', '573104823024'),
  ('1014285421', 'Fontibon Carrera 100 # 18-59 centro comercial fiesta Fontibon local 001 Manpower.', 'Bogotá, D.C.', '573157336142'),
  ('1017255758', 'Barrio castilla Cra68#95-13 al lado de cosechas entrega despues de las 11am', 'Antioquia', '573222915182'),
  ('1018438922', 'calle 64 h # 77c-30', 'Bogotá, D.C.', '573112245326'),
  ('1002922776', 'CL 2 #6-65 OFICINA SERVIENTREGA', 'Cauca', '3212279456'),
  ('1143973284', 'Calle 5#19-56 Apto 301 Barrio libertadores', 'Valle del Cauca', '573183867111'),
  ('1123633011', 'Proveedoras al lado de la pesquera de pachito', 'Archipiélago de San Andrés, Providencia y Santa Catalina', '573155942585'),
  ('1121903376', 'Direcciones Cll 37b # 28-25', 'Meta', '573106628383'),
  ('1116914929', 'Cll 5 CRA 3 en seguida de Servientrega', 'Caquetá', '573208201901'),
  ('1110285296', 'Calle 35 # 10-97 barrio el troncal', 'Valle del Cauca', '573225921484'),
  ('1073516353', 'CRA 3 # 19 37 local 135', 'Cundinamarca', '573229491537'),
  ('1062276728', 'CRA 50sur 19 b20 diagonal al colegio publico Terranova segunda etapa', 'Valle del Cauca', '573159962066'),
  ('1086697752', 'BBelen Cra. 5 #3-66', 'Nariño', '573163146052'),
  ('1088328209', 'DG 3 34T 02 via japon frailes Conjunto cerrado Acqua Hills Torre 2 apt 1002', 'Risaralda', '573004458689'),
  ('1096483359', 'Car 4 #105 casa la cadena local 1', 'Santander', '573202142844'),
  ('1058932239', 'San rafael Direccion Carrera 1A 15-54', 'Huila', '573144733197'),
  ('1110565833', 'Carrera 10#11_54 barrio centro, Puerto Salgar, Cundinamarca', 'Cundinamarca', '573233007081'),
  ('1112101020', 'Carrera 11 #9-35 Juan de Ampudia', 'Valle del Cauca', '573004709081'),
  ('1006778567', 'Calle14#20-17barrio cooperativo o centro', 'Meta', '573123078603'),
  ('1018477239', 'La pepita calle 9 bis # 19a 83 modulo azul entrada 4 local 14', 'Bogotá, D.C.', '573212237207'),
  ('24253456', 'Dirección entrega: CR 9 # 15-55 Oficina Principal de Maicao', 'La Guajira', '584246370699'),
  ('37335103', 'Calle 8 No. 37-50 piso 3 B la primavera', 'Norte de Santander', '573182405136'),
  ('43188449', 'Calle 31A #26-60 Oficina 204 Edificio Irake Barrio Canaveral', 'Santander', '573002038608'),
  ('901455091', 'Carrera 35#51-36', 'Santander', '573156887259'),
  ('66873539', 'Calle 8 con Cra 2b Esquina #8-03 Barrio Jose Maria Barbosa', 'Valle del Cauca', '573122952381'),
  ('890941663', 'CARRERA 42 # 46 - 326', 'Antioquia', '2315372'),
  ('901940036', 'Centro comercial centro chia local 151 Avenida Pradilla 900 Este', 'Cundinamarca', '573167500065'),
  ('46454566', 'Centro Cra 16# 12-26 apto 502', 'Boyacá', '573203389302'),
  ('52501147', 'Centro candelaria Cra10#12-92 local 3', 'Bogotá, D.C.', '573172886750'),
  ('37724554', 'Cra 25 33 95 torre 1 501 salonica', 'Santander', '573112510031'),
  ('38683496', 'CALLE 22 # 6-22 Barrio San Nicolas', 'Valle del Cauca', '573173534343'),
  ('24713246', 'carrera 9 numero 4-54 barrio nuevo horizonte', 'Tolima', '573124864842'),
  ('30050086', 'Calle 23#19-84 libertad aguas calientes', 'Norte de Santander', '573212871363'),
  ('1192771184', 'Calle 9 bis #19a-47 san Andresito San Jose bodegas amarillas entrada 3 local 140', 'Bogotá, D.C.', '573192202521'),
  ('1019017927', 'Cra 14 # 15- 12', 'Meta', '573114519407'),
  ('1017263423', 'Cll 73 sur # 63 b 126 la estrella Torre 1 apto 2006', 'Antioquia', '573043849684'),
  ('1006856845', 'calle 16# 12- 29 centro', 'Casanare', '573228285799'),
  ('1006130847', 'calle 12 # 4-17 centro local 3 aguamarina tienda, ibague, Tolima', 'Tolima', '573165359897'),
  ('1006100709', 'Carrera 20 #9e-98', 'Valle del Cauca', '573024584481'),
  ('1000105414', 'Cr 4 18 A-56 Torre 4 apt 101 mirador del cauca', 'Antioquia', '573142772914'),
  ('1036949492', 'Cra 73# 42-35 segundo piso cuarta etapa barrio, el porvenir', 'Antioquia', '573226693562'),
  ('1034779250', 'Calle 71 a sur # 83-20 parque primaveral (Torre 7, apartamento 1101)', 'Bogotá, D.C.', '573153666450'),
  ('1020471594', 'Carrera 60 #64-77, la aldea, la mitad de la pendiente Bello', 'Antioquia', '573205786045'),
  ('1110452623', 'mz D cs 94 Valparaiso etp1', 'Tolima', '573006157930'),
  ('1121939949', 'carrera 39 7-21 barrio la esperanza 5 etapa', 'Meta', '573006654545'),
  ('1118198743', 'Cl 08 12 50 lc 01 Barrio Centro', 'Casanare', '573204207471'),
  ('1130679676', 'Calle 33 # 93 16 sur. Rivera de occidente', 'Bogotá, D.C.', '56953405328'),
  ('1140836083', 'Barrio siape calle 83 82 61 apto 2 apto 2', 'Atlántico', '573024073932'),
  ('1144094217', 'Cra 10#48-36 Villacolombia', 'Valle del Cauca', '573043523106'),
  ('1055314606', 'Calle 3 #6 -28 Local Amara Maquillaje', 'Boyacá', '573124301094'),
  ('1047491387', 'Calle 41a #13-31', 'Bolívar', '573332526996'),
  ('1045742255', 'Barrio Alboraya - Cra 8h # 44-27.', 'Atlántico', '573147874955'),
  ('1061720156', 'barrio vereda pisoje CRA 5 #50N-59 segundo piso Barrio pisoje frente al parqueadero de las piscinas (tienda la quinta)', 'Cauca', '573117118622'),
  ('1077450197', 'Yesquita Cll 22#4-85', 'Chocó', '573128282859'),
  ('1097039314', 'Carrera 5ta N. 12-53 Esquina Apto 301 Barrio San Jose', 'Quindío', '573114345512'),
  ('1086755436', 'Mz 28 cs 16 tamasagra 1', 'Nariño', '573169030448'),
  ('1083894682', 'Calle 5 15 61 San Mateo', 'Huila', '573237016059'),
  ('1084848149', 'Cra 7.No. 9-49 Centro comercial victoria plaza Local 104 B', 'Nariño', '573107214732'),
  ('1090486131', 'Cc plaza de Los Andes local 219 tercer piso llamar antes de entregar', 'Norte de Santander', '573005443206'),
  ('1090432960', 'KDX 11 B -1A barrio Maria gracia la pastora punto de referencia supermercado merka Felix', 'Norte de Santander', '573124645423'),
  ('1081277601', 'Barrio San Francisco, Carrera 1A y calle 6 A ,casa de 2 pisos, Valle del Guamuez, La hormiga, PUTUMAYO,Juan Jose Martinez En local de tamales Tolimenses', 'Putumayo', '593968113816'),
  ('1090986717', 'Cra 6 #19-128 local 1 BARRIO CARMEN', 'Tolima', '573102694518'),
  ('1091383585', 'OFICINA SERVIENTREGA LA PALMITA', 'Norte de Santander', '584247565896'),
  ('1070989269', 'Calle 16 #10-15 torre 4 apto 302 Conjunto Heliconias', 'Cundinamarca', '573057101488'),
  ('1069178131', 'Calle 10# 7-6165 Barrio Triana av los alcaldes Local variedades Gaby', 'Tolima', '573023470001'),
  ('1140881437', 'Cl 43#32-55 barrio chiquiquira casa 4 segundo piso', 'Atlántico', '573206242502'),
  ('1128391156', 'centro de medellin CC Torre asia, bodega 1301', 'Antioquia', '573046051163'),
  ('1123801775', 'cra 36A # 15-04 nuevo ricaurte / Cel 3107653796/Villavicencio', 'Meta', '573107653796'),
  ('1126323155', 'Parcelacion la pradera Casa#63km#3 via Rionegro,la ceja', 'Antioquia', '15147712511'),
  ('1121826665', 'carrera 30a # 4a - 04 urbanizacion el sosiego, casa esquinera de tres pisos, local puerta rosada', 'Meta', '573006801560'),
  ('1121855749', 'Calle 12 Sur 18-81 Mz D casa 8a condominio Pacande', 'Meta', '573208317038'),
  ('1122137467', 'Calle 14 # 20 - 35 barrio cooperativo', 'Meta', '573132661861'),
  ('1118551744', 'Bello Horizonte Cra 21 n 10-06', 'Casanare', '573213968458'),
  ('1116260277', 'Cr 24 #32-27 Sajonia, piso 2 Timbre 3, Tulua, Valle del Cauca', 'Valle del Cauca', '573164957695'),
  ('1113664248', 'calle12a#9-58 barrio Espinoza ROZO', 'Valle del Cauca', '3153483469'),
  ('1105787237', 'mz g casa 25 entrerrios local dream colors', 'Tolima', '573232511029'),
  ('1107837758', 'Calle 5 # 6-33 Barrio panamericano Casa de rejas blancas, diagonal al super alitas', 'Valle del Cauca', '573104396068'),
  ('1023029368', 'Carrera 3 g # 55 - 50 sur, barrio Danubio Azul, localidad de Usme', 'Bogotá, D.C.', '573103488768'),
  ('1032469036', 'CARRERA 64 #55a -98 sur Barrio villa del rio Local esquinero casa azul Nombre Palm On', 'Bogotá, D.C.', '573222889726'),
  ('1035914797', 'Cll 49 # 50-14 local 101', 'Antioquia', '573016601600'),
  ('1036223866', 'Carrera 18 20-19 enseguida de jugos cosechas', 'Antioquia', '573126762120'),
  ('1036606786', 'calle 52 sur #72-36 Barrio barichara', 'Antioquia', '573043171019'),
  ('1036925114', 'Carrera 48 numero 54-52 Via al hospital regional San Juan de Dios', 'Antioquia', '573113058560'),
  ('1038335893', 'Crack 32. #19-60 Barrio, el campamento', 'Antioquia', '573128705092'),
  ('1039455502', 'Calle 46 #53A-06 bode 205 206 nota si no se encuentra llamar', 'Antioquia', '573506894908'),
  ('1000857707', 'Carrera 4 #28-10 SoachaSan Mateo Centro comercial Unisur -local 1122A', 'Cundinamarca', '573042190237'),
  ('1001089847', 'Pozo azul Carrera 24#2-116 conjunto turquesa, torre 10 apartamento 303', 'Cundinamarca', '573142734136'),
  ('1006735541', 'Centro Comercial Unicentro Valledupar , administracion Piso 2) Cra 9 #6-42 Barrio Los Angeles', 'Cesar', '573004415746'),
  ('1007115199', ': Cll 30 A No 82 - 35 ,Belén ; medellín Antioquia Recibe Tatiana Botero 3117388830', 'Antioquia', '573206269616'),
  ('1007757377', 'Cra 13 # 11-29 centro comercial portal de funza, local 103', 'Cundinamarca', '573223155101'),
  ('1014656224', 'Cra 4este #30a 41 san mateo', 'Cundinamarca', '573125620530'),
  ('1192781775', 'Corregimiento El Tres Oficina Principal Servientrega', 'Antioquia', '573213634863'),
  ('1193079739', 'Nicolas Borrero Calle 5#8-33', 'Valle del Cauca', '573105236665'),
  ('26337275', 'Av 7 # 14- 52 Barrio el Paramo', 'Norte de Santander', '573018634476'),
  ('23409809', 'Avenida 7 numero 14-52 barrio el paramo', 'Norte de Santander', '584127494517'),
  ('16752714', 'Barrio Guabal Carrera 44 # 13c - 101 segundo piso Timbrar', 'Valle del Cauca', '573186916599'),
  ('40045996', 'Cra 3 #76A-65 Conjunto Reina Cecilia 2 Casa 28', 'Boyacá', '573105887642'),
  ('70698216', 'Calle 48 # 53-103 local 102 centro comercial Metroplaza pasaje tequendama', 'Antioquia', '573017392751'),
  ('70828339', 'Calle 46 # 54-28. Bodega 1001 piso 10', 'Antioquia', '573015985205'),
  ('51865795', 'carrera 19#16_41', 'Boyacá', '573228013339'),
  ('52102673', 'calle 54 #9-02 chapinero Local luxurmakeup', 'Bogotá, D.C.', '573124410592'),
  ('901920870', 'carrera 50 #47-28', 'Antioquia', '573046309346'),
  ('902000986', 'Cra. 75 # 24-34, Local 02, Modelia', 'Bogotá, D.C.', '573204964941'),
  ('942492695', 'Cra 10 con calle 28 manzana D casa 16 villa real del sur', 'Nariño', '593967431958'),
  ('69891856', 'Bodega LYS', 'Antioquia', '18043492460'),
  ('901497746', 'KR 50# 74 -35 PISO 8 Barrio 12 DE OCTUBRE', 'Bogotá, D.C.', '573176358438'),
  ('901739561', 'Calle 1#10-04 centro comercial la casona local 235', 'Cundinamarca', NULL),
  ('901800537', 'cra 3 a bis N71-47 B valparaiso etapa 2', 'Tolima', '573224048122'),
  ('901705567', NULL, 'Boyacá', NULL),
  ('8363058', 'Cr 55 # 4664 bodega 1004 cc manhathan', 'Antioquia', '573128482633'),
  ('63324974', 'CALLE 55A #1W-20 SEGUNDO PISO BARRIO MUTIS', 'Santander', '573102354192'),
  ('900313153', 'CRA 54 # 72A-65', 'Antioquia', '4448438'),
  ('901881981', 'OFICINA PRINCIPAL SERVIENTREGA MURILLO CL 45# 33-116', 'Atlántico', '573188499384'),
  ('47429871', 'carrera 53 a # 45 - 51 frente al CC Gran Plaza , diagonal al parque de las luces', 'Antioquia', '14088967780'),
  ('52603399', 'calle 8 # 16-77 Camelia Boutique', 'Cundinamarca', '573132863634'),
  ('42018646', 'alle 41# 14-44 casa 3 Bis Guadalupe', 'Risaralda', '573105210877'),
  ('40443366', 'Hacienda rosablanca amarillo conjunto alborada Diagonal 6 sur 39-100 torre 7 apartamento 204', 'Meta', '573108547048'),
  ('37256897', 'Calle 13#14-16 barrio el Contento', 'Norte de Santander', '573502028649'),
  ('35427045', 'Diagonal 4B # 31-17 Local 8, Las villas', 'Cundinamarca', '573115611192'),
  ('20500197', 'Calle 1 no 4 08', 'Cundinamarca', '573203139446'),
  ('26631382', 'Carrera 15 # 6- 29, barrio San Vicente', 'Huila', '573138647205'),
  ('28151962', 'Carrera 6-8b-49-44 local 101 calle real', 'Norte de Santander', '573208354272'),
  ('29670972', 'Carrera 2 # 12-02 casa 16', 'Cundinamarca', '573187691958'),
  ('29684926', 'CC Unicentro Palmira Burbuja Mundo Cabello , frente a Movistar , Entrada peatonal', 'Valle del Cauca', '573186574784'),
  ('30403567', 'Krr 68C No 22 B - 71 Conjunto Alameira Torre 7 Apt 501 Barrio Ciudad Salitre', 'Bogotá, D.C.', '573104921788'),
  ('1152209715', 'carrera 50A 50- 35 calle del medio, Almacen Amatista Cuantos puntos de venta fisico tienes 1', 'Antioquia', '573206833899'),
  ('1234188013', 'Cra 2 # 11-64 centro local 5', 'Tolima', '573103467031'),
  ('1015451902', 'Carrera 116c #66-20 primer piso', 'Bogotá, D.C.', '573214151776'),
  ('1016051882', 'Cra 80 71a 15sur Bosa Naranjos (el retazo)', 'Bogotá, D.C.', '573142728931'),
  ('1016085478', 'Diagonal 15a 99 34 apartamento 603 torre 5', 'Bogotá, D.C.', '573227916081'),
  ('1017150913', 'Rio de Janeiro - Cra 4w # 21-43', 'Córdoba', '573114074863'),
  ('1017206200', 'Centro,pasaje San Jose local 4541C AAA computadores calle 50#45-45', 'Antioquia', '573108465700'),
  ('1017238260', 'Carrera 49a #108-83 Barrio Andalucia la francia', 'Antioquia', '573104759135'),
  ('1010102243', 'Ac. 26 #100-40, Fontibon, Oficina Servientrega del Dorado', 'Bogotá, D.C.', '573215568842'),
  ('1006904586', 'Calle 7 14-01 barrio centro', 'Meta', '573204829977'),
  ('1006846150', 'Calle13 #31-16 Barrio Camilo Torres QG STORE locales rosados', 'Putumayo', '573133045244'),
  ('1006433404', 'Carrera 14 # 40-01', 'Valle del Cauca', '573224976621'),
  ('1005691812', 'Cra 10 A #41-48 Calarca', 'Tolima', '573208704107'),
  ('1003966256', 'Cll 16 a sur 8-36 barrio Montecarlo', 'Huila', '573108503168'),
  ('1004417675', 'Barrio Campo Valdes, Carrera 49#70-12, apto 201', 'Antioquia', '573207905570'),
  ('1001443339', 'OFICINA PRINCIPAL SERVIENTREGA CLL 21 # 21 - 74', 'Antioquia', '573108216211'),
  ('1038547523', 'Palocabildo la manga calle6#10-443', 'Antioquia', '573122089267'),
  ('1038813495', 'Cl87c#103-33 barrio kennedy', 'Antioquia', '573106205506'),
  ('1039703779', 'Cra 4 #45-03 barrio la milla 1 Colors store', 'Antioquia', '573106169477'),
  ('1042065282', 'Cl. 131 Sur #51-30 edificio ruisenor apartamento 704', 'Antioquia', '573147632201'),
  ('1036934158', 'Calle 41 #75-42 sector cuarta etapa Barrio el Porvenir', 'Antioquia', '573137263910'),
  ('1038137772', 'Carrera 20 troncal de occidente lavadero MEGA CAR WASH VIP, al lado de estacion de servicios terpe', 'Antioquia', '573233984369'),
  ('1036670057', 'Carrera 53 a # 57 a 113 Urbanizacion las Americas. Bloque 10 Apartamento 203', 'Antioquia', '573126208958'),
  ('1036393950', 'Cra 55 46 72 , Pasaje Comercial Oriente bodega 802', 'Antioquia', '573217318051'),
  ('1035303904', 'Cra. 31 # 31 82 al frente del parque educativo local beautypuntocom', 'Antioquia', '573217617534'),
  ('1035430319', 'Calle 44 # 49 A 23 Interior 201. Segundo piso Barrio Obrero - Cristo Rey.', 'Antioquia', '573148029617'),
  ('1026270607', 'Kra 78k #58a11 sur Rubi II sector', 'Bogotá, D.C.', '573003353591'),
  ('1026572008', 'Cra 19a#142-11 apto 320 Atelier Cedritos', 'Bogotá, D.C.', '573016333895'),
  ('1030540124', 'Calle 98#69-49 local Mayenta', 'Bogotá, D.C.', '573162587243'),
  ('1022945067', 'cll 73 sur # 92-85 torre 11 apto 104 Bosa', 'Bogotá, D.C.', '573115886518'),
  ('1026131745', 'Restrepo Naranjo Calle 63sur 43A-20 edificio alcantara apto 505', 'Antioquia', '573046545238'),
  ('1020480999', 'Cra 53A # 45-84 Torre 2 apto 2405, urbanizacion flor apartamentos, barrio Santa Ana', 'Antioquia', '573127815243'),
  ('1110572860', 'MZ 1 CASA 7 JORDAN 1 etapa LOCAL COSITAS IBAGUE', 'Tolima', '573132958109'),
  ('1110581298', 'Carrera 4 #4-82 barrio centro', 'Tolima', '573103342897'),
  ('1112782767', 'Carrera 3 #15 - 92 (a la vuelta de Tomate Alguito). Barrio El Prado, a diagonal de tortas Caramelo.', 'Valle del Cauca', '573222956911'),
  ('1113307690', 'Calle 53 # 51-56 Barrio la pista', 'Valle del Cauca', '573169587676'),
  ('1115423587', 'Calle 10 # 4-46 Palermo', 'Valle del Cauca', '573246848343'),
  ('1121715303', 'Km 1 via al Morro, Batallon Armada. Frente al estadio.', 'Nariño', '573042371892'),
  ('1122652815', 'Calle 10 # 4-39', 'Meta', '573128288023'),
  ('1124833455', 'Carrera 32b # 3c -62 sesquicentenario', 'Meta', '573160512571'),
  ('1130671047', 'Carrera 80 # 6a 60. Apt 216. Valle de la Ferreira 2', 'Valle del Cauca', '573117331571'),
  ('1144082304', 'Carrera 34#10_30 Olimpico', 'Valle del Cauca', '573184952492'),
  ('1151940994', 'Calle 20 centro comercial bolivar', 'Antioquia', '573127874076'),
  ('1077634652', 'Carrera 5A 2-34 Al lado de la notaria primera Centro', 'Valle del Cauca', '573154829781'),
  ('1077446611', 'Cra 5 #26-42 Barrio Alameda Reyes', 'Chocó', '573137742360'),
  ('1072671350', 'Conjunto parque de las flores 2 torre 9 apto 201', 'Cundinamarca', '573043714887'),
  ('1075256341', 'Dir Cra 4 # 9 - 56 B Centro', 'Huila', '573223730376'),
  ('1061758407', 'Calle 24 # 10 - 24 Barrio Dean Bajo', 'Cauca', '573128487846'),
  ('1053824733', 'Calle 12B # 11-34 apto 202 barrio Chipre', 'Caldas', '573012740794'),
  ('1090519755', 'Calle18a 14 05 toledo plata', 'Norte de Santander', '573113166811'),
  ('1093588480', 'Redoma san mateo Centro comercial exito san mateo local 1', 'Norte de Santander', '573144885774'),
  ('1085947542', 'Barrio Kennedy CRA 7ma #26-46 frente al Hotel Nogal Suite', 'Nariño', '573177035746'),
  ('1085253889', 'Mz 9 casa 11 la esmeralda', 'Nariño', '573186565180'),
  ('109872979', NULL, 'Santander', NULL),
  ('1075236230', 'calle 62 1B-02 las Mercedes', 'Huila', '573125948366'),
  ('1124031358', 'CALLE 78 53-70 CENTRO COMERCIAL VILLA COUNTRY LOCAL 226 AMATISTA', 'Atlántico', '573006244472'),
  ('1032678598', 'Mz 95 cs 14 modelia 1', 'Tolima', '573206455129'),
  ('1033727916', 'calle 66 A sur# 17-34', 'Bogotá, D.C.', '573197434141'),
  ('1030663674', 'Trasversal 80 # 69 a 16 sur , Bosa Piamonte', 'Bogotá, D.C.', '573208781016'),
  ('1006692400', 'Carrera 8A # 42-24 Bulevar 1', 'Meta', '573107564878'),
  ('1007542491', 'Carrera 11 # 11-12 cabecera plaza de mercado Centro', 'Boyacá', '573003617232'),
  ('29284824', 'Calle 7#7-40, Yotoco, Valle del cauca', 'Valle del Cauca', '573104922022'),
  ('34564794', 'Transversal 9 # 62 n 83 barrio bella vista', 'Cauca', '573103580150'),
  ('36303171', 'Calle octava # 2 -21 Supermercado Exito del Centro OJO entrada para la entrega por la zona de carga', 'Huila', '3132387510'),
  ('901808702', 'Cra 98#16f09 apto 205 Fontibon', 'Bogotá, D.C.', '573178665645'),
  ('901933300', 'Centro comercial Galerias 1er piso local 105', 'Nariño', '573104658138'),
  ('99999999-9', 'HEHR800306GK9', 'Casanare', '528123204223'),
  ('901639989', 'Cll17#17-29 Edificio (El Cam) Edificio Santafe Piso 1 local #9', 'Quindío', '573126642244'),
  ('901501576', 'cra 55 # 46-72 local 601 pasaje comercial oriente', 'Antioquia', '573113060132'),
  ('901566593', 'CR 52 D No 79 06 , Centro de la Moda', 'Antioquia', '573137789059'),
  ('901181946', 'Centro - Calle 45 # 50 - 35 Piso 3', 'Antioquia', '573126217209'),
  ('8358587', 'CALLE 48AA #52A-35 LOCAL 101 Edificio Marbella', 'Antioquia', '573128140787'),
  ('901945530', 'Calle obando casa 102b al lado de infinity', 'Nariño', '573234031203'),
  ('23131267', 'Conjunto indigo casa A03 villa del rosario junior javier rangel', 'Norte de Santander', '584147134628'),
  ('31880408', 'Calle 45 No. 99-39 Apto 102B, Entreparques, Valle del Lili', 'Valle del Cauca', '3006180696'),
  ('39881878', 'Arjona calle del nacimiento No 53-57 Barrio San Roque', 'Bolívar', '573046050747'),
  ('116850872', 'Calle 25f No 80c-94 barrio modelia Casillero 1367', 'Bogotá, D.C.', '50662616519'),
  ('1144200633', 'calle 71 norte # 2B - 133 Toscana 70 apartamento 804E', 'Valle del Cauca', '573226256506'),
  ('1007326615', 'Oficina principal servientrega', 'Magdalena', '573104847224'),
  ('1014289605', 'Villa cristina, Carrera 95j n 90a 66', 'Bogotá, D.C.', '573228858421'),
  ('1014192079', 'Carrera 58 #23a-15 Torre A apto 103, barrio Ciudad Jardin, conjunto Cualamana.', 'Cundinamarca', '573003378049'),
  ('1000775234', 'Calle 12 b # 9-40 centro comercial neos centro local 210-211', 'Bogotá, D.C.', '573196778736'),
  ('1000285509', 'Carrera 10 #5b-64 casa rosada donde chanty 1', 'Cundinamarca', '573016848461'),
  ('1000394369', 'Calle 48b#14a-11 Buenos Aires-Los cerros', 'Antioquia', '573107529795'),
  ('1000534056', 'Calle 44 #48-57 supermercado CJ 1', 'Antioquia', '573197086886'),
  ('1022390489', 'cra51b#42-46sur barrio muzu', 'Bogotá, D.C.', '573108029644'),
  ('1023526434', 'Carrera 5#16-49', 'Boyacá', '573136830506'),
  ('1023962833', 'Ciudad Montes - Calle 8 Sur # 38B - 44', 'Bogotá, D.C.', '573242007819'),
  ('1037584059', 'CL 36 D SUR 27 A 105 LC 166 CC CITY PLAZA', 'Antioquia', '573117191146'),
  ('1040571640', 'Carrera 65c #72-140 barrio san Gabriel- apartamentos nogales torre 1 apto 2604', 'Antioquia', '573137708879'),
  ('1040756823', 'CARRERA 32 # 77SUR-205 APTO 2025', 'Antioquia', '573161775287'),
  ('1127236575', 'Calle 15 #79 - 240 Torres de Avinon III apto 508', 'Antioquia', '573113636156'),
  ('1144062835', 'carrera 45 # 56f1-15 1 pisoBarrio Morichal', 'Valle del Cauca', '573024919516'),
  ('1105679659', 'Calle 57a sur #79b-17 barrio Roma', 'Bogotá, D.C.', '573009584543'),
  ('1059910813', 'Cra 11 numero 17N-40 Antonio Narino Kabuki Studio de belleza', 'Cauca', '573216169354'),
  ('1047499672', 'zaragocilla krr 55#45-06 por el colegio mi barquito', 'Bolívar', '573046288971'),
  ('1093781293', 'Avenida 1 45-64 Conjunto reserva del resumen casa A40 Barrio san rafael', 'Norte de Santander', '573183931177'),
  ('1088270261', 'Cra 7 bis N 31b03 Pereira', 'Risaralda', '573183500241'),
  ('1081415033', 'Carrera 26 #4B-31, Apartamento 202', 'Huila', '573102994049'),
  ('1096041114', 'carrera 9 #9-62 centro', 'Quindío', '573226541681'),
  ('1102867168', 'KR 24F CALLE 1G 192 TORRE 5 APTO 104 URBANIZACION TORRES DE JIRETH', 'Sucre', '573242009427'),
  ('1143467625', 'Calle 72 #53 - 13 local 207-208 somos dulcinea barrio Prado', 'Atlántico', '573046080306'),
  ('1124994625', 'Car 8#20A-118 Arturo bueno', 'Vichada', '573162064084'),
  ('1038802018', 'Barrio las palmas cra 108 n 101 a 11', 'Antioquia', '573015704214'),
  ('1038100538', 'calle 17 #10-79 Barrio Centenario', 'Antioquia', '3105211865'),
  ('1020432582', 'CRA 55a #29-20 casa 202 cabanas', 'Antioquia', '573182835805'),
  ('1016044970', 'cundinamarca', 'Cundinamarca', '573023562885'),
  ('1020817096', 'calle 164 # 19-50 apto 407', 'Bogotá, D.C.', '573133757853'),
  ('1000757943', 'carrera 29 #43- 21 local', 'Antioquia', '573045564284'),
  ('1005222024', 'calle 2d 6b #44 Villa fanny', 'Cesar', '573214192782'),
  ('1006119183', 'Foresta residencial calambeo torre 4 aprt 1101', 'Tolima', '573052001539'),
  ('39455030', 'Carrera 50#48-46 Pasaje Comercial Camino verde local 102', 'Antioquia', '573007032814'),
  ('52449660', 'Cra 19 A # 63 A 56 casa piso 2', 'Bogotá, D.C.', '573102787823'),
  ('901927640', 'Calle 30a carrera 78-14 Belen la palma', 'Antioquia', '573103829233'),
  ('91183559', 'calle 1 # 6-19 barrio comuneros', 'Norte de Santander', '573016266375'),
  ('900464794', NULL, 'Antioquia', NULL),
  ('901480050', 'Cra 10a #28 sur 26 Barrio country sur', 'Bogotá, D.C.', '573163661521'),
  ('9014438660', 'LUGAR KM8 5 VIA LLANO GRANDE COMPLEX LT 98', 'Antioquia', '3136512608'),
  ('901760922', 'Calle 107# 22a- 95 Primer piso Provenza', 'Santander', '573168736011'),
  ('901763890-0', 'CALLE 78 C SUR 48 01', 'Antioquia', '3052464790'),
  ('900615349', 'CRA 45 # 35 27 PISO 3 CEDI', 'Atlántico', '573102229020'),
  ('901253562', 'Transversal 93 #53-32, bodega 4, parque empresarial el Dorado', 'Bogotá, D.C.', '573184277969'),
  ('901280233', 'Calle 46 # 52 a 008, sector el hueco', 'Antioquia', '573116296186'),
  ('63501976', 'Calle 162 #. 8c -25', 'Bogotá, D.C.', '573123870100'),
  ('901900121', 'Calle 30a # 6a -133 local 94 Centro comercial mayales Bellas Glow', 'Cesar', '573022896270'),
  ('43098492', 'CALLE 36D SUR 14-20 PARCELACION ESCOBERO CASA 10 FRENTE A LA CLINICA VETERINARIA CES EN ENVIGADO LOMA DEL ESCOBERO', 'Antioquia', '573176368369'),
  ('32840919', 'Carrera 112a # 78f - 13 Localidad Engativa', 'Bogotá, D.C.', '573209960562'),
  ('1193544721', 'Medellin Calle 77 sur n 50a 184 urbanizacion vina del mar apto 1019 Monica o manuel herrera', 'Antioquia', '3148590068'),
  ('25285795', 'Calle 7# 18_72 barrio La Esmeralda local 1 Hair Beauty', 'Cauca', '573217670161'),
  ('1003115766', 'calle 18 #20-51 Conjunto centenari apto 1454 torre 5', 'Bogotá, D.C.', '573022138221'),
  ('1000410544', 'Cl. 12 Sur #10-335, El Poblado, SANTA MONICA PREMIUM', 'Antioquia', '3122217421'),
  ('1020789420', 'Cll 67 # 54-297 Manzanillos torre 4 apto 802', 'Antioquia', '3156715257'),
  ('1025887164', 'REGOGE EN LYS- AVISAR CUANDO PUEDA RECOGER', 'Antioquia', '573145885683'),
  ('1035861284', 'Carrera 53a#47-60 barrio obrero Copacabana (especificar que es para Copacabana)', 'Antioquia', '573017091156'),
  ('1036393280', 'El carmen de Viboral Antioquia Carrera 32 #2329', 'Antioquia', '573104019450'),
  ('1037620882', 'DATOS DE ENVÍO: Diana Damelines - Cc 25026350 - Cel 3104244912 - Calle 18#5-23 - Barrio centro - Quimbaya Quindío', 'Quindío', '573006361792'),
  ('1040035615', 'Calle 12A # 13B-24- la floresta', 'Antioquia', '573228646863'),
  ('1040038983', 'Calle 20 # 20-40 parque principal, alcaldia El Retiro', 'Antioquia', '3107332227'),
  ('1128422873', 'Calle 59 #38-55 Oficina 502 Mall porton del tranvia', 'Antioquia', '3016241845'),
  ('1143844513', 'Cra 8 calle 15 Cc Shoping Center local 3', 'Valle del Cauca', '573165320142'),
  ('1143394473', 'san andres islas, oficina principal de servientrega Av COSTARICA Edf persecusion 90 san andres isla', 'Archipiélago de San Andrés, Providencia y Santa Catalina', '573138113721'),
  ('1118125614', 'Primavera, Calle 19 # 7-58', 'Casanare', '573213923365'),
  ('1117542697', 'CENTRO EMPRESARIAL SAN JOSE CALLE 14 # 12-38 CENTRO Local No. 05 primer piso', 'Caquetá', '573188217298'),
  ('1097782332', 'Los robles calle 57 #12a 03 Floridablanca Casa', 'Santander', '573102059841'),
  ('1098791041', 'Cll 94 # 47-89 conjunto Santa Barbara 1 casa 102', 'Santander', '573214030738'),
  ('1098807532', 'Cra 15#7-10 apto 302 Altamira- Floridablanca', 'Santander', '573058841991'),
  ('1091677885', 'Cra 16 # 3-24 la modelo', 'Norte de Santander', '573183775614'),
  ('1087800449', 'CARRERA 15 A # 5-54', 'Nariño', '3027394140'),
  ('1042770601', 'CR 21 18 65', 'Antioquia', '573122663220'),
  ('1047452753', 'Calle 44, 10 - 89 centro comercial alamedas Local 144 ALMATHIA', 'Córdoba', '573152106404'),
  ('1059785676', 'Cra 2 nro 2-57 centro', 'Caldas', '573043940608'),
  ('1053856293', 'Calle 33 No 23A-32', 'Caldas', '573104535822'),
  ('1065898466', 'carrera 21 # 27a-31 barrio 18 de febrero', 'Cesar', '573114487292'),
  ('1082977539', 'Mz D4 casa 16 curinca', 'Magdalena', '573166235243'),
  ('1088323396', 'Portal de San Joaquin 2 manzana 10 casa 14', 'Risaralda', '573117511162'),
  ('1087553676', 'Calle 7 #8-35 calle gaucha', 'Risaralda', '573205658306'),
  ('1100971100', 'Carrera 11 con calle 13 dentro del mercado cubierto - local 31 ( al lado de la pesquera la granja)', 'Santander', '573115659067'),
  ('1097100854', 'RECOJE EN LYS', 'Antioquia', '573229013089'),
  ('1151958202', 'calle 27 # 9-15 barrio santafesito', 'Arauca', '573143034464'),
  ('113290815', 'TV93 #53-32 BODEGA 18 PARQUE EMPRESARIAL EL DORADO D20997 DISTRITO CAPITAL BOGOTA 111071 CASILLERO YLT3022', 'Bogotá, D.C.', '50661507237'),
  ('1038126183', 'Altos de San Juan manzana 7 lote 2 calle de los mototaxis', 'Antioquia', '573127587266'),
  ('1031420349', 'Cr 44 #26-71 Conjunto residencial madera esencial Apto 2516', 'Antioquia', '573165003689'),
  ('1030651978', 'Cr 72j#46-11 sur Barrio boita', 'Bogotá, D.C.', '573196365084'),
  ('1026160088', 'Calle 129 Sur N 46-10 und residencial brisas del rio local 9801, barrio centro', 'Antioquia', '573178578304'),
  ('1024478414', 'Calle 59 a sur 65-74 barrio Madelena', 'Bogotá, D.C.', '573134677077'),
  ('900816838-2', 'Calle 79 SUR #50-150 BODEGA 75', 'Antioquia', '6043222426'),
  ('1002344188', 'Los almendros, diagonal 40 #51-62, Cartagena de Indias, Bolivar - Edificio lazuli towers I', 'Bolívar', '573045343609'),
  ('1005039986', 'Montebello 1 calle 12b 11-26', 'Norte de Santander', '573124379234'),
  ('1007694759', 'Avenida chilacos Calle 21 # 6-43 local 4', 'Cundinamarca', '573138623487'),
  ('193520493', 'Cra 28#6-102 el cedro', 'Valle del Cauca', '573028508979'),
  ('1221718434', 'Calle 137a #103f-33 barrio costazul. CASA', 'Bogotá, D.C.', '447498736302'),
  ('1225091127', 'Cra 8 CLL 8 brr los pinos Almacen la DigitalSoft. Almacen la DigitalSoft.', 'Putumayo', '573142276801'),
  ('4866614', 'calle 161#61-08 barrio gilmar peluqueria super womans', 'Bogotá, D.C.', '3204285003'),
  ('44005448', 'DIRECCION DE ENTREGA: Cl 51 sur 48 57 local 109 Centro comercial mayorca etapa 1, por el lado del paradero de buses', 'Antioquia', '573137622718'),
  ('43748138', 'Cra 106 # 62 BC 06 robledo las margaritas primer piso', 'Antioquia', '573017775910'),
  ('901843612', 'CLL79#112F19', 'Bogotá, D.C.', '573001387171'),
  ('8755549', 'Carrera 22 #36-15 Barrio San Jose', 'Atlántico', '584143639970'),
  ('901254602', 'Av Jimenez # 9-47 local 5 Centro comercial la pajarera real alfa Variedades sys SAS', 'Bogotá, D.C.', '573107750870'),
  ('9010877862', 'CARRERA 48 B 99 SUR 59 BODEGA 24', 'Antioquia', '3164350775'),
  ('901797602', 'carrera 98A #64G -30 Barrio alamos', 'Bogotá, D.C.', '573228151009'),
  ('901533638', 'DIRECCION ENTREGA: Calle 49 56-15 bod 1307 cc molino viejo', 'Antioquia', '573218165121'),
  ('890923922-6', 'CALLE 72 A 44-82 ITAGUI', 'Antioquia', '3167440268'),
  ('716614988', 'Crr 53# 47 - 22 Centro comercial megacentro local 617', 'Antioquia', '573173794580'),
  ('1192899716', 'Cra 19#23-96 condominio Navarra casa 9', 'Quindío', '573147153135'),
  ('1403057', 'Cra 86 #86-50 conjunto los nogales torre 6 apt 321, barrio la espanola.', 'Bogotá, D.C.', '573164167338'),
  ('23547186', 'LA ESTACION OFICINA SERVIENTREGA MZ Z LOTE 28 LOC 6', 'Norte de Santander', '584247573388'),
  ('26883435', 'Calle 4 # 10 - 51 Barrio San Fernando', 'Magdalena', '573013255960'),
  ('30413080', 'Cra 35A #15B-35 Centro de Negocios Prisma (Oficina 101), Las Palmas - Poblado Numero de casillero Maryangel Morales - MBOS1195', 'Antioquia', '584146670502'),
  ('1007349615', 'Direccion cr4 N 7-29 centro Tienda de maquillaje verde menta', 'Huila', '573108525799'),
  ('1017236307', 'Carrera 33#107c-62 interior 110', 'Antioquia', '573024294991'),
  ('1017137142', 'DIRECCION ENTREGA: Carrerera 43G #19-142 La Riviere (ciudad del Río) apto 1409, Medellin, Antioquia', 'Antioquia', '573216112703'),
  ('1016030276', 'TV 12 # 22 - 42 LOCAL 75 CENTRO COMERCIAL MANILA Barrio MANILA', 'Cundinamarca', '573168784465'),
  ('1004826566', 'Urbanizacion el limonar etapa 3 manzana 4 casa 14', 'Quindío', '16469723491'),
  ('1000204695', 'recoge en lys', 'Antioquia', '3116058728'),
  ('1000404597', 'Calle 27b #58d -350 Casa 138 Urbanizacion Porto Alegre Cabanas - sector Amazonia', 'Antioquia', '573004301105'),
  ('1000789301', 'Cr 18 N 12 02 barrio centro de Acacias meta', 'Meta', '573142408650'),
  ('1036941349', 'Via Vereda Cabeceras de Llanogrande, Sector Supermercado Panorama, Callejon Diagonal al Supermercado Panorama, Finca 8, Porton Forjado Con Flores Doradas.', 'Antioquia', '573225370785'),
  ('1036782871', 'Buenos Aires los cerros Calle 45cc , 14d-16', 'Antioquia', '573226083241'),
  ('1036639974', 'calle 57#58ff17 interior 307', 'Antioquia', '573218452558'),
  ('1041148355', 'Calle 30 # 37A 12 Maria auxiliadora', 'Antioquia', '573233261144'),
  ('1039467736', 'Bodega Calle 73 sur # 46 - 22 Timbre 203-202 ( bodegas de reja negra, arriba de una iglesia cristiana) HORARIO DE ENTREGA 9 am -5 pm', 'Antioquia', '573506628700'),
  ('1117526453', 'Centro Cra 12#16-17', 'Caquetá', '573209115008'),
  ('1116913569', NULL, 'Bogotá, D.C.', NULL),
  ('1110522541', 'Centro Comercial la estacion local P 10', 'Tolima', '573176819477'),
  ('1101049546', 'San roque calle 4# 8 - 21 panalera', 'Santander', '573213438212'),
  ('1092455607', 'Carrera 9 numero 19-08 Enfrente del barrio mirador', 'Quindío', '34722139759'),
  ('1082837815', 'cll33#3-37 manzanares', 'Magdalena', '573003605287'),
  ('1087548620', 'Calle 13a numero 654 barrio los gabilanes', 'Risaralda', '573113917352'),
  ('1067949524', 'Cra 35 n 2-22 (palacio de la pantaleta)', 'Córdoba', '573107183010'),
  ('1054549485', 'Manzana 19 casa 16 etapa 3 ciudadela puerto espejo', 'Quindío', '573166982003'),
  ('1053822036', 'CRR 54 46 21 LOCAL 107 CENTRO COMERCIAL DISCONFITES brr centro de medellin CC Torre asia, bodega 1301', 'Antioquia', '573046051163'),
  ('1045022732', 'Calle 51 - 47a- 44 Cuatro esquinas', 'Antioquia', '573136677238'),
  ('1047973270', 'Carrera 7 # 6-77', 'Antioquia', '3146078661'),
  ('1049029304', 'Barrio betania carrera 10. #12-10', 'Bolívar', '3016645940'),
  ('1053866875', 'ENVIAR TODO EL 3 DE MARZO', 'Caldas', '3168235505'),
  ('1088269850', 'CC Fiducentro CALLE 19 N 12-69 Pereira. Local gris 1G-02', 'Risaralda', '3046317625'),
  ('1096252093', 'Cra 46 # 81-49 san silvestre', 'Santander', '3508118606'),
  ('1109298847', 'ENVIAR TODO EL 3 DE MARZO', 'Tolima', '3209148747'),
  ('1111665958', 'Calle 54 numero 48 b 55 local 101 Districosmeticsdelvalle', 'Valle del Cauca', '3045335279'),
  ('1117499880', 'Calle 13 # 12-14-18 barrio centro por la cuadra de la floristeria el pompon', 'Caquetá', '3214252414'),
  ('1128051333', 'barrio ternera centro comercial parque Heredia local 123', 'Bolívar', '3013453253'),
  ('1124829751', 'calle 7 28-38 mzR casa 46 barrio La Paz', 'Guaviare', '3105637065'),
  ('1126447636', 'Cra 1#11 3 20', 'Huila', '3125467821'),
  ('1038544047', 'Calle 11 nro 6-98 Barrio Villanueva', 'Antioquia', '3112210856'),
  ('1040036580', 'carrera 19 # 22 22 apt 302 San Cayetano', 'Antioquia', '3103850862'),
  ('1036632221', 'Cra45 a sur # 39 b 101 apto 446 torre 12 porteria 2 parques de la gloria Envigado las Antillas', 'Antioquia', '30118346'),
  ('1036966036', 'ENVIAR TODO EL 3 DE MARZO', 'Antioquia', '30459849'),
  ('1037501813', 'ENVIAR TODO EL 3 DE MARZO', 'Antioquia', '3222356999'),
  ('1037667753', 'Cra 27b #23 sur 80 casa 105 Barrio Zuniga por toda la cancha de arena', 'Antioquia', '3184153312'),
  ('1022372827', NULL, 'Bogotá, D.C.', NULL),
  ('1020441956', 'ENVIAR TODO EL 3 DE MARZO', 'Antioquia', '3114368389'),
  ('1027887072', '.Barrio Corid - calle 56a #55-05 (calle por la peliroja)', 'Antioquia', '3113060132'),
  ('1032421477', 'Diagonal 77b #116-70 int 10 apto 104 Portal de granada II Granada granada', 'Bogotá, D.C.', '3042009912'),
  ('1035857471', 'CR 15 # 5 A - 86', 'Antioquia', '3217198650'),
  ('1000921833', 'ENVIAR TODO EL 3 DE MARZO', 'Antioquia', '3132445072'),
  ('1000603792', 'CARRERA 53 #49A 23 SUR', 'Bogotá, D.C.', '3027788625'),
  ('1002064659', 'Calle 55 #51-40 segundo piso barrio san Vicente', 'Antioquia', '3128536440'),
  ('1017185311', 'CALLE 34 CRA 80B-39 REJAS BLANCAS - LAURELES', 'Antioquia', '3135071713'),
  ('1017922580', NULL, 'Antioquia', NULL),
  ('1007121123', 'Calle 50 #51-38', 'Antioquia', '3045964220'),
  ('1010174541', 'calle 19#100-23 local 18', 'Bogotá, D.C.', '3147808634'),
  ('30339009', 'Calle 74A# 19-40 Barrio Alta Suiza', 'Caldas', '3194412863'),
  ('2716060', 'Cc San Sur local 1-13 Piso 1', 'Quindío', '3102627901'),
  ('118203225', 'Carrera 40# 5a -271 sur Canaguay Torre 3 apto 204', 'Meta', '573213491767'),
  ('11909', 'ENVIAR TODO EL 3 DE MARZO', 'Bogotá, D.C.', '3153511982'),
  ('1152219566', 'Cra 3 AA 2 AE 10 barrio san fernando', 'Valle del Cauca', '573113060132'),
  ('1152222170', 'Calle 6 #17-47, Urbanización Quintas del Lago, Apto 410 POBLADO', 'Antioquia', '3148948157'),
  ('43187042', 'Cra 52 49-37', 'Antioquia', '3213491767'),
  ('42154312', 'cl 3 no 21-11 edf pinares alto apto 102', 'Risaralda', '3178933860'),
  ('87219723', 'Mz i casa 27 B/ Montecarlo', 'Nariño', '3987556380'),
  ('830129327-1', 'Calle 62 SUR # 44-14 SABANETA', 'Antioquia', '6046050111'),
  ('901411591', 'CR 56 46 49 BG 1407', 'Antioquia', '3024310093'),
  ('901713554', 'Calle 38 a sur # 34 d 51 LOCAL 2080', 'Bogotá, D.C.', '30281999'),
  ('901692135', 'carrera 47 #71a41 interior 202 Barrio Campo Valdes', 'Antioquia', '3202455893'),
  ('901811850', 'Calle 104 # 21-133, barrio Provenza', 'Santander', '50766389594'),
  ('901811940', 'Cra 55 #46 60 bodega 1002 piso 10 Cc Manhattan Ant, Horario de L-V 8 am - 6pm Sabados de 8 am a 5pm', 'Antioquia', '3001993441'),
  ('901954094', '***FAVOR DESPACHAR DESPUÉS DEL 24 DE FEBRERO***', 'Antioquia', '3145071814'),
  ('901978501', 'Carrera 27 # 32 - 156 centro', 'Valle del Cauca', '3182687096'),
  ('901906620', 'CALLE 55A #1W-20 SEGUNDO PISO BARRIO MUTIS', 'Santander', '3102354192'),
  ('901885213', NULL, 'Santander', NULL),
  ('901952195', 'CRA 40 B # 26 a 30 La independencia Cometas jugueteria', 'Valle del Cauca', '3122831159'),
  ('901939095', 'CR 46 74 SUR 81', 'Antioquia', '3011640663'),
  ('901758503', 'Carrera 72c #22a -24 Apto 912 torre 2 Conjunto los cerros -Barrio La felicidad', 'Bogotá, D.C.', '3213890636'),
  ('901802318', NULL, NULL, NULL),
  ('901805358', 'Calle 73 #51D-71, Centro Comercial Bosque Plaza, local 2085. Cerca estacion Universidad', 'Antioquia', '3166977397'),
  ('901427659', 'CRA 28 17-452 KM 5 VIA LAS PALMAS', 'Antioquia', '3115421985'),
  ('901361936-5', 'CALLE 26 SUR 48 91 ED AYURA CENTER II', 'Antioquia', '12525125'),
  ('901560345', 'Diagonal 75B #8-40 oficina 305 centro empresarial rodeo plaza', 'Antioquia', '3155114239'),
  ('63453575', 'Centro comercial centro chia local 151 Avenida Pradilla 900 Este', 'Cundinamarca', '3167500065'),
  ('80432408', 'Carrera 12 No. 12 - 29 local 2 Chia - Centro', 'Cundinamarca', '3203301307'),
  ('811017000-7', 'CRA 48 98A SUR 367 KM 4 VARIANTE CALDAS', 'Antioquia', '4485533'),
  ('900365205-4', 'CRA 19 A 84 14', 'Bogotá, D.C.', '7455947'),
  ('42135539', 'BARRIO POBLADO 2 CC POBLADO PLAZA LOCAL 7', 'Risaralda', '3104056771'),
  ('40218675', 'CL 39 A 59 D D 25', 'Antioquia', '3014131963'),
  ('36068857', 'Calle 8 # 18 - 18 local 2', 'Huila', '3143331406'),
  ('60437065', 'Barrio el bosque calle 6 #1-16', 'Norte de Santander', '3144837235'),
  ('5144814', 'Crr 10#8-30', 'Cundinamarca', '3145451817'),
  ('1193101331', 'Carrera 39 #27-85 b el jardin', 'Valle del Cauca', '3116758648'),
  ('1234645799', 'Calle 29 # 4c-39 barrio hipodromo', 'Tolima', '3112166486'),
  ('1006823200', 'Calle 38 #16-23 barrio Madrigal 1', 'Meta', '3144910966'),
  ('1007914406', 'calle 14#8-91 Barrio centro comercial orquideas bodega 200 - el calvario,centro', 'Valle del Cauca', '3165607882'),
  ('1006995694', 'Carrera 5 # 4 - 31 barrio central san Miguel', 'Putumayo', '3227143869'),
  ('1000474284', 'Cl. 58 #93-199 Conjunto terracota B Apto 902 Torre 4', 'Valle del Cauca', '3012864836'),
  ('1112465496', 'Calle 1 oeste # 21a-12 prados de Alfaguara casa 72 Barrio alfaguara', 'Valle del Cauca', '3057729677'),
  ('1115078307', 'ENVIAR TODO EL 3 DE MARZO', 'Valle del Cauca', '3167805867'),
  ('1128277149', 'Carrera 53a numero 45 114 Cacharreria Maturin', 'Antioquia', '3147932528'),
  ('1124040238', 'calle 23a #18-146 Libano', 'Cesar', '3186778805'),
  ('1141315220', 'OFICINA PRINCIPAL DE servientrega URIBE META CALLE 4 # 9-10', 'Meta', '3229777472'),
  ('1143148554', 'AVENIDA 44 A # 67C 40 NIQUIA CAMACOL', 'Antioquia', '3012682858'),
  ('7568285', 'CARRERA 23 # 10-12 LOCAL Barrio Granada', 'Quindío', '3217833769'),
  ('901677049', 'Calle 21 # 10-47 edificio Santillana y del Carrion bodega 1- Centro', 'Risaralda', '3106634866'),
  ('901865356', 'CR 38 18 101 LC 9836, Medellin, Antioquia', 'Antioquia', '3053540638'),
  ('1128451385', 'Carrera 80 42 Sur 12 San Antonio de Prado', 'Antioquia', '3217525664'),
  ('1113303497', 'Barrio centro calle 9 #7-45 Tienda de belleza DIVAS MAKEUP', 'Putumayo', '3106365805'),
  ('1024578797', 'Calle 12b # 9-40 CC Neos moda local 013', 'Bogotá, D.C.', '3134717634'),
  ('1007757959', 'Calle 38 a sur # 72h-84 apartamento 301 Kennedy- carimagua', 'Bogotá, D.C.', '3002427991'),
  ('1006326781', 'diagonal 60#32-25 zamorano', 'Valle del Cauca', '3166641235'),
  ('1036403976', 'Calle 23 # 33 a 26 villas de ason', 'Antioquia', '573118403523'),
  ('1081273263', 'Condominio ciudad Real bajo manzana A Casa 7', 'Nariño', '593968495629'),
  ('1040323660', 'Carrera 50 # 48a-44 Local Comercial 104 La Vega', 'Antioquia', '573195083759'),
  ('1113623994', 'Barrio- Valle del lili Calle 34# 94-143 Unidad Jardin del Lili Casa C-6', 'Valle del Cauca', '573122483642'),
  ('1070967246', 'OMNICENTRO CRA 5 #13-65 LOCAL 13', 'Cundinamarca', '573142681613'),
  ('1037946502', 'Poblado Cra 32d #9-92 Restaurante hamburguesas el corral', 'Antioquia', '573227505026'),
  ('1093918473', 'KDX LOTE 5 SAN ISIDRO ANILLO VIAL OCCIDENTAL', 'Norte de Santander', '573114676511'),
  ('900422967', 'calle 20 4 41 Risaralda', 'Risaralda', '573216453970'),
  ('1040035226', 'Calle 15AA #13E70 Miraflores torre 4 apto 502', 'Antioquia', '573208643638'),
  ('1004519859', 'Cll 13 # 51-25 al frente de la iglesia ortodoxa - Los Naranjos', 'Risaralda', '573232076259'),
  ('1193396335', 'Calle 60 #6a-59, Barrio Limonar, primer piso Local The Bless Makeup', 'Tolima', '573112757152'),
  ('1077970748', 'CARRERA 9 #6-09, MURILLO TORO LOCAL RUTILA TIENDA DE MAQUILLAJE', 'Cundinamarca', '573116636806'),
  ('1054560100', 'Centro Comercial Dorada Plaza , bloque verde LOCAL 102-10 (FLOREA)', 'Caldas', '3148717639'),
  ('1114453066', 'calle 6 # 2-03', 'Valle del Cauca', '573207309488'),
  ('1040050825', 'Cl 16 #23-24', 'Antioquia', '573205090616'),
  ('1127948924', 'Carrera 14a bis#69a-10 Sur Bogota, Barrio nuevo san andres de los altos', 'Bogotá, D.C.', '50585346196'),
  ('1038136678', 'Barrio el camello CL 29 N 28-63 apartamento segundo piso verde', 'Antioquia', '3216394684'),
  ('6428458', 'Carrera 51 edificio ASYS local 114, primer piso al lado de las escaleras.', 'Antioquia', '573044478125'),
  ('1128441520', 'Calle 59 # 67 d 36 iguana', 'Antioquia', '573042729075'),
  ('1098712909', 'Diagonal 36 # 31-118 apto 1506 Torre 1 gran Alicante', 'Santander', '573046342555'),
  ('901289100', 'Calle 48 55-25 local 402', 'Antioquia', '573148803277'),
  ('1093775788', 'av 33 # 75c-47 laureles', 'Antioquia', '573193125365'),
  ('1007240153', 'Calle 51 A Carrera 52-27 Barrio Los alamos', 'Antioquia', '573206085007'),
  ('60412396', 'Palmetto Aqua club anillo vial oriental Pr 7-588 casa C04', 'Norte de Santander', '573194611210'),
  ('27542504', 'CR 8 #13-89, LOCAL 11, PASAJE EL HUECO', 'Valle del Cauca', '573135807860'),
  ('1096247965', 'Calle 33c N 27-12 Barrio ciudadela cincuentenario', 'Santander', '573008103298'),
  ('1098752947', 'Carrera 6', 'Norte de Santander', '573102121751'),
  ('1036961151', 'Verdad El tablazo, Legumbreria, diagonal al supermercado.', 'Antioquia', '573046675336'),
  ('1095939714', 'Cra 26 #17-10 Barrio portal campestre etapa 1 etapa', 'Santander', '573012097405'),
  ('79607403', 'Calle 13 sur 7a32 Quintaramos', 'Bogotá, D.C.', '573115653811'),
  ('1003579077', 'CRA 2b N 7 - 55 Local de ropa Eleven', 'Cundinamarca', '573138780945'),
  ('1002655088', 'Calle 45 cc#12-62 Barrio Buenos Aires', 'Antioquia', '19297860660'),
  ('1010133841', 'Calle 21b #2 -89 barrio las mercedes en la drogueria', 'Nariño', '593995243530'),
  ('1152688792', 'Calle 30#17-54 la ye', 'Antioquia', '573226281519'),
  ('17545214', 'CRA 9 # 15-55 OFICINA DE SERVIENTREGA PRINCIPAL', 'La Guajira', '584146015442'),
  ('1130639696', 'calle 8 # 39-120 apto 703 edificio Guanacaste barrio los Cambulos', 'Valle del Cauca', '61424630142'),
  ('1007135547', 'Barrio Venecia Dg 47 a sur #53-40', 'Bogotá, D.C.', NULL),
  ('1127660744', 'Calle 36 83 19 Barrio Simon Bolivar', 'Antioquia', NULL),
  ('37086398', 'Calle 16# 13-78 barrio fatima', 'Nariño', NULL),
  ('1000536363', 'Calle 49 Carrera 40-12 Enfrente al centro comercial tranvia plaza, diagonal a la estacion tranvia pabellon de agua. Vapeva Makeup', 'Antioquia', NULL),
  ('1007352139', 'Oficina principal servientrega', 'Antioquia', NULL),
  ('1126458543', 'Barrio libertad calle 12 4 34 rizos y lisos al lado de restaurante Yordi express', 'Putumayo', NULL),
  ('41912017', 'Cra 15 # 11 - 63 centro Local 2', 'Quindío', NULL),
  ('1114338998', 'Cra 11 numero 8 23', 'Valle del Cauca', NULL),
  ('1017231358', 'Calle 111 N67-82 segundo piso, barrio florencia', 'Antioquia', NULL),
  ('1040734872', 'CRA 61 # 78 sur 27 burbuja koquetheria ( la primera burbuja del ingreso al centro comercial por la calle 77) municipio de la Estrella', 'Antioquia', NULL),
  ('52986680', 'Carrera 102 a numero 130 d 18 Aubres 1', 'Bogotá, D.C.', NULL),
  ('1128281597', 'Cra 89 d n 27 33 apto 102', 'Antioquia', NULL),
  ('1007554838', 'Cra 34#48-100 cabecera', 'Santander', NULL),
  ('1019043190', 'Suba San Francisco Carrera 86 #146-61 Suasia interior 6 apto 204', 'Bogotá, D.C.', NULL),
  ('1088030786', 'Cra 14 #12-15 local 2 sector los alpes Circunvalar, 48 Hoorass Dia al lado de Famisanar', 'Risaralda', NULL),
  ('80175355', 'Atabanza Calle 127b bis No 50a 05 local 2', 'Bogotá, D.C.', NULL),
  ('1069758300', 'Centro - carrera 6 # 10-36', 'Cundinamarca', NULL),
  ('1036966139', 'Diagonal 44a #28D 28 local primer piso Barrio villas del hato', 'Antioquia', NULL),
  ('901673475', 'Calle 9 9 98 Caracoli Malambo Atlantico Diagonal a la iglesia Ferreteria la estacion', 'Atlántico', NULL),
  ('1124859298', 'Avenida San Francisco Calle 14 cra 12 esquina Centro comercial Normandia Local 212', 'Putumayo', NULL),
  ('1036781349', 'Direcciones Calle 6 18-114 la aldea', 'Antioquia', NULL),
  ('1045018253', 'Cra 7#16-50 loc 121', 'Risaralda', NULL),
  ('1111800709', 'Avenida primera # 11 esquina Barrio Calle Nueva Bahia Los Delfines (oficina Mucura Express)', 'Sucre', NULL),
  ('1077467461', 'OFICINA PRINCIPAL DE SERVIENTREGA', 'Nariño', NULL),
  ('1053770466', 'Barrio santa monica Carrera 6b # 14-63', 'Caldas', NULL),
  ('1082922435', 'Manzana A casa 15 local 03 linda samaria El pinon 1 Una esquina antes de la universidad del magdalena', 'Magdalena', NULL),
  ('37885114', 'Carrera 10 # 11-21', 'Santander', NULL),
  ('1085334330', 'Calle 16a 23-65 pasaje dorado centro 1', 'Nariño', NULL),
  ('1090459470', 'Carrera 11 5a138 B. Centro en Aguachica Cesar - Tienda Multimarcas Hanna Hanna zapata', 'Cesar', NULL),
  ('1121955432', 'Barrio pinilla, calle 24#13A 70-72 este, avenida Maracos', 'Meta', NULL),
  ('1126455524', 'Cra 7 #9-56 Mishel Boutique', 'Putumayo', NULL),
  ('1005852978', 'Cra 4 #6-15 barrio el centro, almacen de electrodomesticos los monos.', 'Caquetá', NULL),
  ('1088259402', 'av 30 agosto calle 77 no 15-03 torre 1 apto 104, bosques de cantabria', 'Risaralda', NULL),
  ('1110577849', 'cra. 33 # 13-86 Barrio Kennedy Zona Rosa Local Sandia', 'Putumayo', NULL),
  ('1020751497', 'Carrera 8 # 7 54', 'Cundinamarca', NULL),
  ('1096224569', 'Carrera 58c #128b -70 Apto 206 Edificio villa 129 ph', 'Bogotá, D.C.', NULL),
  ('1116551930', 'Cra 16# 10-63 (Tienda AUTENTICA) Barrio El Centro', 'Casanare', NULL),
  ('1094895535', 'calle 15 # 14-37 centro', 'Quindío', NULL),
  ('1121909442', 'Mi llanura carrera 7 # 8-12 mz 13 casa 5', 'Meta', NULL),
  ('900167764', 'CRA 5 #22-144', 'Valle del Cauca', NULL),
  ('1019154139', 'Carrera 12 No 9-58', 'Casanare', NULL),
  ('1010139640', 'Bosa recreo Cll 80 bis sur #94-21 torre 4 apto 502', 'Bogotá, D.C.', NULL),
  ('1037642220', 'Restrepo Naranjo calle 61sur numero 43A32 Apt 101 torre 1 Unidad serrana', 'Antioquia', NULL),
  ('1036951011', NULL, 'Antioquia', NULL),
  ('1116871126', 'Calle 15 #17-79 Local Dulce lila', 'Arauca', NULL),
  ('1112790308', 'Calle 14 # 4 - 43 El carmen ( centro)', 'Valle del Cauca', NULL),
  ('1089385395', 'Calle 5a Sur # 80g - 58 Terra Castilla Torre 7 Apto 2110', 'Bogotá, D.C.', NULL),
  ('1004681514', 'Calle 13#3-02', 'Valle del Cauca', NULL),
  ('1087488399', 'Calle 7bis 14 31 canalizado', 'Risaralda', NULL),
  ('1058198197', 'Cra 6 #12-41 centro local comercial', 'Caldas', NULL),
  ('1140882389', 'Calle 115 # 10 k 13, el pueblito', 'Atlántico', NULL),
  ('1061779023', 'calle 6 # 9-19 barrio el eden', 'Putumayo', NULL),
  ('1089747865', 'Calle 9 NRO 10-24 calle real centro', 'Risaralda', NULL),
  ('1122137855', 'calle 16a 31-02 local 2 diagonal a las canchas Sinteticas del bachue', 'Meta', NULL),
  ('42844263', 'Calle 36 #30 AA 24 apto 104 edificio la sagrada familia bloque 3 barrio los Giraldo, Marinilla', 'Antioquia', NULL),
  ('1115083785', 'Calle 4 b sur 13 C 45 la julia', 'Valle del Cauca', NULL),
  ('901466326', 'Cra. 53 #47-6, torre carabobo piso 9 La Candelaria', 'Antioquia', NULL),
  ('901489284', 'C R 56 B N 49 A 29 IN 905', 'Antioquia', NULL),
  ('1144137824', 'Centro comercial mall plaza local 106A cosmetic shop', 'Valle del Cauca', NULL),
  ('1121857383', 'Calle 9 # 5-59 Centro Local Almalibre', 'Meta', NULL),
  ('1193510458', 'floridablanca calle 8 #13-103 villabel', 'Santander', NULL),
  ('1005182079', 'corregimiento el centro, el cretaceo', 'Santander', NULL),
  ('52185610', 'carrera 70 c# 78a -17 Bonanza', 'Bogotá, D.C.', NULL),
  ('1003894832', 'Calle 7 A #12-42 Altico apartamento 202 Edificio Carrizal', 'Huila', NULL),
  ('1088736152', 'Carrera 74A#6-07 apartamento 303 barrio capri', 'Valle del Cauca', NULL),
  ('1110504885', 'Manzana A Casa 8 Barrio Parrales', 'Tolima', NULL),
  ('1049618585', 'calle 21 numero 11 - 93, centro historico', 'Boyacá', NULL),
  ('63453912', 'Barrio centro calle 8 15 95', 'Cesar', NULL),
  ('39192319', 'bodega click', 'Antioquia', NULL),
  ('901341467', 'Carrera 23 # 9-26 Centro', 'Guaviare', NULL),
  ('36275743', NULL, 'Huila', NULL),
  ('39456142', NULL, 'Antioquia', NULL),
  ('46649305', NULL, 'Boyacá', NULL),
  ('52825281', NULL, 'Bogotá, D.C.', NULL),
  ('53160574', NULL, 'Bogotá, D.C.', NULL),
  ('1007562307', NULL, 'Antioquia', NULL),
  ('1041327551', NULL, 'Antioquia', NULL),
  ('1070781670', NULL, 'Cundinamarca', NULL),
  ('1098750489', NULL, 'Casanare', NULL),
  ('1108928096', NULL, 'Tolima', NULL),
  ('1113311489', NULL, 'Valle del Cauca', NULL),
  ('1113592444', NULL, 'Valle del Cauca', NULL),
  ('1143469308', NULL, 'Atlántico', NULL),
  ('1152186084', NULL, 'Antioquia', NULL),
  ('1193125601', NULL, 'Bogotá, D.C.', NULL),
  ('1020303372', 'Calle 61 # 75-116, Apto 1602', 'Antioquia', NULL),
  ('1005179315', 'Calle 10a # 41-64, edificio la poblada, Apto 203', 'Antioquia', NULL),
  ('1037615568', 'CALLE 48 C 65 A 37, 1 PISO', 'Antioquia', NULL),
  ('1128434220', 'Carrera 33b 32 69, Loreto', 'Antioquia', NULL),
  ('1017246514', 'Carrera 44a #39-49, CASA- BARRIO SAN DIEGO', 'Antioquia', NULL),
  ('1017241347', 'Carrera 36a #54-15, Piso 3', 'Antioquia', NULL),
  ('1148205809', 'CL 52 SUR 66 32 UN JARDINES DE LA HACIENDA AP 1605 TORRE 1, 1605 torre 1', 'Antioquia', NULL),
  ('1214738110', 'Cra 73A # 94 - 58, Primer piso', 'Antioquia', NULL),
  ('1234989597', 'Calle 48 Sur # 58-18 Brr Rosaleda, Primer piso', 'Antioquia', NULL),
  ('43871000', 'Calle 13 36a 05 1101, 1101 torre ibiza', 'Antioquia', NULL),
  ('1152701974', 'Calle 91A # 84A 04, Casa primer piso', 'Antioquia', NULL),
  ('1017168395', 'Cl 10b # 36-28, Oficina 201', 'Antioquia', NULL),
  ('1214718894', 'Carrera 43 a # 49 b sur 45, Interior 103 empresa templamos', 'Antioquia', NULL),
  ('1214744141', 'Calle 96 #83-130, Interior 301 tocar timbre', 'Antioquia', NULL),
  ('1040870913', 'Avenida 80 # 42-113, Local Diseño y Maderas', 'Antioquia', NULL),
  ('1017144062', 'Calle 93 carrera 42B45 interior 201, Casa 2do piso', 'Antioquia', NULL),
  ('1152226589', 'Calle 17 sur #44-207, Edificio Saint Thomas apto 1502', 'Antioquia', NULL),
  ('1036400873', 'Carrera 31 #29-39 calzado pie sport, Negocio', 'Antioquia', NULL),
  ('1152700449', 'calle 65#46-31, apartamento 301', 'Antioquia', NULL),
  ('1214732290', 'CALLE 46 34 25, INT 301', 'Antioquia', NULL),
  ('1001003939', 'circular 2 #73-32, Edificio Portón de la circular, apto 802', 'Antioquia', NULL),
  ('1128414384', 'calle 39 d 108 34, casa segundo piso. Por la unidad intermedia de San Javier, antes de llegar a la casa de la justicia', 'Antioquia', NULL),
  ('1025887561', 'Calle 31 # 77-63, Asadero sabooor caleno', 'Antioquia', NULL),
  ('43837744', 'Calle 28 84 195, Bloque 3 Apt 981 urb mirador de los alpes', 'Antioquia', NULL),
  ('1036957547', 'Calle 49 # 42 62 Ayacucho con girardot, Casa segundo piso', 'Antioquia', NULL),
  ('1036250124', 'Cra 79 # 2 sur 131, Quintas de Marbella - casa 111', 'Antioquia', NULL),
  ('42940283', 'Calle 54 # 86C -220, Torre 3 apto 2517 unidad faro verde calazans', 'Antioquia', NULL),
  ('1035856093', 'CRA 44 19 02, Parqueadero sotano adelantico del exito Ciudad de rio', 'Antioquia', NULL),
  ('1002129679', 'carrera 29 # 40a - 20, Interior 335, es un callejón, al fondo a la izquierda', 'Antioquia', NULL),
  ('1152702944', 'Calle 123 # 48 - 36 Interior 102, Casa', 'Antioquia', NULL),
  ('1193542531', 'calle 3 a sur # 81 a 4, urbanizacion atalaya de la mota apto 1703', 'Antioquia', NULL),
  ('1193546084', 'Cra 55 #40a-20, Oficina 302 torre nuevo centro la alpujarra', 'Antioquia', NULL),
  ('1017202139', 'Cra 81 a 32 63, manzana H, Apto 502, Manzana H, Apto 502', 'Antioquia', NULL),
  ('1152190301', 'Transversal 39 # 72-48, apto 603', 'Antioquia', NULL),
  ('1001376388', 'Carrera 49 #60-05, PROANALAB', 'Antioquia', NULL),
  ('1037666118', 'Carrera 84F #3D-150, Aviva affinity apto 1225', 'Antioquia', NULL),
  ('1146439494', 'Cl 88 #58-42 int 205, Casa piso 2', 'Antioquia', NULL),
  ('2222222222', 'Cra 71 #30b 25, Apto 101', 'Antioquia', NULL),
  ('1098633219', 'Cra 32 # 18c-79 Panoramika Country, Apto 608', 'Antioquia', NULL),
  ('1062321196', NULL, 'Cauca', NULL),
  ('39190267', NULL, 'Antioquia', NULL),
  ('901596460', NULL, 'Valle del Cauca', NULL),
  ('1007159340', NULL, 'Cundinamarca', NULL),
  ('1098626844', NULL, 'Santander', NULL),
  ('1107070188', NULL, 'Valle del Cauca', NULL),
  ('1038338883', NULL, 'Antioquia', NULL),
  ('1045025289', NULL, 'Santander', NULL),
  ('1013098223', NULL, 'Bogotá, D.C.', NULL),
  ('1019050384', NULL, 'Bogotá, D.C.', NULL),
  ('901956910', NULL, 'Antioquia', NULL),
  ('1045017318', NULL, 'Cauca', NULL),
  ('1083814235', NULL, 'Nariño', NULL),
  ('1114402301', NULL, 'Risaralda', NULL),
  ('43926816', NULL, 'Antioquia', NULL),
  ('1053795386', NULL, 'Caldas', NULL),
  ('1007291329', NULL, 'Antioquia', NULL),
  ('1098631443', NULL, 'Santander', NULL),
  ('53090579', NULL, 'Bogotá, D.C.', NULL),
  ('63555958', NULL, 'Santander', NULL),
  ('70756826', NULL, 'Antioquia', NULL),
  ('1047973040', NULL, 'Antioquia', NULL),
  ('1032461124', NULL, 'Bogotá, D.C.', NULL),
  ('1095823476', NULL, 'Santander', NULL),
  ('1232406689', NULL, 'Norte de Santander', NULL),
  ('1005874218', NULL, 'Valle del Cauca', NULL),
  ('1018455710', NULL, 'Guainía', NULL),
  ('1053324619', NULL, 'Boyacá', NULL),
  ('1193117479', NULL, 'Antioquia', NULL),
  ('43918115', NULL, 'Antioquia', NULL),
  ('1128427151', NULL, 'Antioquia', NULL),
  ('1000636524', NULL, 'Antioquia', NULL),
  ('1037626812', NULL, 'Antioquia', NULL),
  ('1152461763', NULL, 'Antioquia', NULL),
  ('1214729031', NULL, 'Antioquia', NULL),
  ('1015071003', NULL, 'Antioquia', NULL),
  ('42825498', NULL, 'Antioquia', NULL),
  ('1017172088', NULL, 'Antioquia', NULL),
  ('1001418863', NULL, 'Antioquia', NULL),
  ('26124131', NULL, 'Antioquia', NULL),
  ('1020302843', NULL, 'Antioquia', NULL),
  ('43188284', NULL, 'Antioquia', NULL),
  ('1152224617', NULL, 'Antioquia', NULL),
  ('1017274189', NULL, 'Antioquia', NULL),
  ('1036395323', NULL, 'Antioquia', NULL),
  ('1001445926', NULL, 'Antioquia', NULL),
  ('1013656440', NULL, 'Antioquia', NULL),
  ('1152212243', NULL, 'Antioquia', NULL),
  ('1152226268', NULL, 'Antioquia', NULL),
  ('1083918259', NULL, 'Antioquia', NULL),
  ('1025662944', NULL, 'Antioquia', NULL),
  ('1128479298', NULL, 'Antioquia', NULL),
  ('1128436468', NULL, 'Antioquia', NULL),
  ('1032013539', NULL, 'Antioquia', NULL),
  ('1018346032', NULL, 'Antioquia', NULL),
  ('1020392656', NULL, 'Antioquia', NULL),
  ('1017226218', NULL, 'Antioquia', NULL),
  ('1023592708', NULL, 'Antioquia', NULL),
  ('1045519682', NULL, 'Antioquia', NULL),
  ('1035770754', NULL, 'Antioquia', NULL),
  ('1017139286', NULL, 'Antioquia', NULL),
  ('1017243557', NULL, 'Antioquia', NULL),
  ('1007055361', NULL, 'Antioquia', NULL),
  ('1000565410', NULL, 'Antioquia', NULL),
  ('1037654693', NULL, 'Antioquia', NULL),
  ('1034285103', NULL, 'Antioquia', NULL),
  ('1128224543', NULL, 'Antioquia', NULL),
  ('43864546', NULL, 'Antioquia', NULL),
  ('1214733631', NULL, 'Antioquia', NULL),
  ('1020479133', NULL, 'Antioquia', NULL),
  ('1038103943', NULL, 'Antioquia', NULL),
  ('1000903129', NULL, 'Antioquia', NULL),
  ('1017241054', NULL, 'Antioquia', NULL),
  ('1007054708', NULL, 'Antioquia', NULL),
  ('1035433744', NULL, 'Antioquia', NULL),
  ('1035973803', NULL, 'Antioquia', NULL),
  ('1152443667', NULL, 'Antioquia', NULL),
  ('1000193974', NULL, 'Antioquia', NULL),
  ('1036649933', NULL, 'Antioquia', NULL),
  ('1035878816', NULL, 'Antioquia', NULL),
  ('1003815057', NULL, 'Antioquia', NULL),
  ('1001244494', NULL, 'Antioquia', NULL),
  ('1000193061', NULL, 'Antioquia', NULL),
  ('1037650398', NULL, 'Antioquia', NULL),
  ('1214741802', NULL, 'Antioquia', NULL),
  ('1152464337', NULL, 'Antioquia', NULL),
  ('1214748551', NULL, 'Antioquia', NULL),
  ('1105353406', NULL, 'Antioquia', NULL),
  ('1214742415', NULL, 'Antioquia', NULL),
  ('43300311', NULL, 'Antioquia', NULL),
  ('1152692738', NULL, 'Antioquia', NULL),
  ('1037639717', NULL, 'Antioquia', NULL),
  ('1152439103', NULL, 'Antioquia', NULL),
  ('1000397452', NULL, 'Antioquia', NULL),
  ('1020419351', NULL, 'Antioquia', NULL),
  ('43973331', NULL, 'Antioquia', NULL),
  ('1036424737', NULL, 'Antioquia', NULL),
  ('1037598461', NULL, 'Antioquia', NULL),
  ('1020222848', NULL, 'Antioquia', NULL),
  ('1001687045', NULL, 'Antioquia', NULL),
  ('43597151', NULL, 'Antioquia', NULL),
  ('1035230789', NULL, 'Antioquia', NULL),
  ('1023528612', NULL, 'Antioquia', NULL),
  ('1001808465', NULL, 'Antioquia', NULL),
  ('1017261087', NULL, 'Antioquia', NULL),
  ('1128421942', NULL, 'Antioquia', NULL),
  ('1033178677', NULL, 'Antioquia', NULL),
  ('1017255194', NULL, 'Antioquia', NULL),
  ('1127454441', NULL, 'Antioquia', NULL),
  ('1048264533', NULL, 'Antioquia', NULL),
  ('1000899616', NULL, 'Antioquia', NULL),
  ('42692170', NULL, 'Antioquia', NULL),
  ('1073628235', NULL, 'Antioquia', NULL),
  ('1067095807', NULL, 'Antioquia', NULL),
  ('1020103057', NULL, 'Antioquia', NULL),
  ('1128443325', NULL, 'Antioquia', NULL),
  ('6974507', NULL, 'Antioquia', NULL),
  ('1035875615', NULL, 'Antioquia', NULL),
  ('1037449922', NULL, 'Antioquia', NULL),
  ('1001015196', NULL, 'Antioquia', NULL),
  ('1152225261', NULL, 'Antioquia', NULL),
  ('1128483669', NULL, 'Antioquia', NULL),
  ('1036252274', NULL, 'Antioquia', NULL),
  ('43978990', NULL, 'Antioquia', NULL),
  ('1152448014', NULL, 'Antioquia', NULL),
  ('1017211529', NULL, 'Antioquia', NULL),
  ('1007940687', NULL, 'Antioquia', NULL),
  ('1214736246', NULL, 'Antioquia', NULL),
  ('1017267088', NULL, 'Antioquia', NULL),
  ('1041631070', NULL, 'Antioquia', NULL),
  ('1021922774', NULL, 'Antioquia', NULL),
  ('1059712664', NULL, 'Antioquia', NULL),
  ('1000547259', NULL, 'Antioquia', NULL),
  ('1128456275', NULL, 'Antioquia', NULL),
  ('1000020654', NULL, 'Antioquia', NULL),
  ('1020814732', NULL, 'Meta', NULL),
  ('901958366', NULL, 'Risaralda', NULL),
  ('1005572694', NULL, 'Sucre', NULL),
  ('1014299657', NULL, 'Meta', NULL),
  ('1124020709', NULL, 'Antioquia', NULL),
  ('8784216', NULL, 'Norte de Santander', NULL),
  ('1002192016', NULL, 'Bolívar', NULL),
  ('1098809998', NULL, 'Santander', NULL),
  ('1018493533', NULL, 'Bogotá, D.C.', NULL),
  ('39448545', NULL, 'Antioquia', NULL),
  ('1019041334', NULL, 'Antioquia', NULL),
  ('1036670684', NULL, 'Antioquia', NULL),
  ('1037641777', NULL, 'Antioquia', NULL),
  ('1037618250', NULL, 'Antioquia', NULL),
  ('1144076351', NULL, 'Antioquia', NULL),
  ('1007918996', NULL, 'Antioquia', NULL),
  ('1035390065', NULL, 'Antioquia', NULL),
  ('1037591862', NULL, 'Antioquia', NULL),
  ('1007102122', NULL, 'Antioquia', NULL),
  ('1126599926', NULL, 'Antioquia', NULL),
  ('1001368385', NULL, 'Antioquia', NULL),
  ('1005565504', NULL, 'Antioquia', NULL),
  ('1152697718', NULL, 'Antioquia', NULL),
  ('1036668975', NULL, 'Antioquia', NULL),
  ('1130724215', NULL, 'Antioquia', NULL),
  ('1000870366', NULL, 'Antioquia', NULL),
  ('1192776978', NULL, 'Antioquia', NULL),
  ('1022142927', NULL, 'Antioquia', NULL),
  ('1037608614', NULL, 'Antioquia', NULL),
  ('71339767', NULL, 'Antioquia', NULL),
  ('1001250178', NULL, 'Antioquia', NULL),
  ('1000655048', NULL, 'Antioquia', NULL),
  ('1045050122', NULL, 'Antioquia', NULL),
  ('1144072992', NULL, 'Antioquia', NULL),
  ('1035974227', NULL, 'Antioquia', NULL),
  ('1001250533', NULL, 'Antioquia', NULL),
  ('1017228755', NULL, 'Antioquia', NULL),
  ('222222222222', NULL, 'Antioquia', NULL),
  ('1055833597', NULL, 'Antioquia', NULL),
  ('1020472458', NULL, 'Antioquia', NULL),
  ('1036651213', NULL, 'Antioquia', NULL),
  ('1036448776', NULL, 'Antioquia', NULL),
  ('1193124195', NULL, 'Antioquia', NULL),
  ('1039468408', NULL, 'Antioquia', NULL),
  ('1000414369', NULL, 'Antioquia', NULL),
  ('1037613211', NULL, 'Antioquia', NULL),
  ('1000569092', NULL, 'Antioquia', NULL),
  ('1017238590', NULL, 'Antioquia', NULL),
  ('1053862486', NULL, 'Antioquia', NULL),
  ('32257709', NULL, 'Antioquia', NULL),
  ('1037666227', NULL, 'Antioquia', NULL),
  ('1035437184', NULL, 'Antioquia', NULL),
  ('1007242127', NULL, 'Antioquia', NULL),
  ('32299381', NULL, 'Antioquia', NULL),
  ('1092454032', NULL, 'Antioquia', NULL),
  ('1004925161', NULL, 'Antioquia', NULL),
  ('1032425568', NULL, 'Antioquia', NULL),
  ('1036609419', NULL, 'Antioquia', NULL),
  ('1001468359', NULL, 'Antioquia', NULL),
  ('1001011318', NULL, 'Antioquia', NULL),
  ('1017252525', NULL, 'Antioquia', NULL),
  ('1193404135', NULL, 'Antioquia', NULL),
  ('10376555318', NULL, 'Antioquia', NULL),
  ('1036657443', NULL, 'Antioquia', NULL),
  ('1214715646', NULL, 'Antioquia', NULL),
  ('43189935', NULL, 'Antioquia', NULL),
  ('1036686049', NULL, 'Antioquia', NULL),
  ('1036610562', NULL, 'Antioquia', NULL),
  ('1011393616', NULL, 'Antioquia', NULL),
  ('1037646823', NULL, 'Antioquia', NULL),
  ('1020441764', NULL, 'Antioquia', NULL),
  ('1040757370', NULL, 'Antioquia', NULL),
  ('1042066642', NULL, 'Antioquia', NULL),
  ('43999295', NULL, 'Antioquia', NULL),
  ('1000397790', NULL, 'Antioquia', NULL),
  ('1017247417', NULL, 'Antioquia', NULL),
  ('43094020', NULL, 'Antioquia', NULL),
  ('1018223893', NULL, 'Antioquia', NULL),
  ('1035438240', NULL, 'Antioquia', NULL),
  ('1001160786', NULL, 'Antioquia', NULL),
  ('1000442758', NULL, 'Antioquia', NULL),
  ('1031941714', NULL, 'Antioquia', NULL),
  ('1214714725', NULL, 'Antioquia', NULL),
  ('1121890302', NULL, 'Antioquia', NULL),
  ('1128275640', NULL, 'Antioquia', NULL),
  ('66724168', NULL, 'Quindío', NULL),
  ('1006788055', NULL, 'Putumayo', NULL),
  ('1131224210', NULL, 'Antioquia', NULL),
  ('1042763527', NULL, 'Antioquia', NULL),
  ('901795272', NULL, 'Antioquia', NULL),
  ('43112464', NULL, 'Antioquia', NULL),
  ('1082104915', NULL, 'Nariño', NULL),
  ('1026585661', NULL, 'Bogotá, D.C.', NULL),
  ('1037649866', NULL, 'Antioquia', NULL),
  ('79095550', NULL, 'Cundinamarca', NULL),
  ('901439013', NULL, 'Antioquia', NULL),
  ('18522535', NULL, 'Risaralda', NULL),
  ('53072030', NULL, 'Cundinamarca', NULL),
  ('1022351737', NULL, 'Bogotá, D.C.', NULL),
  ('43149133', NULL, 'Antioquia', NULL),
  ('53038182', NULL, 'Bogotá, D.C.', NULL),
  ('1020817135', NULL, 'Bogotá, D.C.', NULL),
  ('1018342796', NULL, 'Antioquia', NULL),
  ('1065582147', NULL, 'Cesar', NULL),
  ('1113528656', NULL, 'Valle del Cauca', NULL),
  ('1036640418', NULL, 'Antioquia', NULL),
  ('1036642181', NULL, 'Antioquia', NULL),
  ('1036642649', NULL, 'Antioquia', NULL),
  ('1042774076', NULL, 'Antioquia', NULL),
  ('1037633899', NULL, 'Antioquia', NULL),
  ('1001359732', NULL, 'Antioquia', NULL),
  ('1152688503', NULL, 'Antioquia', NULL),
  ('1214721483', NULL, 'Antioquia', NULL),
  ('1037671903', NULL, 'Antioquia', NULL),
  ('1017269702', NULL, 'Antioquia', NULL),
  ('1125789328', NULL, 'Antioquia', NULL),
  ('1017214897', NULL, 'Antioquia', NULL),
  ('1001469752', NULL, 'Antioquia', NULL),
  ('1000087622', NULL, 'Antioquia', NULL),
  ('1001577097', NULL, 'Antioquia', NULL),
  ('1036629382', NULL, 'Antioquia', NULL),
  ('1020487868', NULL, 'Antioquia', NULL),
  ('1036612316', NULL, 'Antioquia', NULL),
  ('1022002985', NULL, 'Antioquia', NULL),
  ('1000902614', NULL, 'Antioquia', NULL),
  ('1020483459', NULL, 'Antioquia', NULL),
  ('1000653733', NULL, 'Antioquia', NULL),
  ('1000752630', NULL, 'Antioquia', NULL),
  ('1128397474', NULL, 'Antioquia', NULL),
  ('1036662022', NULL, 'Antioquia', NULL),
  ('53107466', NULL, 'Antioquia', NULL),
  ('1013343750', NULL, 'Antioquia', NULL),
  ('1017217701', NULL, 'Antioquia', NULL),
  ('1001455803', NULL, 'Antioquia', NULL),
  ('1085311885', NULL, 'Antioquia', NULL),
  ('1033180723', NULL, 'Antioquia', NULL),
  ('41953406', NULL, 'Antioquia', NULL),
  ('1037574423', NULL, 'Antioquia', NULL),
  ('1000085430', NULL, 'Antioquia', NULL),
  ('1067955916', NULL, 'Antioquia', NULL),
  ('1000536473', NULL, 'Antioquia', NULL),
  ('1018224980', NULL, 'Antioquia', NULL),
  ('1023629398', NULL, 'Antioquia', NULL),
  ('40327488', NULL, 'Antioquia', NULL),
  ('1152206488', NULL, 'Antioquia', NULL),
  ('1040747201', NULL, 'Antioquia', NULL),
  ('1036953888', NULL, 'Antioquia', NULL),
  ('43974523', NULL, 'Antioquia', NULL),
  ('1025640376', NULL, 'Antioquia', NULL),
  ('1001359241', NULL, 'Antioquia', NULL),
  ('1000445952', NULL, 'Antioquia', NULL),
  ('1152450568', NULL, 'Antioquia', NULL),
  ('1001469068', NULL, 'Antioquia', NULL),
  ('32106938', NULL, 'Antioquia', NULL),
  ('1037073974', NULL, 'Antioquia', NULL),
  ('1036640160', NULL, 'Antioquia', NULL),
  ('1040750107', NULL, 'Antioquia', NULL),
  ('1128430511', NULL, 'Antioquia', NULL),
  ('1037638880', NULL, 'Antioquia', NULL),
  ('1036602908', NULL, 'Antioquia', NULL),
  ('1053786709', NULL, 'Antioquia', NULL),
  ('1072704453', NULL, 'Antioquia', NULL),
  ('1036617654', NULL, 'Antioquia', NULL),
  ('1037611682', NULL, 'Antioquia', NULL),
  ('1054681546', NULL, 'Antioquia', NULL),
  ('1017228390', NULL, 'Antioquia', NULL),
  ('1000439747', NULL, 'Antioquia', NULL),
  ('1007286336', NULL, 'Antioquia', NULL),
  ('1128416023', NULL, 'Antioquia', NULL),
  ('10222006279', NULL, 'Antioquia', NULL),
  ('1152470029', NULL, 'Antioquia', NULL),
  ('32299317', NULL, 'Antioquia', NULL),
  ('1013358247', NULL, 'Antioquia', NULL),
  ('1037661378', NULL, 'Antioquia', NULL),
  ('44001969', NULL, 'Antioquia', NULL),
  ('1152459394', NULL, 'Antioquia', NULL),
  ('1017268517', NULL, 'Antioquia', NULL),
  ('1006502805', NULL, 'Antioquia', NULL),
  ('1020463124', NULL, 'Antioquia', NULL),
  ('43871983', NULL, 'Antioquia', NULL),
  ('1033488749', NULL, 'Antioquia', NULL),
  ('1037751087', NULL, 'Antioquia', NULL),
  ('43878947', NULL, 'Antioquia', NULL),
  ('1013342274', NULL, 'Antioquia', NULL),
  ('43607935', NULL, 'Antioquia', NULL),
  ('1035440166', NULL, 'Antioquia', NULL),
  ('1037623931', NULL, 'Antioquia', NULL),
  ('1020435309', NULL, 'Antioquia', NULL),
  ('1013658183', NULL, 'Antioquia', NULL),
  ('1037647629', NULL, 'Antioquia', NULL),
  ('21500796', NULL, 'Antioquia', NULL),
  ('1214720454', NULL, 'Antioquia', NULL),
  ('1152201021', NULL, 'Antioquia', NULL),
  ('1128418070', NULL, 'Antioquia', NULL),
  ('1001456593', NULL, 'Antioquia', NULL),
  ('1152704098', NULL, 'Antioquia', NULL),
  ('1152704579', NULL, 'Antioquia', NULL),
  ('43532649', NULL, 'Antioquia', NULL),
  ('1004766912', NULL, 'Antioquia', NULL),
  ('1001456545', NULL, 'Antioquia', NULL),
  ('1095825525', NULL, 'Antioquia', NULL),
  ('1017131059', NULL, 'Antioquia', NULL),
  ('1152713674', NULL, 'Antioquia', NULL),
  ('100294648', NULL, 'Antioquia', NULL),
  ('1152210535', NULL, 'Antioquia', NULL),
  ('1035438069', NULL, 'Antioquia', NULL),
  ('901883014', 'Carrera 5 # 14 04 piso 4 barrio san pedro centro', 'Valle del Cauca', NULL),
  ('1000756348', 'Calle 78a # 67-54, Apto 447', 'Antioquia', NULL),
  ('1001227151', 'CRA 24D #53-27 Caicedo quintas de la playa, Primer parqueadero 3 cuadra 3 casa primer piso', 'Antioquia', NULL),
  ('1004845181', 'Casa, Calle 48 #43-51', 'Antioquia', NULL),
  ('1017228932', 'Diagonal 54 #17 100, Apto 1305', 'Antioquia', NULL),
  ('1020428618', 'CL 57 D 85 E 80 COLINAS DE CALASANZ, 1 PISO', 'Antioquia', NULL),
  ('1020484655', 'Av 48 #57-21, Apto 201', 'Antioquia', NULL),
  ('1036685359', 'Transversal 38aa n 59a 231, Puerto alegre', 'Antioquia', NULL),
  ('1037614242', 'Transversal 36 Sur 29 47 Tercer Piso, Tercer Piso', 'Antioquia', NULL),
  ('1039457268', 'TRANSVERSAL 27A SUR #42-13, CONJUNTO RESIDENCIAL TORREALBA APTO 407', 'Antioquia', NULL),
  ('1039474335', 'calle 70 55a-06, Edificio Montefaro apartamento 1505', 'Antioquia', NULL),
  ('1128397954', 'Av 33 42c 91, Piso 1 los ciruelos', 'Antioquia', NULL),
  ('1193105991', 'Cra. 58 #79 - 101, Urbanizacion parques de san pablo, bloque 1 apt 457', 'Antioquia', NULL),
  ('1193579952', 'Av 37 # 45 48, Barrio las vegas, primer piso', 'Antioquia', NULL),
  ('43094020-1', 'Dorado, Carrera 41 44 Sur 46', 'Antioquia', NULL),
  ('1121909517', 'recogen en lys', 'Guaviare', NULL),
  ('2100939038', 'CR 7 # 9 C - 09 OFICINA PPAL SERVIENTREGA', 'Putumayo', NULL),
  ('901724577', 'Carrera 76 n 51-60, urbanizacion parques del estadio, bloque 5 apto 320', 'Antioquia', NULL),
  ('1216726146', 'Calle 19 # 17-12', 'Antioquia', NULL),
  ('1085945635', 'Cra 12 No 16-26 barrio libertad 1punto', 'Nariño', NULL),
  ('53931853', 'TV 12 22 42 centro comercial Manila local 58 piso 2', 'Cundinamarca', NULL),
  ('1054566496', 'Cra10#8-50 conjunto tejares del rio casa 7', 'Caldas', NULL),
  ('1006997025', 'OFICINA PRINCIPAL SERVIENTREGA CRA 7#9C -09', 'Putumayo', NULL),
  ('1031127224', 'CRA 26 c bis # 34 - 58 sur', 'Bogotá, D.C.', NULL),
  ('52210902', 'Carrera 73 # 35 B 42 sur local 11 barrio Carvajal, Los horarios de 10 am a 8 PM por favor tenerlos en cuenta de lunes a sabado', 'Bogotá, D.C.', NULL),
  ('3212084030', 'Calle 5g # 32-110 edificio macedonia apto 1301', 'Antioquia', NULL),
  ('901967511', 'Edificio Carrera 4 No 11-20', 'Cundinamarca', '573132082187'),
  ('43183045', 'CALLE 77 SUR # 43 - 76 APT 1114 MANANTIALES DE SAN JOSE', 'Antioquia', '3135436972'),
  ('42077080', 'MANZANA 7 CASA 7 BARRIO HERNANDO VELEZ MARULANDA', 'Risaralda', '3127799731'),
  ('1093759464', 'Calle 14b 9-41 tierra linda los patios', 'Norte de Santander', '573132358435'),
  ('1022323161', 'Calle 39# 7 16 manantial', 'Meta', '573104577408'),
  ('901548500', 'Avenida ferrocarril #26 a esquina local 3 Maria Claudia Store Cc la caja', 'Magdalena', '573052793391'),
  ('1002085207', 'Cra 30 #32-16', 'Antioquia', '573217940376'),
  ('1053860940', 'Carrera 22 N 29-29 parque Caldas local PC5', 'Caldas', '573108289981'),
  ('1118553295', 'Calle 26 #12-93 Barrio araguaney', 'Casanare', '573212854624'),
  ('1036679304', 'Calle 56 # 60-26 calatrava', 'Antioquia', '573046274473'),
  ('1003804218', 'Calle 20 # 18-77 Tecnosoluciones', 'Antioquia', '573113489394'),
  ('1024531902', 'Carrera 39 # 13 -42 conjunto olivo 2 , torre 11 apto 604 Ciudad verde -', 'Cundinamarca', '573212823262'),
  ('1088301545', 'CRA 31 # 15-87 barrio san Luis, al lado de alameda de San Luis', 'Risaralda', '573136342845'),
  ('1091683459', 'Calle 10#10-82', 'Norte de Santander', '573222909598'),
  ('80774748', 'CRA 17B 48-57 BARRIO LA CONCORDIA BUCARAMANGA', 'Santander', '573011448975'),
  ('901370080', 'Carrera 100 # 15A - 61', 'Valle del Cauca', '3153060675'),
  ('1010240431', 'Bosa Piamonte calle 68 a sur numero 80f-58', 'Bogotá, D.C.', NULL),
  ('1143373764', 'Diagonal 35# Casa 5441 Urbanizacion Anita', 'Bolívar', NULL),
  ('1088280287', 'BARRIO POBLADO 2 CC POBLADO PLAZA LOCAL 7', 'Risaralda', NULL),
  ('901467182', 'CL 6 46 A 46 P 2 LC 13 Barrio Bellavista', 'Valle del Cauca', NULL),
  ('1094932135', 'Cll 5 Norte # 18A -112 Centro Comercial Bambusa Plaza Local 20', 'Quindío', NULL),
  ('1113307382', 'Calle 49 #50-62 Local 4 maca Barro centro', 'Valle del Cauca', NULL),
  ('80850239', 'calle 5 # 10-51', 'Valle del Cauca', NULL),
  ('901802943', 'Carrera 10 # 8-115 Local3 Barrio Centro', 'Amazonas', NULL),
  ('42162520', 'Calle 42 # 60a-07 santa clara', 'Antioquia', NULL),
  ('1110569762', 'Cll 121 No 7-44 Torreon Quinta Avenida Etapa 2 casa 148', 'Tolima', NULL),
  ('70827903', 'calle 14#8-91 Barrio centro comercial orquideas bodega 200 - el calvario,centro', 'Valle del Cauca', NULL),
  ('1127457263', 'CRA 6E 27C 47 BARRIO LAS AMERICAS GRANERO PUNTO ZENU', 'Nariño', NULL),
  ('1026159891', 'Carrera 55 #46-72 CC Oriente bodega 603 piso 6', 'Antioquia', NULL),
  ('24687210', 'cra4#6-50 barrio recreo', 'Caquetá', NULL),
  ('1018494443', 'Calle 103A 47A 04 Barrio Pasadena', 'Bogotá, D.C.', '573156548429'),
  ('1047429402', 'BARRIO CENTRO C.C CENTRO UNO -LOCAL 116', 'Bolívar', '573157888417'),
  ('1124032497', 'DIRECCION DE ENTREGA: Carrera 23a#76-11 los robles “casa” - SOLEDAD - ATLANTICO', 'Atlántico', '3188623653'),
  ('1018472489', 'Calle 64 sur # 35-33 Barrio Candelaria la nueva Local Gracia', 'Bogotá, D.C.', '573209276312'),
  ('1015068605', 'carrera 51 #52-34 Itagui', 'Antioquia', '573044162472'),
  ('1028033509', 'Cll89Ba#83-17 jardines Comfama torre 1 jazmines apartamento 402', 'Antioquia', '573135398935'),
  ('1033791890', 'calle 68 B BIS # 18 x 33 Sur barrio San Francisco', 'Bogotá, D.C.', '573222492211'),
  ('1143824838', 'Cr 35A #3A-01 local MKDAMIA Barrio San Fernando', 'Valle del Cauca', '573196483275'),
  ('1053871835', 'Cr7 #11 53 piso 2 Barrio los alamos por el colegio la normal, enseguida del arroz Paisa', 'Caldas', '573146465036'),
  ('1076332723', 'OFICINA PRINCIPAL ISTMINA CHOCO CRA 7 # 15 - 80', 'Chocó', '573233208513'),
  ('1007288617', 'mz D casa 1 barrio cabanas', 'Tolima', '573213519495'),
  ('1022427856', 'Cra 4 # 5-26 Centro', 'Tolima', '573209250041'),
  ('1090495961', 'Av 6c # 4-149 prados del este', 'Norte de Santander', '573238181883'),
  ('31067304', 'CLL 10 #5-84 (Edificio CADE, interior 1) PARQUE SANTANDER', 'Norte de Santander', '584268480971'),
  ('1027892574', 'Cr 50 # 47 09 apto 201 estacion jardin', 'Antioquia', '573215327302'),
  ('1118303519', 'carrera 5 # 2-64 barrio belalcazar', 'Valle del Cauca', '573116481125'),
  ('901501576-9', 'Cra 55 # 46-65 centro comercial el arca Bodega 1401 - Medellin Antioquia', 'Antioquia', '3137493829'),
  ('1049619919', 'Calle 20a 12 32 pasaje comercial Solano local 105 Glow Cosmetic', 'Boyacá', '573114723520'),
  ('1007294516', 'Mz Cs 5 laureles 2 cuba', 'Risaralda', '573104409152'),
  ('1115914745', 'CARRERA 22 N° 13 - 67/ Ciudad y barrio: Yopal, Centro', 'Casanare', NULL),
  ('1102724820', 'carrera 10#14-52 barrio centro', 'Santander', NULL),
  ('1044392713', 'Santa Marta / Calle 21 # 4-65 al lado del hotel brisas del mal Siempredivas / Centro Santa Marta / 3143861650', 'Magdalena', NULL),
  ('1097039688', 'Carrera 6 #16-52 centro (peluqueria Pulidos)', 'Quindío', NULL),
  ('1098712018', 'calle 9#10-23 centro', 'Santander', NULL),
  ('17103979', 'Carrera 96 c n 50 a 280 unidad monteparaiso Torre 2 apto 311', 'Antioquia', NULL),
  ('1085275622', 'cra 50 #32 -16 taller autolarte chevrolet', 'Antioquia', NULL),
  ('1019148659', 'AV BOLIVAR CR 14#15NORTE 47 LOCAL 1 AMARELA', 'Quindío', NULL),
  ('901587606', 'Av el consulado Calle 30 Diagonal 64 111 local 1 piso 1', 'Bolívar', NULL),
  ('1121943673', 'Carrera 34 a numero 5-120 sur Condominio Santana casa b6', 'Meta', NULL),
  ('1717556318', 'Narino Calle 14 No. 10-55, Hotel Plaza la 14', 'Nariño', NULL),
  ('1050959662', 'Urbanizacion la granja mz D lote 4 edificio Hored local 4 Berma Cosmetics', 'Bolívar', NULL),
  ('1116272567', 'Kilometros 2 via la rivera ciudad campestre casa de los abuelos', 'Valle del Cauca', NULL),
  ('1002633914', 'Cll 33 No. 23A-13 barrio Linares', 'Caldas', NULL),
  ('902034720', 'calle 19 8-69 centro', 'Risaralda', NULL),
  ('43537952244', 'Cra 70 #30A-51', 'Antioquia', NULL),
  ('1120873425', 'Calle 7 #16-57 Los mangos', 'Meta', NULL),
  ('1100397086', 'Calle 10 # 3-19', 'Sucre', NULL),
  ('1087989644', 'CL 82 No. 37-97 Torres de Alejandria Via Condina Torre 1 Apto 604', 'Risaralda', NULL),
  ('1086105375', 'CRA 7 #22- 36', 'Nariño', NULL),
  ('16946360', 'Libertadores calle 13 num 9-48 cc caña dulce local 59 piso 1', 'Valle del Cauca', NULL),
  ('1118868435', 'Carrera 9 13b 79', 'Cesar', NULL),
  ('901845603', 'Mz 36 casa 34 corales Local 1er piso', 'Risaralda', NULL),
  ('1121928945', 'cra 7 #15-80 Itsmina oficina de servientrega', 'Chocó', NULL)
)
UPDATE core.destinatarios d
   SET direccion    = COALESCE(a.direccion, d.direccion),
       departamento = COALESCE(a.departamento, d.departamento),
       telefono     = COALESCE(a.telefono, d.telefono)
  FROM archivo a
 WHERE d.nit = a.nit
   AND (d.direccion    IS DISTINCT FROM COALESCE(a.direccion, d.direccion)
     OR d.departamento IS DISTINCT FROM COALESCE(a.departamento, d.departamento)
     OR d.telefono     IS DISTINCT FROM COALESCE(a.telefono, d.telefono));

-- Los que siguen sin departamento: deducirlo por la ciudad
UPDATE core.destinatarios d
   SET departamento = core.fn_departamento_de_ciudad(d.ciudad)
 WHERE d.departamento IS NULL AND core.fn_departamento_de_ciudad(d.ciudad) IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. fn_crear_solicitud: departamento por ciudad como último recurso
-- ─────────────────────────────────────────────────────────────────────────────
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
  p_observaciones      text  DEFAULT NULL
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
  IF p_origen NOT IN ('MANUAL','PDF') THEN
    RAISE EXCEPTION 'DSP004: origen inválido (%)', p_origen USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'DSP005: la solicitud no tiene líneas' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lineas) > 5000 THEN
    RAISE EXCEPTION 'DSP006: máximo 5000 líneas por solicitud' USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Validación de líneas (en tabla temporal de la transacción)
  CREATE TEMP TABLE IF NOT EXISTS tmp_lineas_v2 (
    linea_nro integer, entrega text, destinatario_nit text, destinatario_nombre text,
    destinatario_ciudad text, material text, producto_descripcion text, cantidad numeric,
    um text, item integer, bodega text, precio_unitario numeric, descuento_pct numeric,
    subtotal numeric, total numeric,
    ean text, direccion text, departamento text, telefono text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_lineas_v2;

  INSERT INTO pg_temp.tmp_lineas_v2
  SELECT o.ord::integer,
         upper(trim(l.entrega)), trim(l.destinatario), upper(trim(l.nombre)),
         upper(trim(l.lugar)),   upper(trim(l.material)), l.producto,
         l.cantidad, COALESCE(NULLIF(upper(trim(l.um)),''),'BUL'),
         l.item, NULLIF(trim(l.bodega),''),
         l.precio, l.descuento_pct, l.subtotal, l.total,
         NULLIF(trim(l.ean),''), NULLIF(upper(trim(l.direccion)),''),
         NULLIF(upper(trim(l.departamento)),''), NULLIF(trim(l.telefono),'')
  FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS l(entrega text, destinatario text, nombre text, lugar text,
                                    material text, producto text, cantidad numeric, um text,
                                    item integer, bodega text, precio numeric,
                                    descuento_pct numeric, subtotal numeric, total numeric,
                                    ean text, direccion text, departamento text, telefono text);

  SELECT string_agg(format('fila %s', t.linea_nro), ', ' ORDER BY t.linea_nro) INTO v_dup
  FROM pg_temp.tmp_lineas_v2 t
  WHERE COALESCE(t.entrega,'') = '' OR COALESCE(t.destinatario_nit,'') = ''
     OR COALESCE(t.destinatario_nombre,'') = '' OR COALESCE(t.destinatario_ciudad,'') = ''
     OR COALESCE(t.material,'') = '' OR t.cantidad IS NULL OR t.cantidad <= 0;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP007: campos obligatorios vacíos o cantidad <= 0 en %', v_dup USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('Entrega %s + Material %s', d.entrega, d.material), '; ') INTO v_dup
  FROM (SELECT t.entrega, t.material FROM pg_temp.tmp_lineas_v2 t
        GROUP BY t.entrega, t.material HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'DSP008: líneas duplicadas: %', v_dup USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*), sum(t.cantidad) INTO v_lineas, v_unidades FROM pg_temp.tmp_lineas_v2 t;

  -- 5) Encabezado con consecutivo de la secuencia (único aunque radiquen 100 a la vez)
  v_numero := 'DSP-' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY') || '-'
              || lpad(nextval('despachos.seq_solicitud_numero')::text, 6, '0');

  INSERT INTO despachos.solicitudes AS s (
    numero, idempotency_key, cuenta_id, origen, area_solicitante,
    solicitante_id, solicitante_nombre, solicitante_correo,
    numero_pedido_origen, archivo_origen, datos_origen,
    total_lineas, total_unidades, observaciones, created_by)
  VALUES (
    v_numero, p_idempotency_key, v_cuenta, p_origen, upper(trim(p_area_solicitante)),
    v_uid, upper(trim(p_solicitante_nombre)), lower(trim(p_solicitante_correo)),
    NULLIF(trim(p_numero_pedido_origen),''), p_archivo_origen, p_datos_origen,
    v_lineas, v_unidades, p_observaciones, v_uid)
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
    ean, destinatario_direccion, destinatario_departamento, destinatario_telefono)
  SELECT v_id, t.linea_nro, t.entrega, d.id, t.destinatario_nit,
         t.destinatario_nombre, t.destinatario_ciudad, t.material, t.producto_descripcion,
         t.cantidad, t.um, t.item, t.bodega, t.precio_unitario, t.descuento_pct,
         t.subtotal, t.total, v_uid,
         COALESCE(t.ean, ie.ean), COALESCE(t.direccion, d.direccion),
         COALESCE(t.departamento, d.departamento, core.fn_departamento_de_ciudad(t.destinatario_ciudad)),
         COALESCE(t.telefono, d.telefono)
  FROM pg_temp.tmp_lineas_v2 t
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Líneas ya radicadas: completar con el maestro
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE despachos.solicitud_lineas l
   SET destinatario_direccion    = COALESCE(l.destinatario_direccion, d.direccion),
       destinatario_departamento = COALESCE(l.destinatario_departamento, d.departamento,
                                            core.fn_departamento_de_ciudad(l.destinatario_ciudad)),
       destinatario_telefono     = COALESCE(l.destinatario_telefono, d.telefono)
  FROM core.destinatarios d
 WHERE d.nit = l.destinatario_nit
   AND (l.destinatario_direccion IS NULL OR l.destinatario_departamento IS NULL OR l.destinatario_telefono IS NULL);

UPDATE despachos.solicitud_lineas l
   SET destinatario_departamento = core.fn_departamento_de_ciudad(l.destinatario_ciudad)
 WHERE l.destinatario_departamento IS NULL
   AND core.fn_departamento_de_ciudad(l.destinatario_ciudad) IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Permisos y RLS
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON core.ciudades FROM anon, authenticated;
GRANT SELECT ON core.ciudades TO authenticated;
GRANT INSERT (ciudad, departamento, activo), UPDATE (departamento, activo) ON core.ciudades TO authenticated;
GRANT ALL ON core.ciudades TO service_role;
GRANT EXECUTE ON FUNCTION core.fn_normalizar_texto(text), core.fn_departamento_de_ciudad(text) TO authenticated, service_role;

ALTER TABLE core.ciudades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_ciudades_leer ON core.ciudades;
CREATE POLICY pol_ciudades_leer ON core.ciudades FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_ciudades_escribir ON core.ciudades;
CREATE POLICY pol_ciudades_escribir ON core.ciudades FOR INSERT TO authenticated
  WITH CHECK ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));
DROP POLICY IF EXISTS pol_ciudades_actualizar ON core.ciudades;
CREATE POLICY pol_ciudades_actualizar ON core.ciudades FOR UPDATE TO authenticated
  USING ((SELECT core.fn_tiene_rol('DESPACHOS', ARRAY['operador','admin'])));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACIÓN (ejecutar aparte)
--   SELECT nit, nombre, direccion, ciudad, departamento, telefono
--     FROM core.destinatarios WHERE nit ILIKE '%900615349%';
--       → CRA 45 # 35 27 PISO 3 CEDI · Barranquilla · Atlántico · 573102229020
--   SELECT count(*) FILTER (WHERE direccion IS NOT NULL) AS con_direccion,
--          count(*) FILTER (WHERE departamento IS NOT NULL) AS con_departamento,
--          count(*) AS total
--     FROM core.destinatarios;
--   SELECT nit, nombre, ciudad FROM core.destinatarios WHERE departamento IS NULL;
--       → los pocos sin departamento: su ciudad no está en core.ciudades
-- =============================================================================


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 022 · 022_clientes_revision_busqueda_parecida.sql
-- █████████████████████████████████████████████████████████████████████████████
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


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 023 · 023_despachos_dse_proceso_plantilla.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 023_despachos_dse_proceso_plantilla.sql
-- Plataforma L&S · Portal de Despachos · Toma de pedidos fase 6 (23-oct-2026)
--
-- QUÉ HACE
--  1. N° de solicitud nuevo: DSE-NNNNNN (10 caracteres), ej. DSE-000273.
--       DSE = Despachos sede La Estrella. Futuras sedes: DS + letra de la sede.
--     Continúa la MISMA secuencia de los DSP-AAAA-NNNNNN (no se pierde ni se
--     repite el consecutivo). Los números DSP ya radicados no cambian.
--  2. Proceso de la solicitud: RAPPI | MP | VARIOS (despachos.solicitudes.proceso).
--  3. Observaciones por línea (despachos.solicitud_lineas.observaciones), de la
--     plantilla "Plantilla_Pedido.xlsx".
--  4. Nuevo origen EXCEL (pedido cargado con la plantilla).
--  5. Vistas vw_solicitudes y vw_solicitud_lineas con proceso y observaciones
--     (columnas agregadas al final).
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
--  Requiere haber ejecutado antes 017 a 022.
-- =============================================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas y reglas nuevas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE despachos.solicitudes      ADD COLUMN IF NOT EXISTS proceso       text;
ALTER TABLE despachos.solicitud_lineas ADD COLUMN IF NOT EXISTS observaciones text;

ALTER TABLE despachos.solicitudes DROP CONSTRAINT IF EXISTS ck_solicitudes_proceso;
ALTER TABLE despachos.solicitudes ADD  CONSTRAINT ck_solicitudes_proceso
  CHECK (proceso IS NULL OR proceso IN ('RAPPI', 'MP', 'VARIOS'));

ALTER TABLE despachos.solicitudes DROP CONSTRAINT IF EXISTS ck_solicitudes_origen;
ALTER TABLE despachos.solicitudes ADD  CONSTRAINT ck_solicitudes_origen
  CHECK (origen IN ('MANUAL', 'PDF', 'EXCEL'));

COMMENT ON COLUMN despachos.solicitudes.numero IS
  'N° de solicitud. Desde 23-oct-2026: DSE-NNNNNN (10 caracteres). DSE = Despachos sede La Estrella; futuras sedes usarán DS + letra de la sede. Antes: DSP-AAAA-NNNNNN (se conservan). Misma secuencia despachos.seq_solicitud_numero.';
COMMENT ON SEQUENCE despachos.seq_solicitud_numero IS
  'Consecutivo único de solicitudes (DSP-AAAA-NNNNNN hasta 23-oct-2026, DSE-NNNNNN desde entonces). Máximo 999999.';
COMMENT ON COLUMN despachos.solicitudes.proceso IS 'Proceso de la solicitud: RAPPI | MP | VARIOS (obligatorio en el portal)';
COMMENT ON COLUMN despachos.solicitud_lineas.observaciones IS 'Observaciones de la entrega (columna Observaciones de Plantilla_Pedido.xlsx)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fn_crear_solicitud: DSE + proceso + observaciones + origen EXCEL
--    (se elimina la firma anterior para que no queden dos versiones)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS despachos.fn_crear_solicitud(uuid, text, text, text, text, jsonb, text, text, jsonb, text);

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
  IF v_proceso IS NOT NULL AND v_proceso NOT IN ('RAPPI','MP','VARIOS') THEN
    RAISE EXCEPTION 'DSP010: proceso inválido (%). Use Rappi, MP o Varios', p_proceso USING ERRCODE = 'check_violation';
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
COMMENT ON FUNCTION despachos.fn_crear_solicitud(uuid, text, text, text, text, jsonb, text, text, jsonb, text, text) IS
  'Radica una solicitud con todas sus líneas en UNA transacción. Idempotente por p_idempotency_key. N° DSE-NNNNNN.';
REVOKE ALL ON FUNCTION despachos.fn_crear_solicitud(uuid, text, text, text, text, jsonb, text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_crear_solicitud(uuid, text, text, text, text, jsonb, text, text, jsonb, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Vistas (columnas nuevas al final)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW despachos.vw_solicitudes
WITH (security_invoker = true) AS
SELECT s.id, s.numero, s.version, s.estado_codigo, e.nombre AS estado_nombre, s.origen,
       s.area_solicitante, s.solicitante_nombre, s.solicitante_correo,
       s.numero_pedido_origen, s.total_lineas, s.total_unidades,
       s.radicada_at, (s.radicada_at AT TIME ZONE 'America/Bogota')::date AS fecha_radicacion,
       s.anulado_at, s.motivo_anulacion, s.cuenta_id,
       s.lote_id, l.numero AS lote_numero, s.procesada_at,
       s.proceso
FROM despachos.solicitudes s
JOIN despachos.estados e ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes l ON l.id = s.lote_id;

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
       s.proceso, li.observaciones
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
JOIN despachos.estados e     ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes lt ON lt.id = s.lote_id;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 024 · 024_parametros_adjuntos_admon.sql
-- █████████████████████████████████████████████████████████████████████████████
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


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 025 · 025_despachos_motivos.sql
-- █████████████████████████████████████████████████████████████████████████████
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


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 026 · 026_maestros_clientes_articulos.sql
-- █████████████████████████████████████████████████████████████████████████████
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


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 028 · 028_fix_carga_masiva.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 028_fix_carga_masiva.sql   (v2 · 27-oct-2026)
-- Plataforma L&S · Portal de Despachos
--
-- QUÉ CORRIGE en la carga masiva de clientes (Maestros → Clientes → Carga masiva)
--  1. "UPDATE requires a WHERE clause": Supabase (pg_safeupdate) rechaza todo
--     UPDATE sin WHERE que llega desde el portal → se agrega "WHERE true".
--  2. "canceling statement due to statement timeout": Supabase corta a los
--     ~8 s las consultas del portal. La búsqueda del NIT comparaba cada fila
--     del Excel contra todo el maestro (498 × 1.115). Ahora el maestro se
--     normaliza una sola vez y se cruza por igualdad → milisegundos.
--  Mismas reglas de negocio. Solo reemplaza despachos.fn_cargar_clientes.
--  No toca datos.
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run. Idempotente.
-- =============================================================================
BEGIN;

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
         NULLIF(trim(regexp_replace(COALESCE(x.direccion, ''), '[\s ]+', ' ', 'g')), ''),
         core.fn_telefono_limpio(x.telefono), core.fn_telefono_limpio(x.telefono_2),
         NULLIF(trim(regexp_replace(COALESCE(x.ciudad, ''), '[\s ]+', ' ', 'g')), ''),
         NULLIF(trim(regexp_replace(COALESCE(x.departamento, ''), '[\s ]+', ' ', 'g')), '')
  FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS o(elem, ord),
       jsonb_to_record(o.elem) AS x(fila int, nit text, nombre text, direccion text, telefono text,
                                    ciudad text, departamento text, telefono_2 text);

  UPDATE pg_temp.tmp_carga_clientes t SET
    departamento = COALESCE(t.departamento, core.fn_departamento_de_ciudad(t.ciudad)),
    firma = lower(concat_ws('|', core.fn_nombre_comparable(t.nombre), core.fn_normalizar_texto(t.direccion),
                            t.telefono, t.telefono_2, core.fn_normalizar_texto(t.ciudad)))
  WHERE true;   -- Supabase (pg_safeupdate) rechaza UPDATE sin WHERE cuando llega desde el portal

  -- a) Datos obligatorios
  UPDATE pg_temp.tmp_carga_clientes t SET accion = 'NO_CARGADO',
    detalle = CASE WHEN t.nit_base IS NULL THEN 'NIT o código vacío (debe tener al menos un número)'
                   WHEN t.nombre IS NULL THEN 'Falta el nombre'
                   ELSE 'Falta el teléfono (obligatorio)' END
  WHERE t.nit_base IS NULL OR t.nombre IS NULL OR t.telefono IS NULL;

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

  -- c) Buscar el NIT en el maestro: exacto, con dígito de verificación, o con un dígito más al final.
  --    Rendimiento: el NIT del maestro se normaliza UNA vez y se cruza por igualdad
  --    (antes: cada fila × todo el maestro → superaba el límite de 8 s de Supabase).
  CREATE TEMP TABLE IF NOT EXISTS tmp_carga_maestro (
    id bigint, nombre text, nit text, limpio text, base text, sin_ultimo text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.tmp_carga_maestro;
  INSERT INTO pg_temp.tmp_carga_maestro (id, nombre, nit, limpio, base, sin_ultimo)
  SELECT d.id, d.nombre, d.nit, x.limpio, core.fn_nit_base(d.nit),
         CASE WHEN length(x.limpio) >= 10 THEN left(x.limpio, -1) END
  FROM core.destinatarios d
  CROSS JOIN LATERAL (SELECT core.fn_nit_limpio(d.nit) AS limpio) x
  WHERE d.cuenta_id IS NOT DISTINCT FROM v_cuenta;

  WITH cand AS (                       -- coincidencias (cada regla es un cruce por igualdad)
    SELECT t.fila, m.id, m.nombre, m.nit, (m.limpio = t.nit_base) AS exacto
    FROM pg_temp.tmp_carga_clientes t JOIN pg_temp.tmp_carga_maestro m ON m.limpio = t.nit_base
    WHERE t.accion IS NULL
    UNION
    SELECT t.fila, m.id, m.nombre, m.nit, false
    FROM pg_temp.tmp_carga_clientes t JOIN pg_temp.tmp_carga_maestro m ON m.base = t.nit_base
    WHERE t.accion IS NULL
    UNION
    SELECT t.fila, m.id, m.nombre, m.nit, false
    FROM pg_temp.tmp_carga_clientes t JOIN pg_temp.tmp_carga_maestro m ON m.limpio = t.nit_base || t.dv
    WHERE t.accion IS NULL AND t.dv IS NOT NULL
    UNION
    SELECT t.fila, m.id, m.nombre, m.nit, false
    FROM pg_temp.tmp_carga_clientes t JOIN pg_temp.tmp_carga_maestro m ON m.sin_ultimo = t.nit_base
    WHERE t.accion IS NULL AND length(t.nit_base) >= 9
  ), agr AS (                          -- un registro por cliente encontrado (exacto si alguna regla lo fue)
    SELECT c.fila, c.id, max(c.nombre) AS nombre, max(c.nit) AS nit, bool_or(c.exacto) AS exacto
    FROM cand c GROUP BY c.fila, c.id
  ), m AS (
    SELECT DISTINCT ON (a.fila) a.fila, a.id, a.nombre, a.exacto,
           count(*) OVER (PARTITION BY a.fila) AS n,
           string_agg(a.nit || ' ' || a.nombre, '; ') OVER (PARTITION BY a.fila) AS lista
    FROM agr a
    ORDER BY a.fila, a.exacto DESC, a.id
  )
  UPDATE pg_temp.tmp_carga_clientes t SET dest_id = m.id, dest_nombre = m.nombre,
         accion = CASE WHEN m.n > 1 AND NOT m.exacto THEN 'NO_CARGADO' END,
         detalle = CASE WHEN m.n > 1 AND NOT m.exacto THEN 'NIT ambiguo: existe más de un cliente con ese NIT (' || m.lista || ')' END
  FROM m
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

REVOKE ALL ON FUNCTION despachos.fn_cargar_clientes(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_cargar_clientes(jsonb, boolean) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 030 · 030_admin_validar_sql.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 030_admin_validar_sql.sql
-- Plataforma L&S · Herramienta de validación PREVIA de SQL ("pre-vuelo")
--
-- QUÉ HACE
--  admin.fn_validar_sql('<consulta>') analiza el PLAN de una consulta con
--  EXPLAIN (sin ejecutarla: no lee, no borra, no cambia nada) y devuelve un
--  semáforo VERDE / AMARILLO / ROJO con el costo estimado y las alertas.
--  Sirve para SELECT, UPDATE, DELETE e INSERT (una sola sentencia por llamada).
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run (una vez).
--  Uso:
--    SELECT * FROM admin.fn_validar_sql($q$ DELETE FROM core.destinatarios WHERE ... $q$);
--  Esquema "admin" privado: NO se publica al portal.
-- =============================================================================
SET statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS admin;
REVOKE ALL ON SCHEMA admin FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin.fn_validar_sql(
  p_sql        text,
  p_costo_rojo numeric DEFAULT 100000,     -- por encima: ROJO (no ejecutar)
  p_costo_amar numeric DEFAULT 10000)      -- por encima: AMARILLO (revisar)
RETURNS TABLE (semaforo text, costo_estimado numeric, filas_estimadas numeric, alertas text[], plan_texto text)
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  v_json   jsonb;
  v_txt    text := '';
  v_linea  text;
  v_alert  text[] := ARRAY[]::text[];
  v_costo  numeric;
  v_filas  numeric;
BEGIN
  IF p_sql ~* '^\s*(explain|begin|commit|rollback|create|drop|alter|truncate|grant|revoke)\M' THEN
    RAISE EXCEPTION 'Valide una sola sentencia SELECT / INSERT / UPDATE / DELETE (sin BEGIN, COMMIT ni DDL)';
  END IF;

  EXECUTE 'EXPLAIN (FORMAT JSON) ' || p_sql INTO v_json;
  FOR v_linea IN EXECUTE 'EXPLAIN ' || p_sql LOOP v_txt := v_txt || v_linea || E'\n'; END LOOP;

  v_costo := (v_json -> 0 -> 'Plan' ->> 'Total Cost')::numeric;
  v_filas := (v_json -> 0 -> 'Plan' ->> 'Plan Rows')::numeric;

  -- Patrones peligrosos (los que tumbaron la base el 27-oct-2026)
  IF v_txt ~ 'SubPlan' AND v_txt ~ 'Seq Scan' THEN
    v_alert := array_append(v_alert, 'SubPlan + Seq Scan: una subconsulta recorre una tabla completa POR CADA fila (todo contra todo).');
  END IF;
  IF v_txt ~ 'Nested Loop' AND v_txt ~ 'Join Filter' THEN
    v_alert := array_append(v_alert, 'Nested Loop con Join Filter: cruce sin igualdad simple; crece como filas × filas.');
  END IF;
  IF v_txt ~* '(^|\n)\s*(Join )?Filter:[^\n]*\m(fn_\w+|regexp_\w+|lower|upper|translate)\(' THEN
    v_alert := array_append(v_alert, 'Funciones de texto dentro del filtro: se ejecutan fila por fila e impiden usar índices.');
  END IF;
  IF v_txt ~ '(Join )?Filter:[^\n]* OR ' THEN
    v_alert := array_append(v_alert, 'OR en el filtro del cruce: impide Hash Join; separe en varios NOT EXISTS / UNION.');
  END IF;
  IF p_sql ~* '^\s*(update|delete)\M' AND p_sql !~* '\mwhere\M' THEN
    v_alert := array_append(v_alert, 'UPDATE/DELETE sin WHERE: afecta la tabla completa.');
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_costo >= p_costo_rojo
           OR (p_sql ~* '^\s*(update|delete)\M' AND p_sql !~* '\mwhere\M') OR (array_length(v_alert, 1) >= 2 AND v_costo >= p_costo_amar) THEN 'ROJO · no ejecutar'
         WHEN v_costo >= p_costo_amar OR array_length(v_alert, 1) >= 1 THEN 'AMARILLO · revisar antes'
         ELSE 'VERDE · OK' END,
    round(v_costo), round(v_filas), v_alert, v_txt;
END;
$$;
REVOKE ALL ON FUNCTION admin.fn_validar_sql(text, numeric, numeric) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION admin.fn_validar_sql(text, numeric, numeric) IS
  'Pre-vuelo: EXPLAIN sin ejecutar + semáforo de riesgo. Uso solo en SQL Editor.';


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 031 · 031_motivo_bloque_carga_articulos.sql
-- █████████████████████████████████████████████████████████████████████████████
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


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 032 · 032_consentimiento_inventario.sql
-- █████████████████████████████████████████████████████████████████████████████
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


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 033 · 033_restaurar_pasillos_y_separar_tarjeta.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 033_restaurar_pasillos_y_separar_tarjeta.sql
-- Plataforma L&S · Recuperar la pestaña "Pasillos" (INVENTARIO) del Portal de
-- Despachos y separar "tarjeta del launcher" de "acceso a la aplicación".
-- Proyecto Supabase: kpi-logistics
-- =============================================================================
--
-- CAUSA
--   El código del Portal NO cambió: InventarioPasillos.jsx, storageService.js y
--   la vista "inventario" en App.jsx siguen intactos. La pestaña solo se pinta si
--   core.fn_mis_aplicaciones() devuelve el código INVENTARIO para el usuario.
--   Esa función exige ap.activo AND ac.activo AND pf.activo.
--   En 017, core.aplicaciones es a la vez "las TARJETAS del launcher" de NexusKPI
--   y el permiso de la app. Quitar la tarjeta en KPI se hizo apagando el registro
--   INVENTARIO (o el acceso del usuario), y eso apagó también la pestaña aquí.
--   Evidencia: el encabezado pasó de "Desp.: admin · Inv.: admin" a "Desp.: admin".
--
-- QUÉ HACE ESTE SCRIPT
--   PASO 1 · Diagnóstico (solo lectura). Ejecutar primero y revisar.
--   PASO 2 · Restaurar INVENTARIO (aplicación y accesos). Idempotente.
--   PASO 3 · Nueva columna en_launcher: ocultar la tarjeta sin quitar el acceso.
--
-- BACKUPS: NO se necesitan si el PASO 1 muestra datos en
--   inventario.registros_pasillo e inventario.pasillos. Solo se restauraría
--   desde backup si esas tablas aparecen vacías (alguien hizo DELETE/TRUNCATE).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1 · DIAGNÓSTICO (solo lectura)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. ¿Existe la aplicación INVENTARIO y está activa?  (esperado: 1 fila, activo = true)
SELECT codigo, nombre, ruta, orden, activo
FROM core.aplicaciones
ORDER BY orden;

-- 1b. Accesos a INVENTARIO por usuario  (esperado: activo = true para quienes registran)
SELECT p.email, a.aplicacion_codigo, a.rol, a.activo, a.updated_at, a.version
FROM core.accesos a
JOIN core.perfiles p ON p.id = a.perfil_id
WHERE a.aplicacion_codigo = 'INVENTARIO'
ORDER BY p.email;

-- 1c. Cambios recientes a accesos (core.accesos sí tiene auditoría; core.aplicaciones no)
SELECT created_at AT TIME ZONE 'America/Bogota' AS fecha_bogota,
       accion, campos_cambiados,
       datos_antes  ->> 'aplicacion_codigo' AS app,
       datos_antes  ->> 'activo'            AS activo_antes,
       datos_despues ->> 'activo'           AS activo_despues,
       usuario_id
FROM core.auditoria
WHERE esquema = 'core' AND tabla = 'accesos'
  AND created_at > now() - interval '15 days'
ORDER BY created_at DESC;

-- 1d. ¿Los datos de pasillos siguen ahí?  (si da > 0, NO hace falta backup)
SELECT (SELECT count(*) FROM inventario.pasillos)                              AS pasillos_catalogo,
       (SELECT count(*) FROM inventario.pasillos WHERE activo)                 AS pasillos_activos,
       (SELECT count(*) FROM inventario.registros_pasillo)                     AS registros_total,
       (SELECT count(*) FROM inventario.registros_pasillo WHERE anulado_at IS NULL) AS registros_vigentes,
       (SELECT max(registrado_at) AT TIME ZONE 'America/Bogota'
          FROM inventario.registros_pasillo)                                   AS ultimo_registro;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2 · RESTAURAR INVENTARIO
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- 2a. La aplicación: se recrea si la borraron y se reactiva si la apagaron.
INSERT INTO core.aplicaciones (codigo, nombre, descripcion, ruta, icono, color, orden, roles_validos)
VALUES ('INVENTARIO', 'Inventario de Pasillos', 'Registro de ocupación de posiciones por pasillo',
        '/despachos/?vista=inventario', '🗃️', '#2563EB', 20,
        ARRAY['registrador','supervisor','consulta','admin'])
ON CONFLICT (codigo) DO UPDATE SET activo = true;

-- 2b. Reactivar accesos que estaban apagados.
--     Revise la lista del PASO 1b: si alguno se apagó a propósito, excluya su email.
UPDATE core.accesos
SET activo = true
WHERE aplicacion_codigo = 'INVENTARIO' AND NOT activo;

-- 2c. Si el acceso del administrador se borró del todo, recrearlo.
--     Cambie el correo si su usuario es otro.
INSERT INTO core.accesos (perfil_id, aplicacion_codigo, rol)
SELECT p.id, 'INVENTARIO', 'admin'
FROM core.perfiles p
WHERE p.email = 'ia100demos@gmail.com'
ON CONFLICT (perfil_id, aplicacion_codigo) DO UPDATE SET activo = true;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3 · SEPARAR TARJETA DEL LAUNCHER DE ACCESO A LA APP
--   en_launcher = false → la tarjeta no sale en NexusKPI, pero el permiso sigue
--   vivo y la pestaña "Pasillos" sigue en el Portal de Despachos.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE core.aplicaciones
  ADD COLUMN IF NOT EXISTS en_launcher boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN core.aplicaciones.en_launcher IS
  'true = se muestra como tarjeta en el launcher de NexusKPI. NO controla el acceso; el acceso es "activo".';

-- Lo que se pidió en KPI: quitar la TARJETA de Inventario (no la aplicación).
UPDATE core.aplicaciones SET en_launcher = false WHERE codigo = 'INVENTARIO';

-- La función agrega la columna en_launcher al resultado. Cambia la forma de la
-- salida, así que hay que hacer DROP + CREATE + GRANT.
-- El Portal de Despachos solo lee codigo y rol: no se afecta.
DROP FUNCTION IF EXISTS core.fn_mis_aplicaciones();
CREATE FUNCTION core.fn_mis_aplicaciones()
RETURNS TABLE (codigo text, nombre text, descripcion text, ruta text,
               icono text, color text, rol text, en_launcher boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ap.codigo, ap.nombre, ap.descripcion, ap.ruta, ap.icono, ap.color, ac.rol, ap.en_launcher
  FROM core.accesos ac
  JOIN core.aplicaciones ap ON ap.codigo = ac.aplicacion_codigo
  JOIN core.perfiles pf     ON pf.id = ac.perfil_id
  WHERE ac.perfil_id = auth.uid() AND ac.activo AND ap.activo AND pf.activo
  ORDER BY ap.orden
$$;
REVOKE EXECUTE ON FUNCTION core.fn_mis_aplicaciones() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION core.fn_mis_aplicaciones() TO authenticated;

COMMIT;

-- Recargar la caché de la API de Supabase para que vea la nueva firma.
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- CAMBIO PENDIENTE EN NexusKPI (1 línea, en el launcher que pinta las tarjetas):
--   donde hoy recorre el resultado de rpc('fn_mis_aplicaciones'), filtrar:
--       apps.filter(a => a.en_launcher !== false)
--   Mientras no se haga, la tarjeta de Inventario volverá a aparecer en KPI
--   (es preferible a perder la funcionalidad).
--
-- VERIFICACIÓN FINAL
--   1. Salir y volver a entrar al Portal (la sesión cachea los roles).
--   2. El encabezado debe decir "Desp.: admin · Inv.: admin".
--   3. Debe aparecer la pestaña "Pasillos" con el historial anterior.
-- =============================================================================


-- █████████████████████████████████████████████████████████████████████████████
-- ██ BLOQUE 034 · 034_manual_observacion_rechazo_cliente.sql
-- █████████████████████████████████████████████████████████████████████████████
-- =============================================================================
-- 034_manual_observacion_rechazo_cliente.sql
-- Plataforma L&S · Portal de Despachos · 06-nov-2026
-- Requerimientos "7_Mejoras_Nov_04_2026"
--
-- QUÉ HACE
--  1. Alerta de inventario (consentimiento) también para el REGISTRO MANUAL
--     (origen MANUAL en despachos.consentimientos y en fn_registrar_consentimiento).
--  2. Nuevo flujo de revisión de clientes (core.destinatarios):
--       · RECHAZAR  → el cliente queda ACTIVO con estado RECHAZADO y con los
--                     campos que se deben corregir (campos_corregir). Quien
--                     radique con ese NIT ve la nota y corrige los campos; el
--                     cliente vuelve a PENDIENTE y puede radicar de inmediato.
--       · INACTIVAR → botón nuevo: el cliente queda inactivo (deja de salir).
--       · APROBAR   → también desde RECHAZADO (el supervisor lo corrige él mismo).
--     despachos.fn_revisar_cliente(id, accion, nota, campos)   (cambia la firma)
--     despachos.fn_corregir_cliente_rechazado(nit, …)          (nueva)
--  3. Clientes rechazados con el flujo anterior (inactivos) pasan a RECHAZADO
--     ACTIVO para que entren al flujo nuevo.
--  4. La lupa (fn_buscar_clientes_parecidos) muestra también los rechazados.
--  5. Candado en la base: no se radica una línea con un cliente RECHAZADO.
--  6. Observación general del pedido: ya existía despachos.solicitudes.observaciones
--     (parámetro p_observaciones de fn_crear_solicitud). Ahora también queda en
--     la traza (comentario del evento RADICADA) y en las vistas.
--
-- SEGURIDAD DE EJECUCIÓN
--  · statement_timeout 30 s y lock_timeout 5 s. Idempotente.
--  · El UPDATE del punto 3 solo toca clientes RECHAZADO inactivos (pocos).
--
-- CÓMO EJECUTAR
--  Supabase → kpi-logistics → SQL Editor → pegar TODO → Run.
--  Requiere 017 a 033. Publicar la versión nueva del portal JUSTO después:
--  fn_revisar_cliente cambia de firma (la versión anterior de la pantalla
--  Clientes ya no podrá aprobar/rechazar).
-- =============================================================================
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Consentimiento también para el registro MANUAL
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE despachos.consentimientos DROP CONSTRAINT IF EXISTS ck_consentimientos_origen;
ALTER TABLE despachos.consentimientos ADD  CONSTRAINT ck_consentimientos_origen
  CHECK (origen IN ('EXCEL', 'PDF', 'MANUAL'));

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
  IF p_origen IS NULL OR p_origen NOT IN ('EXCEL', 'PDF', 'MANUAL') THEN
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
REVOKE ALL ON FUNCTION despachos.fn_registrar_consentimiento(smallint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_registrar_consentimiento(smallint, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rechazados del flujo anterior (quedaron inactivos) → RECHAZADO activo
-- ─────────────────────────────────────────────────────────────────────────────
--    Solo la PRIMERA vez que se ejecuta el script (antes de existir campos_corregir):
--    si se vuelve a correr, no reactiva clientes inactivados con el botón nuevo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'core' AND table_name = 'destinatarios' AND column_name = 'campos_corregir') THEN
    UPDATE core.destinatarios d SET activo = true
    WHERE d.estado_revision = 'RECHAZADO' AND NOT d.activo;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Columnas del flujo de rechazo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS campos_corregir      text[];
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS corregido_at         timestamptz;
ALTER TABLE core.destinatarios ADD COLUMN IF NOT EXISTS corregido_por_nombre text;

COMMENT ON COLUMN core.destinatarios.estado_revision IS
  'PENDIENTE = creado o corregido en Despachos, falta revisión del supervisor · APROBADO · RECHAZADO = activo, el solicitante debe corregir los campos_corregir (si además está inactivo: se inactivó desde la revisión)';
COMMENT ON COLUMN core.destinatarios.campos_corregir IS
  'Campos que el supervisor marcó al rechazar: NOMBRE, DIRECCION, TELEFONO, CIUDAD, DEPARTAMENTO';
COMMENT ON COLUMN core.destinatarios.corregido_at IS 'Última corrección hecha por el solicitante después de un rechazo';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Revisión del supervisor: APROBAR | RECHAZAR | INACTIVAR
--    (reemplaza fn_revisar_cliente(id, aprobar boolean, nota))
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS despachos.fn_revisar_cliente(bigint, boolean, text);

CREATE OR REPLACE FUNCTION despachos.fn_revisar_cliente(
  p_id bigint, p_accion text, p_nota text, p_campos text[] DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_accion text := upper(trim(COALESCE(p_accion, '')));
  v_estado text;
  v_campos text[];
BEGIN
  PERFORM despachos.fn_exigir_supervisor();
  IF v_accion NOT IN ('APROBAR', 'RECHAZAR', 'INACTIVAR') THEN
    RAISE EXCEPTION 'CORE116: acción de revisión inválida (%)', p_accion USING ERRCODE = 'check_violation';
  END IF;
  IF NULLIF(trim(COALESCE(p_nota, '')), '') IS NULL THEN
    RAISE EXCEPTION 'CORE113: escriba la nota de la revisión' USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.estado_revision INTO v_estado FROM core.destinatarios d WHERE d.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE111: el cliente ya no existe' USING ERRCODE = 'no_data_found'; END IF;

  IF v_accion = 'RECHAZAR' THEN
    IF v_estado <> 'PENDIENTE' THEN
      RAISE EXCEPTION 'CORE114: solo se rechaza un cliente pendiente de revisión (está %)', v_estado USING ERRCODE = 'check_violation';
    END IF;
    SELECT array_agg(DISTINCT upper(trim(x))) INTO v_campos
    FROM unnest(COALESCE(p_campos, ARRAY[]::text[])) AS x
    WHERE upper(trim(x)) IN ('NOMBRE', 'DIRECCION', 'TELEFONO', 'CIUDAD', 'DEPARTAMENTO');
    IF v_campos IS NULL THEN
      RAISE EXCEPTION 'CORE117: marque al menos un campo que el solicitante debe corregir' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_estado NOT IN ('PENDIENTE', 'RECHAZADO') THEN
    RAISE EXCEPTION 'CORE114: este cliente ya fue revisado (%)', v_estado USING ERRCODE = 'check_violation';
  END IF;

  UPDATE core.destinatarios d SET
    estado_revision     = CASE v_accion WHEN 'APROBAR' THEN 'APROBADO' ELSE 'RECHAZADO' END,
    activo              = (v_accion <> 'INACTIVAR'),
    campos_corregir     = CASE WHEN v_accion = 'RECHAZAR' THEN v_campos ELSE NULL END,
    revisado_at         = now(),
    revisado_by         = auth.uid(),
    revisado_por_nombre = core.fn_mi_nombre(),
    nota_revision       = trim(p_nota)
  WHERE d.id = p_id;
  RETURN CASE v_accion WHEN 'APROBAR' THEN 'APROBADO' WHEN 'RECHAZAR' THEN 'RECHAZADO' ELSE 'INACTIVO' END;
END;
$$;
COMMENT ON FUNCTION despachos.fn_revisar_cliente(bigint, text, text, text[]) IS
  'Supervisor: APROBAR (desde PENDIENTE o RECHAZADO) · RECHAZAR (queda activo, con campos a corregir) · INACTIVAR (queda inactivo). Nota obligatoria.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Corrección del solicitante sobre un cliente RECHAZADO → vuelve a PENDIENTE
--    Solo cambia los campos marcados (si no hay marcados, los que envíe; al
--    menos uno debe cambiar). Ciudad y departamento van juntos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_corregir_cliente_rechazado(
  p_nit text, p_nombre text DEFAULT NULL, p_direccion text DEFAULT NULL, p_telefono text DEFAULT NULL,
  p_ciudad text DEFAULT NULL, p_departamento text DEFAULT NULL)
RETURNS TABLE (id bigint, nit text, nombre text, direccion text, ciudad text, departamento text,
               telefono text, estado_revision text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nit    text := core.fn_nit_limpio(p_nit);
  v_cuenta bigint := core.fn_mi_cuenta();
  v_d      record;
  v_campos text[];
  v_todos  boolean;
  n_nombre text; n_dir text; n_tel text; n_ciu text; n_dep text;
  v_falta  text[] := ARRAY[]::text[];
  v_igual  text[] := ARRAY[]::text[];
BEGIN
  IF NOT core.fn_tiene_rol('DESPACHOS', ARRAY['solicitante', 'operador', 'admin']) THEN
    RAISE EXCEPTION 'CORE102: no tiene permiso para corregir clientes' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT d.* INTO v_d FROM core.destinatarios d
  WHERE core.fn_nit_limpio(d.nit) = v_nit AND d.cuenta_id IS NOT DISTINCT FROM v_cuenta
  ORDER BY d.activo DESC LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORE111: el cliente ya no existe' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT v_d.activo THEN
    RAISE EXCEPTION 'CORE118: el cliente % está inactivo: pida al supervisor reactivarlo', v_d.nombre USING ERRCODE = 'check_violation';
  END IF;
  IF v_d.estado_revision <> 'RECHAZADO' THEN
    RAISE EXCEPTION 'CORE119: el cliente % no está rechazado (%): no requiere corrección', v_d.nombre, v_d.estado_revision USING ERRCODE = 'check_violation';
  END IF;

  v_campos := COALESCE(v_d.campos_corregir, ARRAY[]::text[]);
  v_todos  := cardinality(v_campos) = 0;
  -- Ciudad y departamento se corrigen juntos
  IF 'CIUDAD' = ANY(v_campos) OR 'DEPARTAMENTO' = ANY(v_campos) THEN v_campos := v_campos || ARRAY['CIUDAD', 'DEPARTAMENTO']; END IF;

  n_nombre := CASE WHEN v_todos OR 'NOMBRE' = ANY(v_campos)
                   THEN NULLIF(upper(trim(regexp_replace(COALESCE(p_nombre, ''), '\s+', ' ', 'g'))), '') ELSE v_d.nombre END;
  n_dir    := CASE WHEN v_todos OR 'DIRECCION' = ANY(v_campos) THEN NULLIF(upper(trim(p_direccion)), '') ELSE v_d.direccion END;
  n_tel    := CASE WHEN v_todos OR 'TELEFONO' = ANY(v_campos)
                   THEN NULLIF(regexp_replace(COALESCE(p_telefono, ''), '[^0-9+]', '', 'g'), '') ELSE v_d.telefono END;
  n_ciu    := CASE WHEN v_todos OR 'CIUDAD' = ANY(v_campos) THEN NULLIF(upper(trim(p_ciudad)), '') ELSE v_d.ciudad END;
  n_dep    := CASE WHEN v_todos OR 'DEPARTAMENTO' = ANY(v_campos)
                   THEN COALESCE(NULLIF(trim(p_departamento), ''), core.fn_departamento_de_ciudad(p_ciudad)) ELSE v_d.departamento END;

  IF n_nombre IS NULL THEN v_falta := array_append(v_falta, 'nombre'); END IF;
  IF n_dir    IS NULL THEN v_falta := array_append(v_falta, 'dirección'); END IF;
  IF n_tel    IS NULL THEN v_falta := array_append(v_falta, 'teléfono'); END IF;
  IF n_ciu    IS NULL THEN v_falta := array_append(v_falta, 'ciudad'); END IF;
  IF n_dep    IS NULL THEN v_falta := array_append(v_falta, 'departamento'); END IF;
  IF cardinality(v_falta) > 0 THEN
    RAISE EXCEPTION 'CORE120: complete %', array_to_string(v_falta, ', ') USING ERRCODE = 'check_violation';
  END IF;

  -- Cada campo marcado debe cambiar (no basta con volver a guardar lo mismo)
  IF NOT v_todos THEN
    IF 'NOMBRE'    = ANY(v_d.campos_corregir) AND n_nombre IS NOT DISTINCT FROM v_d.nombre    THEN v_igual := array_append(v_igual, 'nombre'); END IF;
    IF 'DIRECCION' = ANY(v_d.campos_corregir) AND n_dir    IS NOT DISTINCT FROM v_d.direccion THEN v_igual := array_append(v_igual, 'dirección'); END IF;
    IF 'TELEFONO'  = ANY(v_d.campos_corregir) AND n_tel    IS NOT DISTINCT FROM v_d.telefono  THEN v_igual := array_append(v_igual, 'teléfono'); END IF;
    IF ('CIUDAD' = ANY(v_d.campos_corregir) OR 'DEPARTAMENTO' = ANY(v_d.campos_corregir))
       AND n_ciu IS NOT DISTINCT FROM v_d.ciudad AND n_dep IS NOT DISTINCT FROM v_d.departamento THEN v_igual := array_append(v_igual, 'ciudad/departamento'); END IF;
    IF cardinality(v_igual) > 0 THEN
      RAISE EXCEPTION 'CORE121: debe corregir % (quedó igual al dato rechazado)', array_to_string(v_igual, ', ') USING ERRCODE = 'check_violation';
    END IF;
  ELSIF n_nombre IS NOT DISTINCT FROM v_d.nombre AND n_dir IS NOT DISTINCT FROM v_d.direccion
        AND n_tel IS NOT DISTINCT FROM v_d.telefono AND n_ciu IS NOT DISTINCT FROM v_d.ciudad
        AND n_dep IS NOT DISTINCT FROM v_d.departamento THEN
    RAISE EXCEPTION 'CORE121: no cambió ningún dato: corrija lo que indica la nota de la revisión' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE core.destinatarios d SET
    nombre = n_nombre, direccion = n_dir, telefono = n_tel, ciudad = n_ciu, departamento = n_dep,
    estado_revision = 'PENDIENTE', campos_corregir = NULL,
    corregido_at = now(), corregido_por_nombre = core.fn_mi_nombre()
  WHERE d.id = v_d.id;

  RETURN QUERY
    SELECT d.id, d.nit, d.nombre, d.direccion, d.ciudad, d.departamento, d.telefono, d.estado_revision
    FROM core.destinatarios d WHERE d.id = v_d.id;
END;
$$;
COMMENT ON FUNCTION despachos.fn_corregir_cliente_rechazado(text, text, text, text, text, text) IS
  'Solicitante: corrige los campos marcados de un cliente RECHAZADO; vuelve a PENDIENTE de revisión y se puede radicar.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Lupa: también muestra los RECHAZADOS activos (para avisar y corregir)
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
    WHERE d.activo
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

REVOKE ALL ON FUNCTION despachos.fn_revisar_cliente(bigint, text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION despachos.fn_corregir_cliente_rechazado(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION despachos.fn_revisar_cliente(bigint, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION despachos.fn_corregir_cliente_rechazado(text, text, text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Candado: no se radica una línea con un cliente RECHAZADO (activo)
--    Aplica a los 3 modos (manual, Excel, PDF) aunque la pantalla falle.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_tg_linea_cliente_rechazado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nombre text;
  v_nota   text;
BEGIN
  SELECT d.nombre, d.nota_revision INTO v_nombre, v_nota
  FROM core.destinatarios d
  JOIN despachos.solicitudes s ON s.id = NEW.solicitud_id
  WHERE core.fn_nit_limpio(d.nit) = core.fn_nit_limpio(NEW.destinatario_nit)
    AND d.cuenta_id IS NOT DISTINCT FROM s.cuenta_id
    AND d.activo AND d.estado_revision = 'RECHAZADO'
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'DSP030: el cliente % (NIT %) fue rechazado por el supervisor: %. Corrija los datos del cliente antes de radicar.',
      v_nombre, NEW.destinatario_nit, COALESCE(v_nota, 'sin nota') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tg_linea_cliente_rechazado ON despachos.solicitud_lineas;
CREATE TRIGGER tg_linea_cliente_rechazado
  BEFORE INSERT ON despachos.solicitud_lineas
  FOR EACH ROW EXECUTE FUNCTION despachos.fn_tg_linea_cliente_rechazado();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Observación general en la traza: comentario del evento RADICADA
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION despachos.fn_tg_evento_observacion_general()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_obs text;
BEGIN
  IF NEW.estado_nuevo = 'RADICADA' AND NEW.estado_anterior IS NULL THEN
    SELECT NULLIF(trim(s.observaciones), '') INTO v_obs FROM despachos.solicitudes s WHERE s.id = NEW.solicitud_id;
    IF v_obs IS NOT NULL THEN
      NEW.comentario := COALESCE(NEW.comentario || ' · ', '') || 'Observación general: ' || v_obs;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tg_evento_observacion_general ON despachos.solicitud_eventos;
CREATE TRIGGER tg_evento_observacion_general
  BEFORE INSERT ON despachos.solicitud_eventos
  FOR EACH ROW EXECUTE FUNCTION despachos.fn_tg_evento_observacion_general();

COMMENT ON COLUMN despachos.solicitudes.observaciones IS
  'Observación general del pedido (popup antes de radicar en manual, Excel y PDF). Vacía = «Sin observaciones».';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Vistas: + observacion_general (columna nueva AL FINAL; el resto igual al 032)
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
       c.aceptado_at AS consentimiento_at, c.version AS consentimiento_version,
       s.observaciones AS observacion_general
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
       c.aceptado_at AS consentimiento_at, c.version AS consentimiento_version,
       s.observaciones AS observacion_general
FROM despachos.solicitud_lineas li
JOIN despachos.solicitudes s ON s.id = li.solicitud_id
JOIN despachos.estados e     ON e.codigo = s.estado_codigo
LEFT JOIN despachos.lotes lt ON lt.id = s.lote_id
LEFT JOIN despachos.consentimientos c ON c.solicitud_id = s.id;

GRANT SELECT ON despachos.vw_solicitudes, despachos.vw_solicitud_lineas TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (opcional, solo lectura)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT estado_revision, activo, count(*) FROM core.destinatarios GROUP BY 1, 2 ORDER BY 1, 2;
-- SELECT nit, nombre, nota_revision, campos_corregir FROM core.destinatarios WHERE estado_revision = 'RECHAZADO';

-- Fin de PORTAL_DESPACHOS_BD_v01.sql
RESET statement_timeout;
RESET lock_timeout;
