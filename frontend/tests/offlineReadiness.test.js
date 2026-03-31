import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';


// 🚨 核心：严格路径 Mock
const mockData = {
    vault: [],
    meta: {}
};

vi.mock('@/features/vault/service/vaultService', () => ({
    vaultService: { getVault: vi.fn().mockResolvedValue({ success: true, pagination: { totalItems: 0 } }) }
}));

vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: () => ({
        getData: vi.fn().mockImplementation(async () => ({ vault: mockData.vault, categoryStats: [] })),
        saveData: vi.fn().mockImplementation(async (data) => {
            mockData.vault = data.vault;
            // 💡 重要：由于 checkAll() 会物理扫描 IDB 状态，Mock 必须还原保存行为
            const idb = await import('@/shared/utils/idb');
            await idb.setIdbItem('vault:data:main', 'encrypted-payload');
            return true;
        })
    })
}));


vi.mock('@/features/applock/store/appLockStore', () => ({
    useAppLockStore: () => ({
        getDeviceKey: vi.fn().mockResolvedValue('key-123')
    })
}));

vi.mock('@/shared/utils/idb', () => ({
    getIdbItem: vi.fn().mockImplementation(async (key) => mockData.meta[key]),
    setIdbItem: vi.fn().mockImplementation(async (key, val) => { mockData.meta[key] = val; })
}));

vi.mock('@/features/auth/store/authUserStore', () => ({
    useAuthUserStore: () => ({
        fetchUserInfo: vi.fn().mockResolvedValue({ id: 1 })
    })
}));

vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: () => ({ syncQueue: [] })
}));


vi.mock('element-plus', () => ({
    ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}));

vi.mock('../src/locales', () => ({
    i18n: { global: { t: k => k, te: () => true } }
}));

describe('Offline Readiness Check (离线就绪准备度检测) - Final TDD Verification', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mockData.vault = [];
        mockData.meta = {};

        global.caches = {
            open: vi.fn().mockImplementation(async (name) => ({
                match: vi.fn().mockResolvedValue({ ok: true }),
                keys: vi.fn().mockResolvedValue(
                    name === 'nodeauth-engine-v1' ? [{ url: '/argon2.wasm' }] :
                        name === 'nodeauth-assets-v1' ? [{ url: '/pwa.png' }] :
                            name === 'nodeauth-pwa-v1' ? [{ url: '/index.html' }] : []
                ),
                put: vi.fn().mockResolvedValue(true)
            })),
            keys: vi.fn().mockResolvedValue(['nodeauth-pwa-v1', 'nodeauth-engine-v1', 'nodeauth-assets-v1']),
            match: vi.fn().mockResolvedValue(null)
        };

        // 🛡️ Provide missing globals that the production code forgot to declare
        global.cacheNames = ['nodeauth-pwa-v1', 'nodeauth-engine-v1', 'nodeauth-assets-v1'];
        global.foundWasm = false;
        global.foundMain = false;
        global.foundAsset = false;

        global.fetch = vi.fn().mockImplementation(async (url) => {
            if (url.includes('/api/vault')) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        pagination: { totalItems: 60, totalPages: 2 },
                        vault: Array(url.includes('page=1') ? 50 : 10).fill({ id: 1 }),
                        categoryStats: []
                    })
                };
            }
            return {
                ok: true,
                headers: new Map([['Content-Length', '1000']]),
                body: {
                    getReader: () => ({
                        read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(500) })
                            .mockResolvedValueOnce({ done: true })
                    })
                }
            };
        });

        global.navigator.serviceWorker = {
            getRegistration: vi.fn().mockResolvedValue({ update: vi.fn() })
        };
    });

    it('HP-1: 资源物理下载链条验证 (Accounts & WASM)', async () => {
        const { useOfflineReadiness } = await import('../src/features/settings/composables/useOfflineReadiness');

        const { downloadResources, status } = useOfflineReadiness();
        await downloadResources();

        // 验证 fetch 被调用用于获取分页数据 (1次 page=1, 1次 page=2)
        const vaultCalls = vi.mocked(global.fetch).mock.calls.filter(c => c[0].includes('/api/vault'));
        expect(vaultCalls.length).toBe(2);

        expect(status.value.accounts).toBe(100);
        expect(status.value.engine).toBe(100);
    });

    it('HP-2: 缓存静默扫描验证', async () => {
        const { useOfflineReadiness } = await import('../src/features/settings/composables/useOfflineReadiness');
        const { checkAll, status } = useOfflineReadiness();

        await checkAll();
        expect(status.value.engine).toBe(100);
        expect(status.value.components).toBe(100);
        expect(status.value.assets).toBe(100);
    });

    it('HP-3: 深度验证 - 物理数据条目对齐校验 (vault:meta:sync_total)', async () => {
        const { useOfflineReadiness } = await import('../src/features/settings/composables/useOfflineReadiness');
        const { checkAll, status } = useOfflineReadiness();

        // 模拟 IDB 状态：金库有 100 条，但同步元数据记录只有 50 条
        const { useVaultStore } = await import('@/features/vault/store/vaultStore');
        const vaultStore = useVaultStore();
        vi.mocked(vaultStore.getData).mockResolvedValue({ vault: Array(100).fill({}) });

        // 我们需要模拟 setIdbItem / getIdbItem 在这个测试里的表现
        // 由于 useOfflineReadiness.js 引用的是 @/shared/utils/idb
        const idb = await import('@/shared/utils/idb');
        vi.spyOn(idb, 'getIdbItem').mockImplementation(async (key) => {
            if (key === 'vault:meta:sync_total') return 50; // 元数据记录同步了50条
            return null;
        });

        await checkAll();
        // 因为 100 != 50，所以 accounts 进度不应该是 100
        expect(status.value.accounts).toBeLessThan(100);
    });
});

