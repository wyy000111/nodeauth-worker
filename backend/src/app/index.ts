import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as hLogger } from 'hono/logger';
import { logger } from '@/shared/utils/logger';
import { secureHeaders } from 'hono/secure-headers';
import { EnvBindings, getEffectiveCSP } from '@/app/config';
import { initializeEnv } from '@/shared/utils/crypto';

// ---------------------------------------------------------
// 模块导入 (Module Imports)
// ---------------------------------------------------------
import authRoutes from '@/features/auth/authRoutes';
import vaultRoutes from '@/features/vault/vaultRoutes';
import backupRoutes from '@/features/backup/backupRoutes';
import telegramRoutes from '@/features/telegram/telegramRoutes';
import toolsRoutes from '@/features/tools/toolsRoutes';
import healthRoutes from '@/features/health/healthRoutes';
import emergencyRoutes from '@/features/emergency/emergencyRoutes';
import wcProxyRoutes from '@/features/auth/wcProxyRoutes';
import { runHealthCheck } from '@/shared/utils/health';

/**
 * NodeAuth 核心应用入口 (Hono & Middleware)
 * 职责: 路由挂载、全局安全拦截、静态资源处理及环境标准化
 */

// 扩展 EnvBindings 以包含 ASSETS (Cloudflare Pages/Workers Assets)
type Bindings = EnvBindings & { ASSETS: { fetch: (req: Request) => Promise<Response> } };

// 初始化 Hono 应用，并绑定 Cloudflare 的环境变量类型
const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------
// 1. 全局中间件 & 安全初始化 (Middleware Layer)
// ---------------------------------------------------------

// 1.1 环境拦截与自动化解密 (新特性：支持 aes: 前缀深度解析)
app.use('*', async (c, next) => {
    // 自动扫描 c.env 并根据 JWT_SECRET 作为根密钥进行环境变量解密
    if (c.env) {
        await initializeEnv(c.env);
    }
    await next();
});

// 1.2 全球请求日志注入: 通过统一 Logger 进行过滤
app.use('*', hLogger((str) => logger.info(str)));

// 1.3 跨域策略 (CORS)
app.use('/api/*', cors({
    origin: (origin) => origin,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
    maxAge: 86400,
}));

// 1.4 安全响应头 (CSP & Security Headers)
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

// ---------------------------------------------------------
// 2. 路由分发 (Routes Mounting)
// ---------------------------------------------------------

// 2.1 基础健康检查
app.get('/api', (c) => c.text('🔐 2FA Secure Manager API is running!'));

// 2.2 全局安全健康检查拦截器 (Security Check Handler)
app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    // 健康检查及特定注销路径豁免安全检查逻辑
    if (path.startsWith('/api/health') || path === '/api/oauth/logout') {
        await next();
        return;
    }

    const securityResult = runHealthCheck(c.env);
    if (!securityResult.passed) {
        return c.json({
            code: 403,
            success: false,
            message: 'health_check_failed',
            data: securityResult.issues
        }, 403);
    }

    await next();
});

// 2.3 业务子路由挂载
app.route('/api/health', healthRoutes);
app.route('/api/emergency', emergencyRoutes);
app.route('/api/oauth', authRoutes);
app.route('/api/vault', vaultRoutes);
app.route('/api/backups', backupRoutes);
app.route('/api/telegram', telegramRoutes);
app.route('/api/tools', toolsRoutes);
app.route('/api/oauth/wc-proxy', wcProxyRoutes);

// ---------------------------------------------------------
// 3. 资源托管与回退 (Static Assets Handler)
// ---------------------------------------------------------

// 3.1 兼容 API 404 处理
app.all('/api/*', (c) => {
    return c.json({ success: false, error: 'API Not Found' }, 404);
});

// 3.2 静态前端资源 (适配 Docker & Cloudflare)
app.get('*', async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    return new Response(res.body, res);
});

// ---------------------------------------------------------
// 4. 全局错误捕获 (Global Error Handler)
// ---------------------------------------------------------
app.onError((err, c) => {
    const statusCode = (err as any).statusCode || (err as any).status || 500;

    // 特定备份逻辑下的 404 兼容 (Vault Sync 特定需求)
    if (c.req.path.includes('/files') && (Number(statusCode) === 404 || err.message.includes('404'))) {
        return c.json({ success: true, backups: [] });
    }

    const isAppError = (err as any).name === 'AppError';
    let message = err.message || 'Internal Server Error';

    // 生产环境下对非特定业务异常应用脱敏
    if (!isAppError && statusCode >= 500) {
        logger.error(`[CRITICAL ERROR] ${err.stack || err.message}`);
        message = 'internal_server_error';
    } else {
        logger.error(`[Server Error] ${err.message}`);
    }

    return c.json({
        code: statusCode,
        success: false,
        message: message,
        data: null
    }, statusCode as any);
});

export default app;