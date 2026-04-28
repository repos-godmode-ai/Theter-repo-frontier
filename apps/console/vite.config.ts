import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = (process.env.VITE_BASE_PATH || "/").replace(/\/?$/, "/");

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    allowedHosts: true,
  },
});
