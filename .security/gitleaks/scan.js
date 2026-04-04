const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCAL_BIN = path.join(__dirname, '../bin/gitleaks');

console.log('🛡️ [Gitleaks] 启动精准源码审计 (物理级绕过临时目录)...');

const targets = ['backend', 'frontend/src'];
const resultDir = path.resolve(__dirname, '../result');
if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });
const reportPath = path.join(resultDir, 'gitleaks-results.json');

// 1. 清理旧报告
if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);

let totalFindings = 0;

try {
    const cmd = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'gitleaks';

    targets.forEach(target => {
        const sourcePath = path.resolve(__dirname, '../../', target);
        if (!fs.existsSync(sourcePath)) return;

        console.log(`🔍 正在扫描源码模块: ${target} ...`);
        const moduleReport = path.join(resultDir, `gitleaks-${target.replace('/', '-')}.json`);
        const ignoreFile = path.join(__dirname, '.gitleaksignore');

        try {
            execSync(`${cmd} detect --source="${sourcePath}" --gitleaks-ignore-path "${ignoreFile}" --report-path="${moduleReport}" --redact --verbose`, { stdio: 'inherit' });
        } catch (e) {
            totalFindings++;
        }
    });

    if (totalFindings === 0) {
        console.log('\n✅ 审计完成！所有核心源码模块均未发现泄露风险。');
    } else {
        console.error('\n❌ 警报: 在源码中发现潜在的密钥泄露，请核实上方日志！');
        process.exit(1);
    }

} catch (globalErr) {
    console.error('\n❌ 扫描程序执行异常。');
    process.exit(1);
}
