import { test, expect } from '@playwright/test';

/**
 * Vault Core Operations - E2E Audit (Bypassing Auth via Mocking)
 */
test.describe('Vault Management (Mobile)', () => {

    test.beforeEach(async ({ page }) => {
        // 0. 强力清除 Service Worker 并禁用
        await page.addInitScript(() => {
            if (navigator.serviceWorker) {
                navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
                Object.defineProperty(navigator, 'serviceWorker', { get: () => ({ register: () => new Promise(() => { }), getRegistrations: () => Promise.resolve([]) }) });
            }
        });

        // 1. 全域拦截器
        const mockHandler = async route => {
            const url = route.request().url();
            console.log(`[Interceptor-Seen] ${url}`);

            if (url.includes('/api/oauth/me')) {
                console.log(`[Mock-Fulfill] /api/oauth/me`);
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        userInfo: { id: '1', email: 'architect@nodeauth.nom.za', name: 'Architect' },
                        needsEmergency: false
                    }),
                });
            }

            if (url.includes('/api/vault')) {
                console.log(`[Mock-Fulfill] /api/vault`);
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        vault: [
                            { id: '1', service: 'Github', account: 'nodeauth', secret: 'JBSWY3DP', digits: 6, algorithm: 'SHA1' },
                            { id: '2', service: 'Google', account: 'architect@google.com', secret: 'KRSXG5AK', digits: 6, algorithm: 'SHA1' }
                        ],
                        pagination: { totalPages: 1, totalItems: 2, page: 1 },
                        categoryStats: [{ category: '', count: 2 }]
                    }),
                });
            }

            if (url.includes('/api/oauth/providers')) {
                console.log(`[Mock-Fulfill] /api/oauth/providers`);
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ success: true, providers: [] })
                });
            }

            return route.continue();
        };

        await page.context().route('**', mockHandler);
        await page.route('**', mockHandler);



        // 监听控制台
        page.on('console', msg => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));

        // 3. 注入模拟登录态到 IndexedDB
        await page.addInitScript(() => {
            const DB_NAME = 'NodeAuthDB';
            const STORE_NAME = 'app_key_store';
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const st = tx.objectStore(STORE_NAME);
                st.put({ id: '1', email: 'architect@nodeauth.nom.za', name: 'Architect' }, 'auth:user:profile');
                st.put('test-device-salt-architect', 'sys:sec:device_salt');
            };
        });

        // 4. 进入首页
        await page.goto('/');

        // 5. 调试工具：打印所有本地存储信息，确认注入是否成功
        await page.evaluate(() => {
            console.log('[Audit-Client] Page loaded, current path:', window.location.pathname);
            const DB_NAME = 'NodeAuthDB';
            const request = indexedDB.open(DB_NAME, 1);
            request.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('app_key_store', 'readonly');
                const st = tx.objectStore('app_key_store');
                st.get('auth:user:profile').onsuccess = (ev) => console.log('[Audit-Client] IDB Profile:', ev.target.result);
                st.get('sys:sec:device_salt').onsuccess = (ev) => console.log('[Audit-Client] IDB Salt:', ev.target.result);
            };
        });
    });

    /**
     * Case 01: 手动增加项目 (Manual Add)
     */
    test('Audit: Manual account addition flow', async ({ page }) => {
        // 等待列表渲染 (如果不通过 E2E，这里会超时并提供报错上下文)
        await page.waitForSelector('.vault-card', { timeout: 30000 });

        // 点击右上方新增按钮
        const addBtn = page.locator('button.el-button--primary').first();
        await addBtn.click();

        // 验证 ResponsiveOverlay 弹出
        const manualOption = page.locator('text=手动输入');
        await expect(manualOption).toBeVisible();
        await manualOption.click();

        // 填写表单
        await page.fill('input[placeholder*="名称"]', 'ArchitectSafe');
        await page.fill('input[placeholder*="账号"]', 'admin@nodeauth.nom.za');
        await page.fill('input[placeholder*="密钥"]', 'ABC');

        // 保存动作
        await page.click('button:has-text("保存")');

        // 验证 Toast 是否弹出
        const toast = page.locator('.el-message');
        await expect(toast).toBeVisible();
    });

    /**
     * Case 02: 验证 Toast 距离底部的像素距离 (90px Audit)
     * 目标：通过自动化手段固化您的 UI 布局标准
     */
    test('Audit: Copy Toast position logic', async ({ page }) => {
        // 等待列表渲染
        await page.waitForSelector('.vault-card', { timeout: 30000 });

        // 点击第一个卡片触发复制
        await page.locator('.vault-card:has-text("Github")').click();

        const toast = page.locator('.el-message');
        await expect(toast).toBeVisible();

        // 视觉审计：计算位置
        const box = await toast.boundingBox();
        const viewport = page.viewportSize();
        if (box && viewport) {
            const distanceFromBottom = viewport.height - (box.y + box.height);
            console.log(`\n[Architect Audit] Toast bottom gap: ${distanceFromBottom}px`);
            // 预期：应接近我们设置的 90px (考虑 env(safe-area-inset-bottom) 在模拟器中可能为 0)
            expect(distanceFromBottom).toBeGreaterThanOrEqual(88);
        }

        // 核心锁定：视觉回归快照
        // 这一步不仅检查位置，还检查边框、背景模糊及阴影
        await expect(toast).toHaveScreenshot('copy-toast-ios.png', {
            maxDiffPixelRatio: 0.01
        });
    });

});
