import { Hono } from 'hono';
import { EnvBindings } from '@/app/config';
import { runHealthCheck } from '@/shared/utils/health';

const health = new Hono<{ Bindings: EnvBindings }>();

// GET /api/health/health-check
// 专门用于系统前端的启动体检
health.get('/health-check', (c) => {
    // 强制不缓存此接口
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');

    const result = runHealthCheck(c.env);

    return c.json({
        success: true,
        ...result
    });
});

export default health;
