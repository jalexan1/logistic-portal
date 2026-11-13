# Pendientes · Portal de Despachos (L&S)

Archivo de pendientes para revisar más adelante. No están en desarrollo.
Creado: 12-nov-2026

| # | Pendiente | Prioridad sugerida | Estado |
|---|-----------|--------------------|--------|
| 1 | Pantalla para administrar motivos | Baja | Pendiente |
| 2 | Atender los avisos de seguridad que llegan al correo (Supabase) | Alta | Pendiente |
| 3 | Sistema / agentes de revisión de seguridad de la aplicación | Media | Pendiente |

---

## 1. Pantalla para administrar motivos

**Contexto.** Desde el SQL 036 (12-nov-2026) los motivos viven en la tabla `despachos.motivos`
(código, nombre, orden, si exige datos de cliente, activo). Un motivo nuevo ya es un `INSERT`,
sin cambiar código ni SQL. Hoy ese `INSERT` se hace a mano en el SQL Editor de Supabase.

**Pendiente.**
- Pantalla en Admon → Motivos: agregar, renombrar, ordenar, activar / desactivar y marcar
  «sin datos de cliente».
- Solo rol admin. Escritura por una función (RPC) que valide: código en MAYÚSCULAS sin tildes,
  nombre no vacío, que no se desactive un motivo en uso sin confirmación.
- Mientras tanto, ejemplo por SQL:
  `INSERT INTO despachos.motivos (codigo, nombre, orden, sin_cliente) VALUES ('BOGOTA', 'Bogotá', 115, false);`

---

## 2. Avisos de seguridad que llegan al correo (Supabase)

**Contexto.** Supabase envía al correo avisos de seguridad y vulnerabilidades del proyecto
`kpi-logistics` (Security Advisor / Performance Advisor).

**Pendiente.**
- Reunir los avisos del correo y los del panel Supabase → Advisors (Security y Performance).
- Clasificarlos: crítico / alto / medio / bajo, y por objeto (tabla, vista, función, bucket).
- Revisar como mínimo:
  - Tablas sin RLS o con políticas demasiado abiertas (`USING (true)` donde no corresponde).
  - Vistas sin `security_invoker = true`.
  - Funciones `SECURITY DEFINER` sin `SET search_path = ''` o expuestas a `anon`.
  - Esquemas expuestos en Data API que no deban estarlo (`admin` debe seguir privado).
  - Permisos `GRANT` a `anon` / `authenticated` que sobren.
  - Buckets de Storage (adjuntos): políticas de lectura y escritura.
  - Auth: expiración de sesión, protección contra contraseñas filtradas, MFA para admin.
- Corregir con un script numerado y aparte (como los demás), probado antes en una base de pruebas.
- Dejar registro: aviso → causa → corrección → fecha.

---

## 3. Sistema / agentes de revisión de seguridad de la aplicación

**Objetivo.** Revisar de forma periódica y automática la seguridad del portal y de NexusKPI.

**Qué debe revisar.**
- **XSS / CSRF:** contenido que se pinta en pantalla sin escapar (observaciones, nombres de
  clientes, archivos), uso de `dangerouslySetInnerHTML`, cabeceras de seguridad
  (Content-Security-Policy, X-Frame-Options), cookies y protección de formularios.
- **Inyección SQL:** funciones con SQL dinámico (`EXECUTE`, `format` sin `%I` / `%L`), filtros
  armados con texto del usuario, búsquedas con `LIKE` / `ILIKE` sin escapar comodines.
- **Qué viaja en las peticiones (request / response):** que no aparezcan tokens, claves,
  `service_role`, contraseñas ni datos personales de más; que la llave usada en el navegador
  sea solo la `anon`; que los errores no muestren detalles internos de la base.
- **Código y dependencias:** secretos en el repositorio o en `.env` publicados, paquetes npm
  con vulnerabilidades conocidas (`npm audit`).

**Propuesta a evaluar.**
- Agentes de revisión (por ejemplo con Claude) que ejecuten un checklist sobre el código,
  las respuestas de la API y la configuración de Supabase, y entreguen un informe con hallazgos
  y prioridad.
- Ejecutarlos antes de cada publicación y en una revisión mensual programada.
- Herramientas de apoyo a evaluar: `npm audit`, OWASP ZAP (pruebas sobre la app publicada),
  Supabase Security Advisor, escáner de secretos en el repositorio.

---

*Al iniciar cualquiera de estos puntos: estimarlo con la metodología común de desarrollos de L&S.*
