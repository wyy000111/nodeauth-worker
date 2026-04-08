import { Context, Next } from 'hono';
import { EnvBindings, AppError } from '@/app/config';
import { eq } from 'drizzle-orm';
import { rateLimits } from '@/shared/db/schema/index';
import { logger } from '@/shared/utils/logger';

/**
 * 核心速率限制中间件 (兼容 D1 Raw 和 Drizzle ORM)
 * @param options 配置项
 */
export const rateLimit = (options: {
    windowMs: number;
    max: number;
    keyBuilder?: (c: Context) => string;
}) => {
    return async (c: Context<{ Bindings: EnvBindings }>, next: Next) => {
        const db = c.env.DB;
        if (!db) {
            // 如果没配置 DB，跳过限制
            await next();
            return;
        }

        // 默认使用 IP + PATH 作为 Key
        const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
        const path = c.req.path;
        const key = options.keyBuilder ? options.keyBuilder(c) : `rl:${clientIp}:${path}`;

        const now = Date.now();

        try {
            // 策略：检测 DB 类型。如果存在 prepare 方法，说明是原始 D1/SQLite 绑定；
            // 否则视为 Drizzle ORM 实例。
            if (typeof db.prepare === 'function') {
                // --- 原始 D1 模式 ---
                const record: any = await db.prepare(
                    'SELECT attempts, last_attempt, expires_at FROM rate_limits WHERE key = ?'
                ).bind(key).first();

                if (record) {
                    if (record.expires_at && record.expires_at > now) {
                        throw new AppError('too_many_requests', 429);
                    }

                    if (now - record.last_attempt > options.windowMs) {
                        await db.prepare(
                            'UPDATE rate_limits SET attempts = 1, last_attempt = ?, expires_at = NULL WHERE key = ?'
                        ).bind(now, key).run();
                    } else {
                        const newAttempts = record.attempts + 1;
                        if (newAttempts > options.max) {
                            const expiresAt = now + options.windowMs;
                            await db.prepare(
                                'UPDATE rate_limits SET attempts = ?, last_attempt = ?, expires_at = ? WHERE key = ?'
                            ).bind(newAttempts, now, expiresAt, key).run();
                            throw new AppError('too_many_requests', 429);
                        } else {
                            await db.prepare(
                                'UPDATE rate_limits SET attempts = ?, last_attempt = ? WHERE key = ?'
                            ).bind(newAttempts, now, key).run();
                        }
                    }
                } else {
                    await db.prepare(
                        'INSERT INTO rate_limits (key, attempts, last_attempt) VALUES (?, 1, ?)'
                    ).bind(key, now).run();
                }
            } else {
                // --- Drizzle ORM 模式 ---
                const result = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
                const record = result[0];

                if (record) {
                    if (record.expiresAt && record.expiresAt > now) {
                        throw new AppError('too_many_requests', 429);
                    }

                    if (now - (record.lastAttempt || 0) > options.windowMs) {
                        await db.update(rateLimits)
                            .set({ attempts: 1, lastAttempt: now, expiresAt: null })
                            .where(eq(rateLimits.key, key));
                    } else {
                        const newAttempts = (record.attempts || 0) + 1;
                        if (newAttempts > options.max) {
                            const expiresAt = now + options.windowMs;
                            await db.update(rateLimits)
                                .set({ attempts: newAttempts, lastAttempt: now, expiresAt })
                                .where(eq(rateLimits.key, key));
                            throw new AppError('too_many_requests', 429);
                        } else {
                            await db.update(rateLimits)
                                .set({ attempts: newAttempts, lastAttempt: now })
                                .where(eq(rateLimits.key, key));
                        }
                    }
                } else {
                    await db.insert(rateLimits)
                        .values({ key, attempts: 1, lastAttempt: now });
                }
            }
        } catch (e: any) {
            // 如果是速率限制错误，继续抛出
            if (e instanceof AppError && e.statusCode === 429) throw e;
            // 其他数据库错误（如表不存在）记录日志但不中断业务
            logger.error('[RateLimit] Database error:', e.message);
        }

        await next();
    };
};

/**
 * 成功后重置计数器 (用于成功登录后清理记录)
 */
export const resetRateLimit = async (c: Context<any>, key: string) => {
    const db = c.env.DB;
    if (!db) return;

    try {
        if (typeof db.prepare === 'function') {
            await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
        } else {
            await db.delete(rateLimits).where(eq(rateLimits.key, key));
        }
    } catch (e) {
        logger.error('[RateLimit] Reset failed:', e);
    }
};
