import { EnvBindings, AppError } from '@/app/config';
import { SessionRepository } from '@/shared/db/repositories/sessionRepository';
import { parseUserAgent } from '@/shared/utils/ua';
import { maskUserId, maskIp } from '@/shared/utils/masking';

export interface EnrichedSession {
    id: string;
    userId: string;
    deviceType: string;
    friendlyName: string; // 友好展示名称
    ipAddress: string;
    lastActiveAt: number;
    createdAt: number;
    isCurrent: boolean;
    provider?: string | null;
}

export class SessionService {
    private repo: SessionRepository;
    private env: EnvBindings;

    constructor(env: EnvBindings, repo?: SessionRepository) {
        this.env = env;
        this.repo = repo || new SessionRepository(env.DB);
    }

    /**
     * Create or Refresh a session based on DeviceID fingerprinting
     */
    async createSession(userId: string, deviceType: string, ipAddress: string, deviceId?: string, provider?: string): Promise<string> {
        const now = Date.now();
        const typeStr = deviceType?.trim() ? deviceType : 'Unknown Device';

        // 🛡️ 识别设备：如果提供了 deviceId，尝试查找该用户在该设备上的旧会话以便并表
        if (deviceId) {
            const existing = await this.repo.findSessionByDevice(userId, deviceId);
            if (existing) {
                // 彻底识别为同一物理设备：更新活跃时间与 IP，复用会话席位
                await this.repo.updateLastActive(existing.id, ipAddress, now);
                return existing.id;
            }
        }

        const sessionId = crypto.randomUUID();
        await this.repo.create({
            id: sessionId,
            userId,
            deviceId: deviceId || null,
            provider: provider || 'unknown',
            deviceType: typeStr,
            ipAddress,
            lastActiveAt: now,
            createdAt: now
        });

        return sessionId;
    }

    /**
     * Get all active sessions in the system (Modified for Private Mode: Global View)
     */
    async getUserSessions(_userId: string, currentSessionId: string): Promise<EnrichedSession[]> {
        // 🛡️ 架构师变更：个人私有工具下去掉 userId 过滤，展示全局设备记录
        const sessions = await this.repo.findAll();

        return sessions.map(s => ({
            id: s.id,
            userId: maskUserId(s.userId), // 🛡️ 架构师修复：脱敏处理
            deviceType: s.deviceType,
            friendlyName: parseUserAgent(s.deviceType),
            ipAddress: maskIp(s.ipAddress), // 🛡️ 架构师修复：脱敏处理
            lastActiveAt: s.lastActiveAt,
            createdAt: s.createdAt,
            isCurrent: s.id === currentSessionId,
            provider: s.provider
        })).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    }

    /**
     * Kick out a single target device session
     */
    async deleteSession(_userId: string, targetSessionId: string, currentSessionId: string): Promise<void> {
        // 自杀防御保护 Rule
        if (targetSessionId === currentSessionId) {
            throw new AppError('Cannot kick current device', 400);
        }

        const session = await this.repo.findById(targetSessionId);
        if (!session) {
            // Idempotent: if it doesn't exist, we just return successfully
            return;
        }

        // 🛡️ 架构师修复：个人私有工具下移除 userId 强校验，实现会话全局清理。
        // 原本的平行越权防御规则在此模式下不再适用。

        await this.repo.deleteById(targetSessionId);
    }

    /**
     * Kick out all other devices across the entire system (Global Purge)
     */
    async deleteAllOtherSessions(_userId: string, currentSessionId: string): Promise<number> {
        // 🛡️ 传入 null 以触发 Repository 的全局清理逻辑
        return await this.repo.deleteAllExcept(null, currentSessionId);
    }

    /**
     * Middleware/Background heartbeat check to update active timestamp
     */
    async heartbeat(sessionId: string, ipAddress: string): Promise<void> {
        await this.repo.updateLastActive(sessionId, ipAddress, Date.now());
    }

    /**
     * Periodic cleanup for zombie sessions
     */
    async cleanupZombieSessions(): Promise<number> {
        // TTL from ENV or default 30 days
        const ttlDays = this.env.SESSION_TTL_DAYS || 30;
        const cutoffTime = Date.now() - (ttlDays * 24 * 60 * 60 * 1000);

        return await this.repo.cleanupExpired(cutoffTime);
    }

    /**
     * Quick boolean valid check for incoming requests
     */
    async validateSession(sessionId: string): Promise<boolean> {
        if (!sessionId) return false;

        const session = await this.repo.findById(sessionId);
        if (!session) return false;

        // Optionally verify if it has exceeded TTL here as well (Ghost jwt check)
        const ttlDays = this.env.SESSION_TTL_DAYS || 30;
        const cutoffTime = Date.now() - (ttlDays * 24 * 60 * 60 * 1000);

        if (session.lastActiveAt < cutoffTime) {
            return false;
        }

        return true;
    }
}
