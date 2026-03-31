import { EnvBindings, AppError } from '@/app/config';
import { generateSecureJWT, generateDeviceKey } from '@/shared/utils/crypto';
import { getOAuthProvider } from '@/features/auth/providers/index';
import type { OAuthUserInfo } from '@/features/auth/providers/baseOAuthProvider';

import { EmergencyRepository } from '@/shared/db/repositories/emergencyRepository';

import { SessionService } from '@/features/auth/sessionService';

export class AuthService {
    private env: EnvBindings;
    private emergencyRepository: EmergencyRepository;
    private sessionService: SessionService;

    constructor(env: EnvBindings) {
        this.env = env;
        this.emergencyRepository = new EmergencyRepository(env.DB);
        this.sessionService = new SessionService(env);
    }

    /**
     * 生成提供商的授权重定向地址
     */
    async generateAuthorizeUrl(providerName: string): Promise<{ url: string, state: string, codeVerifier?: string }> {
        const provider = getOAuthProvider(providerName, this.env);
        const state = crypto.randomUUID();
        const result = await provider.getAuthorizeUrl(state);

        return {
            url: result.url,
            state: state,
            codeVerifier: result.codeVerifier
        };
    }

    /**
     * OAuth Callback 处理，生成会话并返回附加参数
     */
    async handleOAuthCallback(providerName: string, body: any, clientIp: string, userAgent: string, deviceId?: string): Promise<{
        token: string,
        userInfo: OAuthUserInfo,
        deviceKey: string,
        needsEmergency: boolean,
        encryptionKey?: string
    }> {
        const provider = getOAuthProvider(providerName, this.env);

        let params: string | URLSearchParams;
        if (providerName === 'telegram') {
            const searchParams = new URLSearchParams();
            Object.entries(body).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    searchParams.append(key, String(value));
                }
            });
            params = searchParams;
        } else {
            if (!body.code) throw new AppError('oauth_code_missing', 400);
            params = body.code;
        }

        const userInfo = await provider.handleCallback(params, body.codeVerifier);

        // 白名单检查
        this.verifyWhitelist(userInfo, provider.whitelistFields);

        // Register Device Session First
        const sessionId = await this.sessionService.createSession(userInfo.email || userInfo.id, userAgent, clientIp, deviceId, providerName);

        // 签发 Token
        const token = await this.generateSystemToken(userInfo, sessionId);

        // 附带客户端签名因子 (Device Key)
        // 注意：此处统一使用 userInfo.email 作为密钥因子，以确保 OAuth 与 Passkey 登录产生的解密密钥一致。
        const deviceKey = await generateDeviceKey(userInfo.email || userInfo.id, this.env.JWT_SECRET || '');

        // 检查是否需要强制备份 (Emergency 流程)
        const isEmergencyConfirmed = await this.emergencyRepository.isEmergencyConfirmed();
        const needsEmergency = !isEmergencyConfirmed;

        return {
            token,
            userInfo,
            deviceKey,
            needsEmergency,
            ...(needsEmergency && { encryptionKey: this.env.ENCRYPTION_KEY })
        };
    }



    /**
     * 白名单校验
     */
    private verifyWhitelist(userInfo: OAuthUserInfo, whitelistFields: string[]) {
        // 如果 explicitly allowed all, 则放行
        const allowAllStr = String(this.env.OAUTH_ALLOW_ALL || '').toLowerCase();
        if (allowAllStr === 'true' || allowAllStr === '1' || allowAllStr === '2') {
            return;
        }

        const allowedUsersStr = this.env.OAUTH_ALLOWED_USERS || '';
        const allowedIdentities = allowedUsersStr.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);

        // 如果配置了白名单，严格执行
        if (allowedIdentities.length > 0) {
            const userEmail = (userInfo.email || '').toLowerCase();
            const userName = (userInfo.username || '').toLowerCase();
            let isAllowed = false;

            if (whitelistFields.includes('email') && userEmail) {
                if (allowedIdentities.some((id: string) => {
                    if (id.startsWith('@')) {
                        const domain = id.substring(1);
                        return userEmail === domain || userEmail.endsWith('@' + domain);
                    }
                    return id === userEmail;
                })) {
                    isAllowed = true;
                } else if (allowedIdentities.includes(userEmail)) {
                    isAllowed = true;
                }
            }

            if (!isAllowed && whitelistFields.includes('username') && userName && allowedIdentities.includes(userName)) {
                isAllowed = true;
            }

            if (!isAllowed) {
                throw new AppError('unauthorized_user', 403);
            }
        } else {
            // 默认安全策略：如果未配置白名单，未开启 ALLOW_ALL，则拒绝所有人（或者也可以记录警告，但为了安全通常应拒绝）
            throw new AppError('not_whitelisted', 403);
        }
    }

    /**
     * 生成系统内部 Token
     */
    private async generateSystemToken(userInfo: OAuthUserInfo, sessionId: string): Promise<string> {
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
}
