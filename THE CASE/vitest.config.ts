import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Юнит-тесты витрины (адаптеры/клиент Admik). Pure TS — без next-плагина.
// Alias `@` → ./src повторяет tsconfig paths.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
