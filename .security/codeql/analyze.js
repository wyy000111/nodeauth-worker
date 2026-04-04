const fs = require('fs');
const path = require('path');

/**
 * NodeAuth CodeQL Report Parser (Focused)
 * 仅输出 "警告 (Warning)" 以上级别的安全审计报告
 */

function generateReport(target) {
    const reportPath = path.join(__dirname, '../result', `codeql-${target}.sarif`);

    if (!fs.existsSync(reportPath)) {
        console.error(`\n❌ 找不到审计报告: ${reportPath}`);
        return;
    }

    try {
        const sarif = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        let errorCount = 0;
        let warningCount = 0;
        const findings = [];

        for (const run of sarif.runs || []) {
            for (const result of run.results || []) {
                const level = result.level || 'warning';

                // 仅收集 Warning 和 Error 级别
                if (level === 'error' || level === 'warning') {
                    if (level === 'error') errorCount++;
                    if (level === 'warning') warningCount++;

                    const loc = (result.locations && result.locations[0]?.physicalLocation) || {};
                    findings.push({
                        ruleId: result.ruleId,
                        level: level,
                        path: loc.artifactLocation?.uri || 'Unknown',
                        line: loc.region?.startLine || '-',
                        message: result.message?.text || 'No description provided'
                    });
                }
            }
        }

        console.log(`\n==================================================`);
        console.log(`🛡️  NodeAuth 深度安全审计简报 [${target.toUpperCase()}]`);
        console.log(`==================================================`);
        console.log(`🔴 致命漏洞 (Error):   ${errorCount}`);
        console.log(`🟠 风险警告 (Warning): ${warningCount}`);
        console.log(`--------------------------------------------------`);

        const totalCritical = errorCount + warningCount;

        if (totalCritical > 0) {
            findings.forEach((f, index) => {
                const icon = f.level === 'error' ? '🔴' : '🟠';
                console.log(`${index + 1}. ${icon} [${f.level.toUpperCase()}] ${f.ruleId}`);
                console.log(`   位置: ${f.path}:${f.line}`);
                console.log(`   描述: ${f.message.split('\n')[0]}`);
                console.log(`--------------------------------------------------`);
            });
        } else {
            console.log('✅ 审计通过：未发现“警告”级别以上的安全隐患。');
        }

        console.log(`📝 完整数据见: .security/result/codeql-${target}.sarif`);

    } catch (e) {
        console.error(`\n❌ 解析 SARIF 报告失败: ${e.message}`);
    }
}

module.exports = generateReport;

if (require.main === module) {
    generateReport(process.argv[2] || 'backend');
}
