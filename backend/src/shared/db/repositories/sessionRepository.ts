import { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, ne, and, lt } from 'drizzle-orm';
import { authSessions, NewAuthSession, AuthSession } from '@/shared/db/schema/index.js';

export class SessionRepository {
    private db: DrizzleD1Database;

    constructor(db: DrizzleD1Database) {
        this.db = db;
    }

    async create(session: NewAuthSession): Promise<void> {
        await this.db.insert(authSessions).values(session);
    }

    async findByUserId(userId: string): Promise<AuthSession[]> {
        return await this.db
            .select()
            .from(authSessions)
            .where(eq(authSessions.userId, userId));
    }

    async findAll(): Promise<AuthSession[]> {
        return await this.db
            .select()
            .from(authSessions);
    }

    async findSessionByDevice(userId: string, deviceId: string): Promise<AuthSession | null> {
        const result = await this.db
            .select()
            .from(authSessions)
            .where(and(
                eq(authSessions.userId, userId),
                eq(authSessions.deviceId, deviceId)
            ))
            .limit(1);
        return result[0] || null;
    }

    async findById(sessionId: string): Promise<AuthSession | null> {
        const result = await this.db
            .select()
            .from(authSessions)
            .where(eq(authSessions.id, sessionId))
            .limit(1);

        return result[0] || null;
    }

    async deleteById(sessionId: string): Promise<boolean> {
        const result = await this.db
            .delete(authSessions)
            .where(eq(authSessions.id, sessionId));

        return result.success;
    }

    async deleteAllExcept(userId: string | null, excludeSessionId: string): Promise<number> {
        // Unfortunately standard D1 driver count of deleted isn't easily returned, 
        // but we can query first or just execute matching.
        // For simplicity, we just execute deletion and the service layer can interpret the count if needed,
        // or we just return an estimated count. Here we just delete.
        const conditions = userId
            ? and(eq(authSessions.userId, userId), ne(authSessions.id, excludeSessionId))
            : ne(authSessions.id, excludeSessionId);

        const countRes = await this.db.select().from(authSessions).where(conditions);

        await this.db
            .delete(authSessions)
            .where(conditions);

        return countRes.length;
    }

    async updateLastActive(sessionId: string, ipAddress: string, timestamp: number): Promise<boolean> {
        const result = await this.db
            .update(authSessions)
            .set({
                lastActiveAt: timestamp,
                ipAddress: ipAddress
            })
            .where(eq(authSessions.id, sessionId))
            .execute();

        return result.success;
    }

    async cleanupExpired(cutoffTimestamp: number): Promise<number> {
        const conditions = lt(authSessions.lastActiveAt, cutoffTimestamp);

        const countRes = await this.db.select().from(authSessions).where(conditions);

        await this.db
            .delete(authSessions)
            .where(conditions);

        return countRes.length;
    }
}
