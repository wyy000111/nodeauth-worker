import { EnvBindings, AppError } from '@/app/config';
import { generateSecureJWT, generateDeviceKey } from '@/shared/utils/crypto';
import * as schema from '@/shared/db/schema';
import { eq, desc } from 'drizzle-orm';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import { EmergencyRepository } from '@/shared/db/repositories/emergencyRepository';
import { SessionService } from '@/features/auth/sessionService';

export class WebAuthnService {
    private env: EnvBindings;
    private rpName = 'NodeAuth';
    private rpID: string;
    private origin: string;
    private emergencyRepository: EmergencyRepository;
    private sessionService: SessionService;

    constructor(env: EnvBindings, url: string, headers?: Record<string, string | undefined>) {
        this.env = env;
        const parsedUrl = new URL(url);
        this.emergencyRepository = new EmergencyRepository(env.DB);
        this.sessionService = new SessionService(env);

        // Handle Reverse Proxy (Docker/Nginx/Cloudflare)
        // If X-Forwarded-Proto exists, use it as the real protocol
        const proto = headers?.['x-forwarded-proto'] || parsedUrl.protocol.replace(':', '');
        const host = headers?.['x-forwarded-host'] || parsedUrl.host;

        this.rpID = host.split(':')[0]; // Domain only for RP ID
        this.origin = `${proto.includes('://') ? proto : proto + '://'}${host}`;
    }

    /**
     * 生成注册选项
     */
    async generateRegistrationOptions(userId: string, userEmail: string, userNameExt?: string) {
        // 获取已存在的凭证 (以 identity 作为 userId 关联)
        const results = await this.env.DB.select({ credential_id: schema.authPasskeys.credentialId })
            .from(schema.authPasskeys)
            .where(eq(schema.authPasskeys.userId, userEmail));

        const options = await generateRegistrationOptions({
            rpName: this.rpName,
            rpID: this.rpID,
            userID: new TextEncoder().encode(userId),
            userName: userNameExt || userEmail,
            userDisplayName: `NodeAuth (${userNameExt || userEmail})`,
            attestationType: 'none',
            excludeCredentials: results.map((row: any) => ({
                id: row.credential_id,
                type: 'public-key',
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
        });

        return options;
    }

    /**
     * 验证注册响应
     */
    async verifyRegistrationResponse(userEmail: string, body: any, expectedChallenge: string, credentialName?: string) {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: this.origin,
            expectedRPID: this.rpID,
        });

        if (verification.verified && verification.registrationInfo) {
            const { credential } = verification.registrationInfo;

            // 存储到 DB
            await this.env.DB.insert(schema.authPasskeys).values({
                credentialId: credential.id,
                userId: userEmail,
                publicKey: credential.publicKey as any,
                counter: verification.registrationInfo.credential.counter,
                name: credentialName || `Passkey ${new Date().toLocaleDateString()}`,
                createdAt: Date.now()
            });

            return { success: true };
        }

        throw new AppError('webauthn_registration_failed', 400);
    }

    /**
     * 生成登录选项
     */
    async generateAuthenticationOptions() {
        const options = await generateAuthenticationOptions({
            rpID: this.rpID,
            userVerification: 'preferred',
        });

        return options;
    }

    /**
     * 验证登录响应
     */
    async verifyAuthenticationResponse(body: any, expectedChallenge: string, clientIp: string, userAgent: string, deviceId?: string) {
        const credentialID = body.id;

        // 从 DB 查找凭证
        const [credential] = await this.env.DB.select()
            .from(schema.authPasskeys)
            .where(eq(schema.authPasskeys.credentialId, credentialID))
            .limit(1);

        if (!credential) {
            throw new AppError('passkey_not_found', 404);
        }

        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge,
            expectedOrigin: this.origin,
            expectedRPID: this.rpID,
            credential: {
                id: credential.credentialId,
                publicKey: new Uint8Array(Object.values(credential.publicKey)) as any,
                counter: credential.counter,
                transports: []
            },
        });

        if (verification.verified && verification.authenticationInfo) {
            // 更新计数器
            await this.env.DB.update(schema.authPasskeys)
                .set({
                    counter: verification.authenticationInfo.newCounter,
                    lastUsedAt: Date.now()
                })
                .where(eq(schema.authPasskeys.credentialId, credentialID));

            // 验证通过，颁发令牌
            const userEmail = credential.userId; // 存储的是 Email 或 ID (Telegram)

            // 注册会话设备
            const sessionId = await this.sessionService.createSession(userEmail, userAgent, clientIp, deviceId, 'passkey');

            // 签发 Token
            const token = await this.generateSystemToken({
                id: userEmail,
                username: userEmail.includes('@') ? userEmail.split('@')[0] : userEmail,
                email: userEmail.includes('@') ? userEmail : undefined,
                provider: 'passkey'
            }, sessionId);

            // 附带客户端解密因子 (Device Key)
            // 核心: 必须使用 Email/ID 与 OAuth 逻辑保持对齐，确保解密一致性。
            const deviceKey = await generateDeviceKey(userEmail, this.env.JWT_SECRET || '');

            // 检查是否需要初始化设置
            const isEmergencyConfirmed = await this.emergencyRepository.isEmergencyConfirmed();
            const needsEmergency = !isEmergencyConfirmed;

            return {
                success: true,
                token,
                deviceKey,
                userInfo: {
                    id: userEmail,
                    username: userEmail.includes('@') ? userEmail.split('@')[0] : userEmail,
                    email: userEmail.includes('@') ? userEmail : undefined,
                    provider: 'passkey'
                },
                needsEmergency,
                ...(needsEmergency && { encryptionKey: this.env.ENCRYPTION_KEY })
            };
        }

        throw new AppError('webauthn_login_failed', 400);
    }

    private async generateSystemToken(userInfo: any, sessionId: string): Promise<string> {
        const payload = {
            sessionId: sessionId,
            userInfo: {
                id: userInfo.id,
                username: userInfo.username,
                email: userInfo.email,
                avatar: userInfo.avatar,
                provider: userInfo.provider
            }
        };

        if (!this.env.JWT_SECRET) {
            throw new AppError('missing_jwt_secret', 500);
        }

        return await generateSecureJWT(payload, this.env.JWT_SECRET);
    }

    /**
     * 获取用户的凭证列表
     */
    async listCredentials() {
        const results = await this.env.DB.select({
            id: schema.authPasskeys.credentialId,
            name: schema.authPasskeys.name,
            created_at: schema.authPasskeys.createdAt,
            last_used_at: schema.authPasskeys.lastUsedAt
        })
            .from(schema.authPasskeys)
            .orderBy(desc(schema.authPasskeys.createdAt));
        return results;
    }

    /**
     * 更新凭证名称
     */
    async updateCredentialName(credentialId: string, name: string) {
        await this.env.DB.update(schema.authPasskeys)
            .set({ name })
            .where(eq(schema.authPasskeys.credentialId, credentialId));
        return { success: true };
    }

    /**
     * 删除凭证
     */
    async deleteCredential(credentialId: string) {
        await this.env.DB.delete(schema.authPasskeys)
            .where(eq(schema.authPasskeys.credentialId, credentialId));
        return { success: true };
    }
}
