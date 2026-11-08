import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// envDir points at the repo root so one .env serves contracts, relayer and web.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "..",
  base: process.env.VITE_BASE ?? "/",
  define: { global: "globalThis" },
});
