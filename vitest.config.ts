import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// One runner for both packages: the web app's own logic and the CloudFront function the edge
// stack deploys. Neither needs a browser, so there is no DOM environment here.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    include: ["apps/web/src/**/*.test.ts", "infra/lib/**/*.test.ts"],
  },
});
