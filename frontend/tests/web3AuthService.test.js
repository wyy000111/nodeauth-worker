import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '@/shared/utils/request';
import EthereumProvider from '@walletconnect/ethereum-provider';

/**
 * Web3 Wallet Authentication (Web3 钱包认证) 专项测试套件
 * 
 * 核心目标：
 * 验证基于 WalletConnect 2.0 的 SIWE (Sign-In with Ethereum) 登录流程稳定性。
 * 特别关注：
 * 1. PC 端二维码显示 (onUri 回调)
 * 2. 移动端 App 唤起 (Deep Link 适配)
 * 3. 状态流监控 (onStatus 状态机映射)
 * 4. 异常回退逻辑 (拒绝签名、后端校验失败等)
 */

// 1. 模拟网络请求模块
vi.mock('@/shared/utils/request', () => ({
    request: vi.fn(),
}));

// 2. 模拟 WalletConnect Provider
vi.mock('@walletconnect/ethereum-provider', () => {
    return {
        default: {
            init: vi.fn(),
        }
    };
});

describe('web3WalletAuthService TDD (Frontend Core)', () => {
    let mockProviderInstance;
    let web3WalletAuthService;

    beforeEach(async () => {
        vi.resetModules();
        // 动态导入以确保获取纯净的 Service 实例
        const module = await import('@/features/auth/service/web3WalletAuthService');
        web3WalletAuthService = module.web3WalletAuthService;

        vi.clearAllMocks();
        localStorage.clear();

        // 构造模拟的 EthereumProvider 实例
        mockProviderInstance = {
            on: vi.fn(),
            removeListener: vi.fn(),
            connect: vi.fn().mockResolvedValue(),
            request: vi.fn().mockResolvedValue('mock-signature'),
            disconnect: vi.fn().mockResolvedValue(),
            accounts: ['0x1234567890abcdef'],
        };
        EthereumProvider.init.mockResolvedValue(mockProviderInstance);

        // 设置 Mock 后端行为：nonce 获取 -> 签名校验
        request.mockImplementation(async (url) => {
            if (url === '/api/oauth/web3/login/options') return { nonce: 'mock-nonce-123' };
            if (url === '/api/oauth/web3/login/verify') return { success: true, token: 'mock-token' };
            return {};
        });
    });

    describe('Happy Paths (正常路径)', () => {
        /**
         * Case 01: PC 端扫码登录触发
         * 目标：验证桌面端二维码生成。
         * 解决问题：确保在识别到非移动端环境时，将 WalletConnect 的连接 URI 正确透传给 UI 组件渲染二维码。
         */
        it('should trigger onUri event for PC QR generation (Point 11)', async () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Windows NT 10.0' });

            // 增强 connect Mock：模拟 WalletConnect 内部触发显示 URI 的行为
            mockProviderInstance.connect.mockImplementation(async () => {
                const calls = mockProviderInstance.on.mock.calls;
                const displayUriCall = calls.find(c => c[0] === 'display_uri');
                if (displayUriCall) displayUriCall[1]('wc:mock-qr-uri');
            });

            let capturedUri = null;
            await web3WalletAuthService.login('mock-project-id', {
                onUri: (uri) => { capturedUri = uri; }
            });

            expect(capturedUri).toBe('wc:mock-qr-uri');
        });

        /**
         * Case 02: 移动端 Deep Link 跳转
         * 目标：验证移动设备兼容性。
         * 解决问题：自动识别 iOS/Android UA，并标记 isMobile 为 true，以便 UI 层直接打开 App 而非显示二维码。
         */
        it('should handle mobile view redirection via onUri (Point 12)', async () => {
            vi.stubGlobal('navigator', { userAgent: 'iPhone; CPU iPhone OS 14_0' });

            mockProviderInstance.connect.mockImplementation(async () => {
                const displayUriCall = mockProviderInstance.on.mock.calls.find(c => c[0] === 'display_uri');
                if (displayUriCall) displayUriCall[1]('wc:mock-mobile-uri');
            });

            let capturedUri = null;
            let isMobileFlag = false;

            await web3WalletAuthService.login('mock-project-id', {
                onUri: (uri, isMobile) => {
                    capturedUri = uri;
                    isMobileFlag = isMobile;
                }
            });

            expect(capturedUri).toBe('wc:mock-mobile-uri');
            expect(isMobileFlag).toBe(true);
        });

        /**
         * Case 03: 完整登录生命周期与状态更新
         * 目标：验证 UI 引导状态流。
         * 解决问题：确保在“正在连接 -> 等待签名 -> 正在校验”的漫长过程中，UI 能通过 onStatus 回调获取准确状态，防止用户迷茫。
         */
        it('should complete full login flow and report status updates (Point 13 & 14)', async () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Windows NT 10.0' });
            const statusUpdates = [];

            const result = await web3WalletAuthService.login('mock-project-id', {
                onStatus: (s) => statusUpdates.push(s)
            });

            expect(statusUpdates).toContain('reconnecting');      // Step 1: Connect
            expect(statusUpdates).toContain('awaiting_signature'); // Step 2: Sign
            expect(statusUpdates).toContain('verifying');          // Step 3: Verify
            expect(result.token).toBe('mock-token');
        });
    });

    describe('Edge Cases / Error Paths (异常路径)', () => {
        /**
         * Case 04: 用户拒绝签名 (User Rejected)
         * 目标：验证错误捕获与清理逻辑。
         * 解决问题：当用户在钱包 App 中点“取消”时，Service 必须捕获该错误并立即显式 disconnect 以断开 Socket 连接，防止内存泄漏。
         */
        it('should handle user cancelling signature (Point 12)', async () => {
            mockProviderInstance.request.mockRejectedValue(new Error('User rejected message signature'));

            await expect(web3WalletAuthService.login('mock-project-id', {}))
                .rejects.toThrow('User cancelled');

            expect(mockProviderInstance.disconnect).toHaveBeenCalled();
        });

        /**
         * Case 05: 后端逻辑校验失败 (例如白名单限制)
         * 目标：验证业务异常透传。
         * 解决问题：当签名有效但地址不在白名单时，后端返回 not_whitelisted 错误，Service 应将其抛给 UI 显示具体错误详情。
         */
        it('should handle backend verify rejection (Point 9 & 10)', async () => {
            request.mockImplementation(async (url) => {
                if (url === '/api/oauth/web3/login/options') return { nonce: 'mock' };
                if (url === '/api/oauth/web3/login/verify') throw new Error('not_whitelisted');
            });

            await expect(web3WalletAuthService.login('proj', {}))
                .rejects.toThrow('not_whitelisted');
        });

        /**
         * Case 06: 签名后移除断开连接监听 (Resilience after signature)
         * 目标：验证在获取到签名后，系统主动移除了可能会中断验证流程的监听器。
         */
        it('should remove disconnect listener before verification phase', async () => {
            let capturedDisconnectHandler = null;
            mockProviderInstance.on.mockImplementation((event, handler) => {
                if (event === 'disconnect') capturedDisconnectHandler = handler;
            });

            await web3WalletAuthService.login('mock-project-id', {});

            // 验证在完成逻辑中，removeListener 曾被正确调用且传入了当初绑定的同一个 Handler
            expect(mockProviderInstance.removeListener).toHaveBeenCalledWith('disconnect', capturedDisconnectHandler);
        });

        /**
         * Case 07: 登录失败后单例被重置 (Singleton Reset After Failure)
         * 目标：验证 abortFlow 后 initPromise 被清除，下次登录不会复用断开的 Provider。
         * 解决问题：之前 abortFlow 只 disconnect 但不重置引用，导致第二次登录尝试时
         * getProvider() 直接返回了已断开的僵尸实例。
         */
        it('should reset singleton after login failure so next attempt re-initializes', async () => {
            mockProviderInstance.request.mockRejectedValue(new Error('User rejected message signature'));

            // 第一次失败
            await expect(web3WalletAuthService.login('mock-project-id', {}))
                .rejects.toThrow('User cancelled');

            // 重置 mock，使第二次尝试可以成功
            mockProviderInstance.request.mockResolvedValue('mock-signature-2');
            EthereumProvider.init.mockResolvedValue(mockProviderInstance);

            // 第二次登录必须重新调用 init，而不是复用旧的断开实例
            await web3WalletAuthService.login('mock-project-id', {});
            expect(EthereumProvider.init).toHaveBeenCalledTimes(2);
        });

        /**
         * Case 08: 不同 projectId 触发重新初始化 (Re-init on projectId Change)
         * 目标：验证 memoization 以 projectId 为 key，防止用错误 ID 初始化的实例被复用。
         * 解决问题：之前只检查 initPromise 是否存在，完全忽略 projectId 是否匹配。
         */
        it('should re-initialize provider when projectId changes', async () => {
            // 第一次用 ID-A 初始化
            await web3WalletAuthService.login('project-id-A', {});
            expect(EthereumProvider.init).toHaveBeenCalledTimes(1);
            expect(EthereumProvider.init).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-id-A' }));

            // 用不同的 ID-B 再次调用，必须触发第二次 init
            EthereumProvider.init.mockResolvedValue(mockProviderInstance);
            await web3WalletAuthService.login('project-id-B', {});
            expect(EthereumProvider.init).toHaveBeenCalledTimes(2);
            expect(EthereumProvider.init).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'project-id-B' }));
        });
    });
});
