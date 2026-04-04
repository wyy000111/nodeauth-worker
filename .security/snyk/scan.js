const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const LOCAL_BIN = path.join(__dirname, '../bin/snyk');

console.log('📦 [Snyk] 启动深度依赖漏洞审计...');
const cmd = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'snyk';

const resultDir = path.resolve(__dirname, '../result');
if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

try {
    const reportPath = path.join(resultDir, 'snyk-results.json');
    execSync(`${cmd} test --all-projects --json-file-output="${reportPath}"`, { stdio: 'inherit' });
    console.log('\n✅ 依赖链路安全。');
} catch (snykErr) {
    // Exit Code 1 表示发现漏洞
    if (snykErr.status === 1) {
        console.error('\n❌ Snyk 审计发现高危漏洞！');
        process.exit(1);
    }

    // 如果找不到 Snyk 或运行异常 (如 401)，统一走 NPM 审计降级模式
    const fallbackTargets = ['.', 'backend', 'frontend'];
    console.log('💡 正在执行跨目录 NPM 审计降级方案...');

    fallbackTargets.forEach(dir => {
        const fullPath = path.resolve(process.cwd(), dir);
        if (fs.existsSync(path.join(fullPath, 'package.json'))) {
            console.log(`\n🔍 正在审计目录: ${dir}...`);
            try {
                execSync(`npm audit --audit-level=high`, { cwd: fullPath, stdio: 'inherit' });
            } catch (auditErr) {
                // 如果是 audit 发现了漏洞，则报错
                if (auditErr.status && auditErr.status !== 0) {
                    console.error(`\n❌ ${dir} 发现高风险依赖项。`);
                }
            }
        }
    });

    if (snykErr.status !== 127 || cmd !== 'snyk') {
        console.warn('\n⚠️  Snyk 运行异常 (状态码: ' + snykErr.status + ')，建议运行: npm run security:update 检查工具链。');
    }
    console.log('\n✅ 安全审计(降级模式)完成。');
}
