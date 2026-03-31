import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Web3WalletAuthService } from '@/features/auth/web3WalletAuthService';

const { mockedRepoInstance } = vi.hoisted(() => ({
    mockedRepoInstance: {
        isEmergencyConfirmed: vi.fn(),
    }
}));

const { mockedSessionInstance } = vi.hoisted(() => ({
    mockedSessionInstance: {
        createSession: vi.fn().mockResolvedValue('mock-session-id'),
    }
}));

vi.mock('@/shared/db/repositories/emergencyRepository', () => ({
    EmergencyRepository: class {
        constructor() {
            return mockedRepoInstance;
        }
    }
}));

vi.mock('@/features/auth/sessionService', () => ({
    SessionService: class {
        constructor() {
            return mockedSessionInstance;
        }
    }
}));

vi.mock('@/shared/utils/crypto', () => ({
    generateSecureJWT: vi.fn().mockResolvedValue('mock-token'),
    generateDeviceKey: vi.fn().mockResolvedValue('mock-device-key'),
}));

// Mock viem verifyMessage since we don't want to bring down a whole crypto payload in every rapid run
// (though it works, mocking is faster for TDD logic path tests)
vi.mock('viem', () => ({
    verifyMessage: vi.fn().mockImplementation(async ({ address, message, signature }) => {
        if (signature === 'valid-signature') {
            return true;
        }
        return false;
    })
}));

describe('Web3WalletAuthService (Red/Green TDD Core Logic)', () => {
    let authService: Web3WalletAuthService;
    let mockEnv: any;

    const validAddress = '0x1A2B3C4d5E6F'.toLowerCase();
    const validNonce = 'test-nonce-1234';

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnv = {
            DB: {},
            JWT_SECRET: 'test-secret',
            OAUTH_ALLOWED_USERS: validAddress,
            OAUTH_ALLOW_ALL: 'false',
            ENCRYPTION_KEY: 'master-key'
        };
        mockedRepoInstance.isEmergencyConfirmed.mockResolvedValue(true);
        authService = new Web3WalletAuthService(mockEnv);
    });

    describe('Happy Paths (正常路径)', () => {
        it('should generate a secure nonce (Point 8)', async () => {
            const options = await authService.generateAuthenticationOptions();
            expect(options.nonce).toBeDefined();
            expect(typeof options.nonce).toBe('string');
            expect(options.nonce.length).toBeGreaterThan(10);
        });

        it('should verify valid signature and return token (Point 9 & 11)', async () => {
            const message = `Please sign this message to login.
Nonce: ${validNonce}`;

            const result = await authService.verifyAuthenticationResponse(
                validAddress,
                message,
                'valid-signature',
                validNonce,
                '127.0.0.1',
                'TestAgent'
            );

            expect(result.token).toBe('mock-token');
            expect(result.deviceKey).toBe('mock-device-key');
            expect(result.userInfo.id).toBe(validAddress);
            expect(result.userInfo.provider).toBe('web3');
        });

        it('should allow login if address in whitelist (Point 10)', async () => {
            // Because validAddress is passed in mockEnv.OAUTH_ALLOWED_USERS inside beforeEach
            const message = `Nonce: ${validNonce}`;
            const result = await authService.verifyAuthenticationResponse(
                validAddress, message, 'valid-signature', validNonce, '127.0.0.1', 'TestAgent'
            );
            expect(result.token).toBe('mock-token');
        });

        it('should return needsEmergency if emergency not confirmed (Point 7/9)', async () => {
            mockedRepoInstance.isEmergencyConfirmed.mockResolvedValue(false);
            const message = `Nonce: ${validNonce}`;
            const result = await authService.verifyAuthenticationResponse(
                validAddress, message, 'valid-signature', validNonce, '::1', 'UserAgent'
            );
            expect(result.needsEmergency).toBe(true);
            expect(result.encryptionKey).toBe('master-key');
        });
    });

    describe('Edge Cases / Error Paths (异常路径)', () => {
        it('should fail if expectedNonce is missing (Point 7)', async () => {
            const message = `Nonce: ${validNonce}`;
            await expect(authService.verifyAuthenticationResponse(
                validAddress, message, 'valid-signature', '', '127.0.0.1', 'Agent'
            )).rejects.toThrow('web3_nonce_missing');
        });

        it('should fail if message does not contain the nonce (Point 8 - Anti-replay)', async () => {
            const message = 'I am signing this random old message. Nonce: outdated-nonce-xxx';
            await expect(authService.verifyAuthenticationResponse(
                validAddress, message, 'valid-signature', 'fresh-nonce-yyy', '127.0.0.1', 'Agent'
            )).rejects.toThrow('web3_nonce_mismatch');
        });

        it('should fail if signature is invalid (Point 9)', async () => {
            const message = `Nonce: ${validNonce}`;
            await expect(authService.verifyAuthenticationResponse(
                validAddress, message, 'invalid-signature-123', validNonce, '127.0.0.1', 'Agent'
            )).rejects.toThrow('web3_signature_invalid');
        });

        it('should fail if address is NOT in whitelist (Point 10)', async () => {
            mockEnv.OAUTH_ALLOWED_USERS = ''; // Clear whitelist completely
            const intrudingAddress = '0x99999999999999';
            // Valid signature mechanism, but whitelist rejects
            const message = `Nonce: ${validNonce}`;
            await expect(authService.verifyAuthenticationResponse(
                intrudingAddress, message, 'valid-signature', validNonce, '127.0.0.1', 'Agent'
            )).rejects.toThrow('not_whitelisted');
        });

        it('should throw unauthorized_user when whitelist format exists but no match', async () => {
            mockEnv.OAUTH_ALLOWED_USERS = '0xabcd, bob@example.com';
            const intrudingAddress = '0xffffffffff';
            const message = `Nonce: ${validNonce}`;
            await expect(authService.verifyAuthenticationResponse(
                intrudingAddress, message, 'valid-signature', validNonce, '127.0.0.1', 'Agent'
            )).rejects.toThrow('unauthorized_user');
        });
    });
});
