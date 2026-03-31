import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 视觉回归测试 (Visual Regression) 全局配置
 * 
 * 核心目标：
 * 模拟 iOS/Android 端真实渲染环境，验证 Safe Area 及 扁平化 UI 视觉标准。
 */
export default defineConfig({
    testDir: './tests/e2e',
    /* 每一个测试文件的超时时间 (30s) */
    timeout: 30 * 1000,
    expect: {
        /** 像素级对比的容错率 (0.01 = 1% 像素差异) */
        toMatchSnapshot: { maxDiffPixelRatio: 0.01 },
    },
    /* 强制单线程执行以获得更稳定的截图环境 */
    fullyParallel: false,
    reporter: 'html',
    use: {
        /* Vite 开发服务器地址 */
        baseURL: 'http://localhost:5173',
        /* 出错时才开启追踪 */
        trace: 'on-first-retry',
        /* 所有的截图默认隐藏滚动条 */
        screenshot: 'on',
    },

    /* 核心环境模拟：iOS Safari */
    projects: [
        {
            name: 'Mobile Safari (iOS)',
            use: {
                ...devices['iPhone 13'],
                /* 针对 PWA 适配：开启深色模式模拟 */
                colorScheme: 'dark',
            },
        },
    ],

    /* 运行测试前自动启动 Vite 开发服务器 */
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
    },
});
