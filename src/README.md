# Portal de Despachos — Logistic and Service

## Pasos para correr el proyecto (Windows)

### 1. Instalar Node.js (una sola vez)
Descarga e instala desde: https://nodejs.org (versión LTS)

### 2. Crear el proyecto
Abre PowerShell en la carpeta donde quieres el proyecto y ejecuta:

```powershell
npm create vite@latest logistic-portal -- --template react
cd logistic-portal
npm install
npm install xlsx
```

### 3. Reemplazar archivos
- Copia `App.jsx` → `logistic-portal/src/App.jsx`
- Copia `index.css` → `logistic-portal/src/index.css`

### 4. Correr en local
```powershell
npm run dev
```
Abre http://localhost:5173 en tu navegador.

### 5. Deploy gratis en Vercel
```powershell
npm install -g vercel
npm run build
vercel --prod
```
- Crea cuenta gratis en vercel.com (con GitHub)
- Vercel te da una URL pública tipo: https://logistic-portal.vercel.app
- Comparte esa URL con la empresa proveedora

## Columnas del Excel generado
| Columna | Campo |
|---|---|
| A | Entrega |
| B | Destinatario |
| C | Nombre destinatario de mercancías |
| D | Lugar-destinatario |
| E | Material |
| F | Cantidad entrega |
| G | UM |
| H | Ítem |
| I | Bodega |

## Funcionalidades
- Agregar / eliminar / duplicar filas
- Validación de campos requeridos (Entrega, Destinatario, Material, Cantidad)
- Descarga directa como .xlsx con nombre automático: despacho_[empresa]_[fecha].xlsx
- Metadatos del envío: empresa, fecha, referencia, responsable
- 100% local, sin backend, sin base de datos

## Próximos pasos opcionales
- Agregar envío automático por email (EmailJS - gratis)
- Historial de envíos en localStorage
- Parser automático de correos (Opción 1 del plan)
