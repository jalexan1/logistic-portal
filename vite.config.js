import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// La app se publica bajo /despachos/ para convivir con NexusKPI en el MISMO
// dominio (sesión compartida = un solo login). El build queda en
// dist/despachos/ para que el despliegue propio (logistic-portal.vercel.app)
// también sirva /despachos/... sin reglas adicionales.
export default defineConfig({
  plugins: [react()],
  base: '/despachos/',
  build: { outDir: 'dist/despachos', emptyOutDir: true },
})
