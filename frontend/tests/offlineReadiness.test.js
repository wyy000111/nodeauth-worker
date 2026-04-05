import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { OFFLINE_RESOURCES } from '@/shared/services/offlineRegistry';

// 🚨 业务存储 Mock
vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: () => ({
        saveData: vi.fn().mockResolvedValue(true),
        getData: vi.fn().mockResolvedValue({ vault: [], categoryStats: [] })
    })
}));

const mockSyncStore = {
    syncQueue: [],
    enqueueAction: vi.fn(),
    enqueueActions: vi.fn()
};

vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: () => mockSyncStore
}));

vi.mock('@/features/auth/store/authUserStore', () => ({
    useAuthUserStore: () => ({ fetchUserInfo: vi.fn().mockResolvedValue({ id: 1 }) })
}));

vi.mock('@/features/vault/service/vaultService', () => ({
    vaultService: { getVault: vi.fn().mockResolvedValue({ success: true, pagination: { totalItems: 0 } }) }
}));

vi.mock('@/features/applock/store/appLockStore', () => ({
    useAppLockStore: () => ({ getDeviceKey: vi.fn().mockResolvedValue('key-123') })
}));

let mockIdb = {};
vi.mock('@/shared/utils/idb', () => {
    return {
        getIdbItem: vi.fn().mockImplementation(async (k) => mockIdb[k]),
        setIdbItem: vi.fn().mockImplementation(async (k, v) => { mockIdb[k] = v; return true; }),
        __clearMockIdb: () => { mockIdb = {}; }
    };
});

vi.mock('element-plus', () => ({
    ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}));

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k } }
}));

describe('Offline Readiness - Red/Green TDD coverage', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();

        mockIdb = {};

        global.caches = {
            open: vi.fn().mockImplementation(async (name) => ({
                match: vi.fn().mockResolvedValue(null),
                keys: vi.fn().mockResolvedValue([
                    { url: 'http://localhost/index.html' },
                    { url: 'http://localhost/pwa-192.png' }
                ]),
                put: vi.fn().mockResolvedValue(true)
            })),
            keys: vi.fn().mockResolvedValue(['main-cache']),
            match: vi.fn().mockResolvedValue(null)
        };

        global.fetch = vi.fn().mockImplementation(async () => ({
            ok: true,
            status: 200,
            headers: new Map([['Content-Length', '1000']]),
            json: async () => ({ success: true, pagination: { totalItems: 1 }, vault: [{ id: 1 }] }),
            body: {
                getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: true }) })
            }
        }));

        global.navigator.serviceWorker = {
            getRegistration: vi.fn().mockResolvedValue({ update: vi.fn() })
        };

        vi.stubGlobal('location', { hostname: 'nodeauth.io' });
    });

    // 🟢 HP-1: 动态工具真理性标识
    it('HP-1: should mark runtime-loaded resources with __VERIFIED_RUNTIME__ instead of guessing physical URLs', async () => {
        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { downloadResources } = useOfflineReadiness();

        await downloadResources();

        const { getIdbItem } = await import('@/shared/utils/idb');
        const verifiedPaths = await getIdbItem('offline:verified_paths');

        expect(verifiedPaths['qrcode']).toBe('__VERIFIED_RUNTIME__');
        expect(verifiedPaths['jsqr']).toBe('__VERIFIED_RUNTIME__');
    });

    // 🟢 HP-2: 信任标记满分扫描
    it('HP-2: checkAll should grant 100% based purely on __VERIFIED_RUNTIME__ mark, bypassing URL probe guessing', async () => {
        const { setIdbItem } = await import('@/shared/utils/idb');
        // Force fully verified IDB, but caches are empty of these libs!
        await setIdbItem('offline:verified_paths', {
            'qrcode': '__VERIFIED_RUNTIME__',
            'jsqr': '__VERIFIED_RUNTIME__',
            'fflate': '__VERIFIED_RUNTIME__',
            'openpgp': '__VERIFIED_RUNTIME__',
            'libsodium': '__VERIFIED_RUNTIME__',
            'hash-wasm': '__VERIFIED_RUNTIME__'
        });

        // Ensure engine is manually injected to physical cache (as WASM loads directly)
        global.caches.open = vi.fn().mockImplementation(async () => ({
            keys: vi.fn().mockResolvedValue([
                { url: 'http://localhost/argon2.wasm' },
                { url: 'http://localhost/sql-wasm.wasm' },
                { url: 'http://localhost/index.html' },
                { url: 'http://localhost/pwa-192.png' },
                { url: 'http://localhost/font.woff2' }
            ]),
            match: vi.fn()
        }));

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { checkAll, status } = useOfflineReadiness();

        await checkAll(true);
        expect(status.value.assets).toBe(100);
    });

    // 🟢 HP-4: 无感知已加载组件判定 (Concurrency/Already-Loaded safety)
    it('HP-4: should accurately record __VERIFIED_RUNTIME__ even when imports trace no network activity (simulate already-in-memory)', async () => {
        // We override the loader to simulate synchronous instant return
        const originalLoader = OFFLINE_RESOURCES.UTILITIES[0].loader;
        OFFLINE_RESOURCES.UTILITIES[0].loader = vi.fn().mockResolvedValue(true);

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { downloadResources } = useOfflineReadiness();

        await downloadResources();

        const { getIdbItem } = await import('@/shared/utils/idb');
        const verifiedPaths = await getIdbItem('offline:verified_paths');
        expect(verifiedPaths['qrcode']).toBe('__VERIFIED_RUNTIME__'); // Safely verified

        OFFLINE_RESOURCES.UTILITIES[0].loader = originalLoader; // Cleanup
    });

    // 🟢 HP-5: 后备探针扫描降级
    it('HP-5: checkAll should fallback to regex probes if IDB mark is missing', async () => {
        const { setIdbItem } = await import('@/shared/utils/idb');
        await setIdbItem('offline:verified_paths', {}); // Empty IDB

        // But Cache contains matching signatures
        global.caches.open = vi.fn().mockImplementation(async () => ({
            keys: vi.fn().mockResolvedValue([
                { url: 'http://localhost/assets/qrparser.hash.js' } // matches 'qrparser'
            ])
        }));

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { checkAll, status } = useOfflineReadiness();

        await checkAll(true);
        // qrcode and jsqr both probe for 'qrparser' -> they will be found. 
        // 2/3 utilities = 33/50 points for utils. Total assets will be > 10.
        expect(status.value.assets).toBeGreaterThanOrEqual(33);
    });

    // 🔴 EC-1: 废除伪造进度修补
    it('EC-1: downloadResources should NOT force assets=100 if scanner genuinely failed (no false UI 100%)', async () => {
        // Force everything to heavily fail
        OFFLINE_RESOURCES.UTILITIES[0].loader = vi.fn().mockRejectedValue(new Error('Network error'));

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { downloadResources, status } = useOfflineReadiness();

        await downloadResources();

        // Because qrcode failed to load, assets should NEVER be falsely pushed to 100
        expect(status.value.assets).toBeLessThan(100);
    });

    // 🔴 EC-2: 网络物理断开后的抛错
    it('EC-2: should cleanly skip setting mark and emit ElMessage error if network module load fails', async () => {
        OFFLINE_RESOURCES.SECURITY[0].loader = vi.fn().mockRejectedValue(new Error('Network disconnected'));

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { downloadResources } = useOfflineReadiness();

        await downloadResources();

        const { getIdbItem } = await import('@/shared/utils/idb');
        const verifiedPaths = await getIdbItem('offline:verified_paths');
        expect(verifiedPaths['openpgp']).toBeUndefined(); // Should not be verified

        const { ElMessage } = await import('element-plus');
        expect(ElMessage.error).toHaveBeenCalled();
    });

    // 🔴 EC-3: 不安全环境(Http)下的沙箱熔断
    it('EC-3: should refuse to download in an insecure context (HTTP without localhost)', async () => {
        const originalCaches = global.caches;
        delete global.caches; // Simulate Http context

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { downloadResources } = useOfflineReadiness();

        await downloadResources();

        const { ElMessage } = await import('element-plus');
        expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('security.insecure_context_blocked'));

        global.caches = originalCaches;
    });

    // 🔴 EC-4: CSS 字库重构后的隐形自适应
    it('EC-4: should automatically grant 100% Font score if no .woff2 styles found', async () => {
        global.caches.open = vi.fn().mockImplementation(async () => ({ keys: vi.fn().mockResolvedValue([]) }));

        const originalStyleSheets = Object.getOwnPropertyDescriptor(Document.prototype, 'styleSheets');
        Object.defineProperty(document, 'styleSheets', { get: () => [], configurable: true });

        const { useOfflineReadiness } = await import('@/features/settings/composables/useOfflineReadiness');
        const { checkAll, status } = useOfflineReadiness();

        await checkAll(true);
        // Fonts automatically satisfied (10 points). Icons=0, Utils=0. Total = 10.
        expect(status.value.assets).toBe(10);

        if (originalStyleSheets) Object.defineProperty(document, 'styleSheets', originalStyleSheets);
    });
});
