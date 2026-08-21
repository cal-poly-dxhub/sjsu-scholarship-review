import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The bundle carries the environment it signs in against. A missing value has to stop the build
// here — the alternative is a bundle that reaches no user pool and only says so once someone
// opens it. Set them in apps/web/.env.local or in the shell; see .env.example.
const REQUIRED_ENV = ["VITE_USER_POOL_ID", "VITE_USER_POOL_CLIENT_ID", "VITE_SIGN_IN_DOMAIN"];

export default defineConfig(({ mode }) => {
  // Empty prefix so DEV_API_ORIGIN is readable here. Only VITE_ names reach the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing build config: ${missing.join(", ")}. See apps/web/.env.example.`);
  }

  // Deployed, one origin serves the app and the API. The dev server serves only the app, so it
  // hands /api/ to the deployed front door and the client keeps calling relative paths.
  const apiOrigin = env.DEV_API_ORIGIN;

  return {
    plugins: [react(), tailwind()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 3000,
      proxy: apiOrigin ? { "/api": { target: apiOrigin, changeOrigin: true } } : undefined,
    },
  };
});
