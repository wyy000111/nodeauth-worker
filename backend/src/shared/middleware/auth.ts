import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { AppError, EnvBindings } from '@/app/config';
import { verifySecureJWT } from '@/shared/utils/crypto';
import { SessionService } from '@/features/auth/sessionService';

export async function authMiddleware(c: Context<{ Bindings: EnvBindings, Variables: { user: any, sessionId: string } }>, next: Next) {
    // 1. 从 Cookie 获取 JWT
    const token = getCookie(c, 'auth_token');
    if (!token) {
        throw new AppError('no_session', 401);
    }

    // 2. CSRF 校验 (Double Submit Cookie)
    const csrfCookie = getCookie(c, 'csrf_token');
    const csrfHeader = c.req.header('X-CSRF-Token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new AppError('csrf_mismatch', 403);
    }

    // 3. 验证 JWT
    const payload = await verifySecureJWT(token, c.env.JWT_SECRET);

    if (!payload || !payload.userInfo) {
        throw new AppError('token_expired', 401);
    }

    // 4. 从 DB 校验设备会话有效性 (防幽灵 JWT 攻击/被踢出)
    const sessionId = payload.sessionId;

    // 如果存在配置允许老的无 session 令牌，可做降级处理。在这里采用严格安全策略，一律要求有 Session
    if (!sessionId) {
        throw new AppError('session_invalid_schema', 401);
    }

    const sessionService = new SessionService(c.env);
    const isValid = await sessionService.validateSession(sessionId);
    if (!isValid) {
        // 如果数据库里 session 已被删除，代表被挤下线或过期，强行拦截
        throw new AppError('session_kicked_out', 401);
    }

    // 验证通过，将用户信息挂载到上下文，供后续路由使用
    c.set('user', payload.userInfo);
    c.set('sessionId', sessionId);
    await next();
}
