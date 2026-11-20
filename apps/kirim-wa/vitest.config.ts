import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    // Pairing, reconnect and event tests drive real timers through a fake socket.
    testTimeout: 30_000,
  },
});
