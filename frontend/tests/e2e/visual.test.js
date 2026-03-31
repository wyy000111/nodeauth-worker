import { test, expect } from '@playwright/test';

/**
 * 视觉回归契约：扁平化设计标准审计 (Visual Audit: Flattened Design)
 * 
 * 核心目标：
 * 防止数据导入/导出分组中的“框框”回退，验证 Safe Area 的视觉间距一致性。
 */
test.describe('Mobile Visual Consistency Audit', () => {

    test.beforeEach(async ({ page }) => {
        // 1. 进入本地预览页 (Vite Dev Server)
        await page.goto('/');

        // 2. 模拟用户已登录/数据初始化 (可通过 localStorage Mock 或跳过认证，此处采用简单 goto)
        // 注意：生产环境需要适配真正的 Auth 拦截，此原型假设页面可达。
    });

    /**
     * Case 01: 数据导出页面像素对比 (Migration UI Audit)
     * 目标：验证 2.0.x 版本后实行的“去边框设计”是否合规。
     */
    test('Audit: Data Export page should maintain flattened hierarchy', async ({ page }) => {
        // 跳转至迁移页
        await page.goto('/#/migration');

        // 等待内容渲染 (特别是 Vue 动画结束后生效)
        await page.waitForTimeout(1000);

        // 核心动作：像素比对！
        // 预期提示：第一次运行会失败并生成黄金基准图，第二次运行若边框回来将引发告警。
        await expect(page).toHaveScreenshot('audit-migration-groups.png', {
            fullPage: true,
            mask: [page.locator('.version-text')] // 屏蔽版本号，防止每次版本发布都引发视觉不匹配
        });
    });

    /**
     * Case 02: 首页卡片流稳定性 (Vault Home Audit)
     * 目标：验证主界面的 15px 间距与 60fps 后的布局抖动。
     */
    test('Audit: Vault list grid gap consistency', async ({ page }) => {
        await page.goto('/#');
        await page.waitForSelector('.vault-list');

        // 定位并截图特定区块
        const vaultList = page.locator('.vault-list');
        await expect(vaultList).toHaveScreenshot('audit-vault-grid.png');
    });

});
