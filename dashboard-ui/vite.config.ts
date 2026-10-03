import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The API only allows this origin (CORS_ORIGIN), so fail instead of picking another port.
  server: { port: 5173, strictPort: true },
});
