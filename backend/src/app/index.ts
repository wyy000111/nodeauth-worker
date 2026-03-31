import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { EnvBindings, getEffectiveCSP } from '@/app/config';
import { normalizeSecret } from '@/shared/utils/crypto';

// 稍后我们会在这里引入拆分好的路由模块
import authRoutes from '@/features/auth/authRoutes';
import vaultRoutes from '@/features/vault/vaultRoutes';
import backupRoutes from '@/features/backup/backupRoutes';
import telegramRoutes from '@/features/telegram/telegramRoutes';
import toolsRoutes from '@/features/tools/toolsRoutes';
import healthRoutes from '@/features/health/healthRoutes';
import emergencyRoutes from '@/features/emergency/emergencyRoutes';
import wcProxyRoutes from '@/features/auth/wcProxyRoutes';
import { runHealthCheck } from '@/shared/utils/health';

// 扩展 EnvBindings 以包含 ASSETS (Cloudflare Pages/Workers Assets)
type Bindings = EnvBindings & { ASSETS: { fetch: (req: Request) => Promise<Response> } };

// 初始化 Hono 应用，并绑定 Cloudflare 的环境变量类型
const app = new Hono<{ Bindings: Bindings }>();

// 1. 全局中间件
// 1.0 环境变量标准化 (支持 base64: 和 hex: 前缀)
app.use('*', async (c, next) => {
    // 自动扫描 c.env 中的所有字符串，如果带前缀则自动解码
    if (c.env) {
        for (const key in c.env) {
            if (typeof (c.env as any)[key] === 'string') {
                (c.env as any)[key] = normalizeSecret((c.env as any)[key]);
            }
        }
    }
    await next();
});

// 仅在日志级别允许时开启请求日志 (默认开启，除非显式指定为 error 或 warn)
app.use('*', async (c, next) => {
    const level = (c.env?.LOG_LEVEL || (typeof process !== 'undefined' ? process.env.LOG_LEVEL : 'info') || 'info').toLowerCase();
    if (level !== 'error' && level !== 'warn') {
        // 由于 Hono 的 logger 是一个普通的中间件，我们可以直接调用它
        return logger()(c, next);
    }
    await next();
});
app.use('/api/*', cors({
    origin: (origin) => origin, // 允许携带 Cookie 时，Origin 不能为 *，这里改为动态反射
    credentials: true, // 允许浏览器发送 Cookie
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'], // 允许自定义 CSRF 头
    allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
    maxAge: 86400,
}));

// 1.1 安全头配置 (CSP & Security Headers)
app.use('*', async (c, next) => {
    const csp = getEffectiveCSP(c.env);

    return secureHeaders({
        crossOriginOpenerPolicy: 'same-origin-allow-popups',
        xContentTypeOptions: 'nosniff',
        xFrameOptions: 'DENY',
        xXssProtection: '1; mode=block',
        referrerPolicy: 'strict-origin-when-cross-origin',
        contentSecurityPolicy: csp,
    })(c, next);
});

// 2. 健康检查接口 (用于测试后端是否正常启动)
app.get('/api', (c) => c.text('🔐 2FA Secure Manager API is running!'));

// 3. 全局安全安检拦截器 (Security Shield Middleware)
app.use('/api/*', async (c, next) => {
    // 豁免路由: 允许放行 /api/health 系列接口, 允许已登录用户强制登出
    const path = c.req.path;
    if (path.startsWith('/api/health') || path === '/api/oauth/logout') {
        await next();
        return;
    }

    // 执行安检
    const securityResult = runHealthCheck(c.env);
    if (!securityResult.passed) {
        // 发现安全环境不合格，阻断此请求
        return c.json({
            code: 403,
            success: false,
            message: 'health_check_failed',
            data: securityResult.issues
        }, 403);
    }

    await next();
});

// 4. 挂载子路由
app.route('/api/health', healthRoutes);
app.route('/api/emergency', emergencyRoutes);
app.route('/api/oauth', authRoutes);
app.route('/api/vault', vaultRoutes); // 'accounts' is now 'vault'
app.route('/api/backups', backupRoutes);
app.route('/api/telegram', telegramRoutes);
app.route('/api/tools', toolsRoutes);
app.route('/api/oauth/wc-proxy', wcProxyRoutes);

// 5. API 404 处理 (必须在静态资源 fallback 之前，确保 API 路径返回 JSON)
app.all('/api/*', (c) => {
    return c.json({ success: false, error: 'API Not Found' }, 404);
});

// 6. 静态资源托管 (让 Hono 接管所有非 API 请求，以便应用 CSP 安全头)
app.get('*', async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    // 关键修复：ASSETS 返回的 Response 可能是不可变的。创建副本以允许 Hono 中间件添加 CSP 头。
    return new Response(res.body, res);
});

// 4. 全局错误处理
app.onError((err, c) => {
    const statusCode = (err as any).statusCode || (err as any).status || 500;

    // 特殊处理: WebDAV list 接口如果返回 404，说明目录不存在，视为无备份，返回空列表
    if (c.req.path.includes('/files') && (Number(statusCode) === 404 || err.message.includes('404'))) {
        return c.json({ success: true, backups: [] });
    }

    const isAppError = (err as any).name === 'AppError';
    let message = err.message || 'Internal Server Error';

    // 如果是非预料中的 500 错误，隐藏详细信息以防泄露系统详情
    if (!isAppError && statusCode >= 500) {
        console.error(`[CRITICAL ERROR] ${err.stack || err.message}`);
        message = 'internal_server_error';
    } else {
        console.error(`[Server Error] ${err.message}`);
    }

    // 标准化响应
    return c.json({
        code: statusCode,
        success: false,
        message: message,
        data: null
    }, statusCode as any);
});

export default app;