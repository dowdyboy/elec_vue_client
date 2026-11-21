import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: [
      'src/components/signal/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/main/**/*.test.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // 只统计被测试实际加载的纯逻辑模块；Vue 组件与 Electron 主进程服务用 E2E 覆盖
      all: false,
      include: ['src/shared/**/*.ts', 'src/components/signal/core/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'src/components/signal/core/i18n.ts',
        'src/components/signal/core/types.ts'
      ],
      // 当前基线：stmts 89.1 / branch 77.5 / funcs 88.0 / lines 89.1；阈值留少量余量防回退
      thresholds: {
        statements: 87,
        branches: 72,
        functions: 84,
        lines: 87
      }
    }
  }
})
