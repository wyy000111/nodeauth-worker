const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const LOCAL_BIN = path.join(__dirname, '../bin/trivy');

console.log('🛡️ [Trivy] 启动容器配置与镜像扫描...');
try {
    // 优先使用本地 bin 目录下的引擎
    const cmd = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'trivy';
    const resultDir = path.resolve(__dirname, '../result');
    if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

    // 增加 --output 指向统一结果目录
    const reportPath = path.join(resultDir, 'trivy-results.json');
    execSync(`${cmd} config . --format json --output "${reportPath}" --config .security/trivy/trivy.yaml`, { stdio: 'inherit' });
    console.log(`\n✅ 基础设施配置审计完成。报告导出至: ${reportPath}`);
} catch (e) {
    if (e.status === 127) {
        console.error('\n❌ 找不到 trivy 扫描引擎！');
        console.log('💡 请先运行: npm run security:update');
    } else {
        console.error('\n❌ Trivy 发现容器配置中存在高风险项。');
    }
    process.exit(1);
}
