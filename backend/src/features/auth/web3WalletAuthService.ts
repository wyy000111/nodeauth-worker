import { EnvBindings, AppError } from '@/app/config';
import { generateSecureJWT, generateDeviceKey } from '@/shared/utils/crypto';
import { EmergencyRepository } from '@/shared/db/repositories/emergencyRepository';
import { SessionService } from '@/features/auth/sessionService';
import { verifyMessage } from 'viem';

export class Web3WalletAuthService {
    private env: EnvBindings;
    private emergencyRepository: EmergencyRepository;
    private sessionService: SessionService;

    constructor(env: EnvBindings) {
        this.env = env;
        this.emergencyRepository = new EmergencyRepository(env.DB);
        this.sessionService = new SessionService(env);
    }

    /**
     * 生成 Web3 登录的防篡改 Challenge 参数 (Nonce)
     */
    async generateAuthenticationOptions(): Promise<{ nonce: string }> {
        // 使用 WebCrypto 生成高强度随机数作为签名用 nonce
        const nonce = crypto.randomUUID().replace(/-/g, '');
        return { nonce };
    }

    /**
     * 校验前端上报的以太坊签名 (Ethereum Signature)
     */
    async verifyAuthenticationResponse(
        address: string,
        message: string,
        signature: string,
        expectedNonce: string,
        clientIp: string,
        userAgent: string,
        deviceId?: string
    ) {
        if (!expectedNonce) {
            throw new AppError('web3_nonce_missing', 400);
        }

        // 1. 防重放攻击/中间人攻击: 原原始明文中必须携带服务端刚发放的 Nonce
        if (!message.includes(expectedNonce)) {
            throw new AppError('web3_nonce_mismatch', 400);
        }

        // 2. 密码学反解与验证: 使用 viem 原生 verifyMessage
        let isValid = false;
        try {
            isValid = await verifyMessage({
                address: address as `0x${string}`,
                message: message,
                signature: signature as `0x${string}`,
            });
        } catch (error) {
            throw new AppError('web3_signature_invalid', 400);
        }

        if (!isValid) {
            throw new AppError('web3_signature_invalid', 400);
        }

        // 去统一大小写 (以太坊地址通常校验时视全小写等效)
        const normalizedAddress = address.toLowerCase();

        // 3. 白名单拦截墙校验 (共用系统的 OAUTH_ALLOWED_USERS 变量)
        this.verifyWhitelist(normalizedAddress);

        // 4. 重用原 WebAuthn 系统的后续业务链路：开启会话、打通 DeviceKey、生成安全票据 JWT
        const sessionId = await this.sessionService.createSession(normalizedAddress, userAgent, clientIp, deviceId, 'web3');
        const token = await this.generateSystemToken(normalizedAddress, sessionId);
        const deviceKey = await generateDeviceKey(normalizedAddress, this.env.JWT_SECRET || '');

        const isEmergencyConfirmed = await this.emergencyRepository.isEmergencyConfirmed();
        const needsEmergency = !isEmergencyConfirmed;

        return {
            token,
            userInfo: {
                id: normalizedAddress,
                username: normalizedAddress,
                provider: 'web3',
                avatar: '' // Web3目前不自带内聚头像，可设为空处理
            },
            deviceKey,
            needsEmergency,
            ...(needsEmergency && { encryptionKey: this.env.ENCRYPTION_KEY })
        };
    }

    /**
     * 内部白名单隔离审查机制
     */
    private verifyWhitelist(userAddress: string) {
        const allowAllStr = String(this.env.OAUTH_ALLOW_ALL || '').toLowerCase();
        // 1. 系统开启了后门 (开放所有)
        if (allowAllStr === 'true' || allowAllStr === '1' || allowAllStr === '2') {
            return;
        }

        const allowedUsersStr = this.env.OAUTH_ALLOWED_USERS || '';
        const allowedIdentities = allowedUsersStr.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);

        // 2. 系统设置了精确的白名单规则
        if (allowedIdentities.length > 0) {
            let isAllowed = false;
            // 完全匹配钱包地址
            if (allowedIdentities.includes(userAddress)) {
                isAllowed = true;
            }

            if (!isAllowed) {
                throw new AppError('unauthorized_user', 403); // 有白名单但不包含
            }
        } else {
            // 没有任何白名单且没开全通模式 -> 锁定拒绝
            throw new AppError('not_whitelisted', 403);
        }
    }

    /**
     * 生成与现有生命周期对齐的内部系统 JWT Token
     */
    private async generateSystemToken(address: string, sessionId: string): Promise<string> {
        const payload = {
            sessionId: sessionId,
            userInfo: {
                id: address,
                username: address,
                email: address, // 将邮箱字段复写为地址以兼容下游遗留设计
                provider: 'web3'
            }
        };

        if (!this.env.JWT_SECRET) {
            throw new AppError('missing_jwt_secret', 500);
        }

        return await generateSecureJWT(payload, this.env.JWT_SECRET);
    }
}
