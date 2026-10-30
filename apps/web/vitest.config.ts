import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("../../migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, APP_SECRET: "test-secret-0123456789abcdef0123456789abcdef", PLATFORM_ADMINS: "admin@example.com", PLATFORM_XENDIT_CALLBACK_TOKEN: "platform-callback-token", FEATURES: "email,apple,courier,domains,qris,wa_cloud,platform_gateway" },
          assets: { directory: "./worker/test/fixtures", binding: "ASSETS" },
        },
      }),
    ],
    test: {
      include: ["worker/**/*.test.ts"],
      setupFiles: ["./worker/test/setup.ts"],
    },
  };
});
