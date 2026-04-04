const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * NodeAuth CodeQL Controller (Integrated & Enhanced)
 * 具备自动下载全球安全特征库的能力
 */

const action = process.argv[2];
const baseDir = path.resolve(__dirname, '../../');
const binDir = path.resolve(__dirname, '../bin');
const LOCAL_BIN = path.join(binDir, 'codeql/codeql');
const packagesDir = path.join(binDir, 'codeql/packages');

// 首次运行或更新时，需要下载特征包
async function ensurePacks() {
    const cmd = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'codeql';
    if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });

    console.log('📡 [CodeQL] 正在检查并同步安全特征库 (security-extended, security-and-quality)...');
    try {
        // 下载 JavaScript 核心查询包
        execSync(`${cmd} pack download codeql/javascript-queries codeql/javascript-all --dir "${packagesDir}"`, { stdio: 'inherit' });
        console.log('✅ 特征库同步完成。');
    } catch (e) {
        console.error('⚠️  特征库下载失败，将尝试使用内置默认查询。');
    }
}

async function runScan(target) {
    const outputBase = path.join(__dirname, 'output');
    const resultDir = path.resolve(baseDir, '.security/result');

    if (!fs.existsSync(outputBase)) fs.mkdirSync(outputBase, { recursive: true });
    if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

    const dbPath = path.join(outputBase, `${target}-db`);
    const reportPath = path.join(resultDir, `codeql-${target}.sarif`);
    const sourceRoot = path.join(baseDir, target);

    console.log(`\n🚀 [CodeQL] 开始审计目标: ${target.toUpperCase()} ...`);
    const cmd = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'codeql';

    try {
        // A. 构建数据库 (加回关键的 codescanning-config 排除规则)
        console.log('🏗️  正在构建扫描快照 (Database create)...');
        const configFile = path.join(__dirname, `${target}-config.yml`);
        const configFlag = fs.existsSync(configFile) ? `--codescanning-config="${configFile}"` : '';

        execSync(`${cmd} database create "${dbPath}" --language=javascript-typescript --source-root="${sourceRoot}" ${configFlag} --overwrite`, { stdio: 'inherit' });

        // B. 执行全量分析 (包含 security-extended 和 security-and-quality)
        console.log('🔍 正在运行深层漏洞引擎 (Analyze with Extended Suites)...');

        // 动态查找已下载的特征包路径
        const findSuitesCmd = `find "${packagesDir}" -name "javascript-security-extended.qls" -o -name "javascript-security-and-quality.qls"`;
        const foundSuites = execSync(findSuitesCmd).toString().trim().split('\n').filter(s => s);

        if (foundSuites.length > 0) {
            console.log(`📡 正在加载特征库: \n${foundSuites.map(s => '   - ' + path.basename(s)).join('\n')}`);
            execSync(`${cmd} database analyze "${dbPath}" ${foundSuites.map(s => `"${s}"`).join(' ')} --format=sarif-latest --output="${reportPath}" --ram=4096 --threads=0`, { stdio: 'inherit' });
        } else {
            console.warn('⚠️  未在本地找到下载的特征库，降级运行内置默认分析...');
            execSync(`${cmd} database analyze "${dbPath}" javascript-security-and-quality.qls --format=sarif-latest --output="${reportPath}" --ram=4096 --threads=0`, { stdio: 'inherit' });
        }

        // C. 导出简报 (调用刚才重构的 analyze.js)
        console.log('\n📊 正在解析扫描结果并生成简报...');
        const generateReport = require('./analyze.js');
        generateReport(target);

        console.log(`\n📊 ${target.toUpperCase()} 审计完成。完整报告已导出至: ${reportPath}`);
    } catch (error) {
        console.error(`\n⚠️  ${target} 审计中断，请检查代码结构或配置:`, error.message);
    }
}

// 主逻辑执行
(async () => {
    // 自动触发一次包检查
    if (!fs.existsSync(path.join(packagesDir, 'codeql'))) {
        await ensurePacks();
    }

    if (!['frontend', 'backend'].includes(action)) {
        await runScan('backend');
        await runScan('frontend');
    } else {
        await runScan(action);
    }
})();
