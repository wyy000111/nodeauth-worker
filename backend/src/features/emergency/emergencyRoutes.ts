import { Hono } from 'hono';
import { EnvBindings, AppError, SECURITY_CONFIG } from '@/app/config';
import { authMiddleware } from '@/shared/middleware/auth';
import { rateLimit, resetRateLimit } from '@/shared/middleware/rateLimitMiddleware';
import { EmergencyRepository } from '@/shared/db/repositories/emergencyRepository';

const emergency = new Hono<{ Bindings: EnvBindings, Variables: { user: any } }>();

/**
 * 确认系统重置（核心密钥已保存）
 */
emergency.post('/confirm', authMiddleware, rateLimit({
    windowMs: SECURITY_CONFIG.LOCKOUT_TIME,
    max: SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS,
}), async (c) => {
    const { lastFour } = await c.req.json();
    const encryptionKey = c.env.ENCRYPTION_KEY || '';

    if (!lastFour || encryptionKey.slice(-4) !== lastFour) {
        throw new AppError('invalid_emergency_verification', 400);
    }

    const repository = new EmergencyRepository(c.env.DB);
    await repository.confirmEmergency();

    // 验证成功，重置限流计数器
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
    await resetRateLimit(c, `rl:${clientIp}:/api/emergency/confirm`);

    return c.json({
        success: true,
        message: 'emergency_confirmed'
    });
});

export default emergency;
