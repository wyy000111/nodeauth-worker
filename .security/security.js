const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * NodeAuth Security Gateway (Local Engine)
 * Ultra-Stable Tool Installer logic
 */

const action = process.argv[2];
const baseDir = __dirname;
const binDir = path.join(baseDir, 'bin');

if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
}

if (action === 'update') {
    console.log('📡 [Security Engine] 正在启动强制同步模式...');

    // 工具配置定义 (Updated to latest stable versions)
    const toolkits = [
        {
            name: 'Gitleaks',
            url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz',
            file: 'gitleaks',
            version: '8.30.1',
            type: 'tar'
        },
        {
            name: 'Trivy',
            url: 'https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_Linux-64bit.tar.gz',
            file: 'trivy',
            version: '0.69.3',
            type: 'tar'
        },
        {
            name: 'Snyk',
            url: 'https://static.snyk.io/cli/v1.1303.2/snyk-linux',
            file: 'snyk',
            version: '1.1303.2',
            type: 'binary'
        },
        {
            name: 'CodeQL',
            url: 'https://github.com/github/codeql-cli-binaries/releases/download/v2.25.1/codeql-linux64.zip',
            file: 'codeql',
            version: '2.25.1',
            type: 'zip'
        }
    ];

    toolkits.forEach(tool => {
        const targetPath = path.join(binDir, tool.file);

        // Simple version tracking
        const versionFile = path.join(binDir, `.${tool.file}.version`);
        const currentVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '';

        if (fs.existsSync(targetPath) && currentVersion === tool.version) {
            console.log(`✅ ${tool.name} 引擎 (v${tool.version}) 已安装，跳过。`);
            return;
        }

        console.log(`⬇️  正在下载 ${tool.name} v${tool.version}...`);
        const tempFile = path.join('/tmp', `nodeauth_${tool.file}_dl`);

        try {
            // 第一步：下载
            execSync(`curl -sfL -o "${tempFile}" "${tool.url}"`, { stdio: 'inherit' });

            // 第二步：部署
            if (tool.type === 'tar') {
                console.log(`📦 正在解压并部署 ${tool.name}...`);
                execSync(`tar -xmzf "${tempFile}" -C "${binDir}" ${tool.file}`, { stdio: 'inherit' });
            } else if (tool.type === 'zip') {
                console.log(`📦 正在解压并部署 ${tool.name} (Zip)...`);
                if (fs.existsSync(targetPath)) execSync(`rm -rf "${targetPath}"`);
                execSync(`unzip -q "${tempFile}" -d "${binDir}"`, { stdio: 'inherit' });
            } else {
                console.log(`📂 正在部署 ${tool.name} 二进制文件...`);
                fs.copyFileSync(tempFile, targetPath);
            }

            // 第三步：赋权与版本锁定
            const binaryPath = tool.type === 'zip' ? path.join(targetPath, 'codeql/codeql') : targetPath;
            if (fs.existsSync(binaryPath)) {
                execSync(`chmod +x "${binaryPath}"`);
            }
            fs.writeFileSync(versionFile, tool.version);
            console.log(`✨ ${tool.name} v${tool.version} 部署成功！`);

            // 清理
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (e) {
            console.error(`\n❌ ${tool.name} 同步失败。`);
            console.error(`💡 建议手动操作: curl -L ${tool.url} -o ${targetPath}`);
        }
    });

    console.log('\n✅ 审计工具箱已就绪。');
    process.exit(0);
}

// 路由逻辑
const runTool = (name, args = []) => {
    const script = path.join(baseDir, name, 'scan.js');
    try {
        console.log(`\n▶️  正在调用: ${name.toUpperCase()} ${args.join(' ')} ...`);
        const argsStr = args.map(a => `"${a}"`).join(' ');
        execSync(`node "${script}" ${argsStr}`, { stdio: 'inherit' });
    } catch (e) { }
};

const extraArgs = process.argv.slice(3);

switch (action) {
    case 'secrets': runTool('gitleaks', extraArgs); break;
    case 'snyk': runTool('snyk', extraArgs); break;
    case 'docker': runTool('trivy', extraArgs); break;
    case 'codeql': runTool('codeql', extraArgs); break;
    case 'scan':
        console.log('🛡️  启动全量深度安全审计...\n');
        runTool('gitleaks');
        runTool('snyk');
        runTool('trivy');
        runTool('codeql');
        break;
    default:
        console.log('Usage: npm run security:[secrets|snyk|docker|scan|update]');
}
