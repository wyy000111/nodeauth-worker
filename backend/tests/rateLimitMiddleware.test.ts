import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { rateLimit, resetRateLimit } from '@/shared/middleware/rateLimitMiddleware';
import { AppError } from '@/app/config';

describe('RateLimit Middleware - TDD Logic', () => {
    let app: Hono<any>;
    let mockDb: any;
    const WINDOW_MS = 1000;
    const MAX_ATTEMPTS = 2;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // 模拟 D1 数据库
        mockDb = {
            prepare: vi.fn().mockReturnThis(),
            bind: vi.fn().mockReturnThis(),
            first: vi.fn(),
            run: vi.fn().mockResolvedValue({ success: true })
        };

        app = new Hono();

        // 关键：将 AppError 映射为对应的 HTTP 状态码
        app.onError((err, c) => {
            if (err instanceof AppError) return c.text(err.message, err.statusCode as any);
            return c.text(err.message, 500);
        });

        app.use('/test', rateLimit({ windowMs: WINDOW_MS, max: MAX_ATTEMPTS }));
        app.get('/test', (c) => c.text('OK'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // 🔴 预期红灯：验证基础录入和阻塞
    it('should allow requests up to max, then block the next one', async () => {
        // 模拟数据库中最初没有任何记录
        mockDb.first.mockResolvedValueOnce(null).mockResolvedValueOnce({ attempts: 1, last_attempt: Date.now() });

        // 第1次请求: Success
        const res1 = await app.request('/test', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }, { DB: mockDb } as any);
        expect(res1.status).toBe(200);

        // 第2次请求: Success (达到上限，会更新 expires_at)
        const res2 = await app.request('/test', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }, { DB: mockDb } as any);
        expect(res2.status).toBe(200);

        // 第3次请求: 🔴 应该抛出 429
        // 我们模拟数据库返回已过期的记录 (expires_at 在未来)
        mockDb.first.mockResolvedValueOnce({
            attempts: 2,
            last_attempt: Date.now(),
            expires_at: Date.now() + 500
        });

        // 注意：中间件内如果抛出 AppError，Hono 会将其交给处理逻辑或直接报错
        // 在 app.request 模拟中，如果未捕获会显示为错误
        const res3 = await app.request('/test', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }, { DB: mockDb } as any);
        expect(res3.status).toBe(429);
    });

    // 🔴 预期红灯：验证窗口重置
    it('should reset attempts after window period', async () => {
        const now = Date.now();
        // 模拟数据库存在一个很久以前的记录
        mockDb.first.mockResolvedValueOnce({ attempts: 2, last_attempt: now - 5000 });

        const res = await app.request('/test', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }, { DB: mockDb } as any);

        expect(res.status).toBe(200);
        // 应该触发了更新记录为 1 次的 SQL
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE rate_limits SET attempts = 1'));
    });

    // 🔴 预期红灯：验证手动重置
    it('should allow immediate request after resetRateLimit', async () => {
        const c = { env: { DB: mockDb } } as any;
        await resetRateLimit(c, 'rl:1.1.1.1:/test');

        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM rate_limits'));
    });
});
