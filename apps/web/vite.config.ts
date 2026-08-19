import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The bundle carries the environment it signs in against. A missing value has to stop the build
// here — the alternative is a bundle that reaches no user pool and only says so once someone
// opens it. Set them in apps/web/.env.local or in the shell; see .env.example.
const REQUIRED_ENV = ["VITE_USER_POOL_ID", "VITE_USER_POOL_CLIENT_ID", "VITE_SIGN_IN_DOMAIN"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing build config: ${missing.join(", ")}. See apps/web/.env.example.`);
  }

  return {
    plugins: [react(), tailwind()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: { port: 3000 },
  };
});
