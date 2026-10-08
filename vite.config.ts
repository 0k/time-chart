import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", env: { TZ: "Europe/Paris" }, maxWorkers: 1, minWorkers: 1 },
});
