import * as esbuild from 'esbuild';

/**
 * NodeAuth Docker 构建配置 (ESM)
 * 目标：在保持 ESM 高性能的基础上，无缝兼容 CommonJS 依赖。
 */

const bannerTemplate = `
/**
 * NodeAuth ESM Compatibility Shim
 * 作用：还原 ESM 环境下缺失的 CMS 全局变量 (__dirname, require 等)
 */
import { createRequire as _createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _dirnamePath } from 'path';

const require = _createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _dirnamePath(__filename);
`.trim();

console.log('🚀 Starting Universal DB Architecture Build [Docker Edition]...');

try {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.CI === 'true';

    await esbuild.build({
        entryPoints: ['./src/app/server.ts'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: './dist/server.js',
        logLevel: 'info',
        banner: {
            js: bannerTemplate,
        },
        // 排除原生模块以及特定数据库驱动，确保这些模块能从 Docker 环境安装的原生 bindings 中加载
        external: [
            'better-sqlite3',
            'nodemailer',
            'cloudflare:sockets',
            'pg',
            'mysql2'
        ],
        minify: isProduction,
        sourcemap: true,
        // 确保运行时动态读取环境变量，不进行预替换
        define: {
            'process.env.NODE_ENV': isProduction ? '"production"' : '"development"'
        }
    });
    console.log(`✅ Build Success: dist/server.js is ready for ${isProduction ? 'production' : 'development'}.`);
} catch (e) {
    console.error('❌ Build Failed:', e);
    process.exit(1);
}
