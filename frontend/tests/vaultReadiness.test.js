import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useVaultStore } from '@/features/vault/store/vaultStore';
import { useOfflineReadiness } from '@/features/settings/composables/useOfflineReadiness';

// 🤖 Mock IDB
let mockIdb = {};
vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn(async (k) => mockIdb[k]),
    setIdbItem: vi.fn(async (k, v) => { mockIdb[k] = v; return true; }),
}));

// 🤖 Mock AppLock
vi.mock('@/features/applock/store/appLockStore', () => ({
    useAppLockStore: () => ({ getDeviceKey: vi.fn().mockResolvedValue('key-123') })
}));

// 🤖 Mock Crypto
vi.mock('@/shared/utils/crypto', () => ({
    encryptDataWithPassword: vi.fn().mockResolvedValue('encrypted'),
    decryptDataWithPassword: vi.fn().mockResolvedValue({ vault: [] })
}));

describe('Vault Metadata & Readiness - 架构级对账回归测试', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mockIdb = {};
        vi.clearAllMocks();
    });

    describe('vaultStore.updateMetadata', () => {
        it('应该能正确处理 Delta 增量补偿 (维持雷达 100%)', async () => {
            const store = useVaultStore();

            // 初始状态：100/100
            mockIdb['vault:meta:server_total'] = 100;
            mockIdb['vault:meta:local_count'] = 100;

            // 执行删除补偿 (-5)
            await store.updateMetadata({ delta: -5, localCount: 95 });

            expect(mockIdb['vault:meta:server_total']).toBe(95);
            expect(mockIdb['vault:meta:local_count']).toBe(95);
        });

        it('应该能正确处理强制校准 (serverTotal)', async () => {
            const store = useVaultStore();
            await store.updateMetadata({ serverTotal: 500 });
            expect(mockIdb['vault:meta:server_total']).toBe(500);
        });
    });

    describe('useOfflineReadiness 逻辑审计', () => {
        it('【空总数陷阱修复】：当 server_total 为 0 时，即便本地有数据也不应报 100%', async () => {
            const { checkAll, status } = useOfflineReadiness();

            // 模拟：本地抓到了 15 条，但还没抓到服务器总量
            mockIdb['vault:meta:local_count'] = 15;
            mockIdb['vault:meta:server_total'] = 0;

            await checkAll(true);

            // 预期结果：不再报 100%，而是报 0% (或者 1500% 分母保护后的值)
            // 现在的逻辑是 isAccountsReady = serverTotal > 0 && ...
            expect(status.value.accounts).toBe(0);
        });

        it('【严格对账判定】：当且仅当 localCount === serverTotal 且 serverTotal > 0 时报 100%', async () => {
            const { checkAll, status } = useOfflineReadiness();

            mockIdb['vault:meta:local_count'] = 100;
            mockIdb['vault:meta:server_total'] = 100;

            await checkAll(true);
            expect(status.value.accounts).toBe(100);
        });

        it('【溢出防御判定】：若分子 > 分母 (不一致状态)，不应报 100%，最高封顶 99%', async () => {
            const { checkAll, status } = useOfflineReadiness();

            // 模拟 442/440 异常状态
            mockIdb['vault:meta:local_count'] = 442;
            mockIdb['vault:meta:server_total'] = 440;

            await checkAll(true);

            // 预期：不就绪，封顶 99 (或按比例计算后的封顶值)
            expect(status.value.accounts).toBeLessThan(100);
            expect(status.value.accounts).toBe(99);
        });
    });
});
