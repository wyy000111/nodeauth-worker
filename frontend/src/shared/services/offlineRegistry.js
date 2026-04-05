/**
 * 🏛️ 中心化离线资源注册表 (Universal Offline Registry)
 * 所有的重型第三方依赖库必须在此注册，以便离线就绪系统自动发现并下载。
 */

export const OFFLINE_RESOURCES = {
    // 🛡️ 安全引擎类 (Security Engines)
    SECURITY: [
        {
            name: 'openpgp',
            loader: () => import('openpgp'),
            probe: 'openpgp'
        },
        {
            name: 'libsodium',
            loader: () => import('libsodium-wrappers-sumo'),
            probe: 'sodium'
        },
        {
            name: 'hash-wasm',
            loader: () => import('hash-wasm'),
            probe: 'hash-wasm'
        }
    ],

    // 🛠️ 迁移与工具类 (Utilities)
    // 💡 Probes 必须包含该库可能置身的 Vite Chunk 名称，以应对“先访问、后下载”场景下的缓存 URL 溯源
    UTILITIES: [
        {
            name: 'qrcode',
            loader: () => import('qrcode'),
            // qrcode 在 Vault Service 和 Web3 登录等广泛使用
            probes: ['qrcode', 'qrparser', 'vaultservice', 'login']
        },
        {
            name: 'jsqr',
            loader: () => import('jsqr'),
            // jsqr 被用于工具箱扫码与数据迁移解析
            probes: ['jsqr', 'qrparser', 'datamigration']
        },
        {
            name: 'fflate',
            loader: () => import('fflate'),
            // fflate 主要用于数据迁移的服务端
            probes: ['fflate', 'pako', 'zlib', 'datamigration']
        }
    ],

    // 🏗️ 算力环境 (Engines - 主要是 WASM)
    ENGINES: [
        { name: 'argon2', url: '/argon2.wasm', probe: 'argon2' },
        { name: 'sqlite', url: '/sql-wasm.wasm', probe: 'sql-wasm' }
    ]
};

/**
 * 🚀 统一加载器：带缓存感知功能的动态导入
 * 其他业务组件应通过此加载器引用重型库。
 */
export async function loadResource(resourceName) {
    // 平铺所有资源进行搜索
    const allResources = [...OFFLINE_RESOURCES.SECURITY, ...OFFLINE_RESOURCES.UTILITIES];
    const resource = allResources.find(r => r.name === resourceName);

    if (!resource || !resource.loader) {
        throw new Error(`Resource '${resourceName}' not found in registry.`);
    }

    return await resource.loader();
}
