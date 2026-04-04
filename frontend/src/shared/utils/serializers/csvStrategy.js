import { parseOtpUri } from '@/shared/utils/totp'

/**
 * CSV 格式迁移解析策略
 */
export const csvStrategy = {
    /**
     * @typedef {Object} VaultItem
     * @property {string} service
     * @property {string} account
     * @property {string} secret
     * @property {string} algorithm
     * @property {number} digits
     * @property {number} period
     * @property {string} category
     */

    /**
     * 解析一行 CSV，正确处理 RFC 4180 引号字段（含引号的字段、内部双引号转义）
     * @param {string} line
     * @returns {string[]}
     */
    _splitCsvLine(line) {
        const fields = []
        let i = 0
        while (i <= line.length) {
            if (i === line.length) { fields.push(''); break }
            if (line[i] === '"') {
                // 引号字段：读取到匹配的结束引号
                let val = ''
                i++ // skip opening quote
                while (i < line.length) {
                    if (line[i] === '"') {
                        if (line[i + 1] === '"') { val += '"'; i += 2 } // 转义的 "" → "
                        else { i++; break } // 结束引号
                    } else {
                        val += line[i++]
                    }
                }
                fields.push(val.trim())
                if (line[i] === ',') i++ // skip comma
            } else {
                // 无引号字段：读取到下一个逗号
                const end = line.indexOf(',', i)
                if (end === -1) { fields.push(line.slice(i).trim()); break }
                fields.push(line.slice(i, end).trim())
                i = end + 1
            }
        }
        return fields
    },

    /**
     * Decode a generic or bitwarden Password CSV string.
     * @param {string} csvText 
     * @returns {VaultItem[]}
     */
    parseCsv(csvText) {
        const lines = csvText.split('\n').filter(line => line.trim())
        if (lines.length < 2) return []

        // 表头同样做去引号处理并小写
        const headers = this._splitCsvLine(lines[0]).map(h => h.toLowerCase())
        const rawVault = []

        // 1. 定义已知格式的列名特征
        const isBitwardenPass = headers.includes('login_totp')
        const isBitwardenAuth = headers.includes('otpauth') && !headers.includes('title')
        const is1Password = headers.includes('otpauth') && headers.includes('title')
        const isProtonPass = headers.includes('totp') && headers.includes('vault') && headers.includes('createtime')
        const isDashlane = headers.includes('otpurl') && headers.includes('title') && headers.includes('username')
        const isGeneric = headers.includes('issuer') || headers.includes('secret') || headers.includes('name')

        // 2. 增强型同义词库（用于识别未知 App 导出的文件）
        const TOTP_SYNONYMS = ['otpauth', 'login_totp', 'totp', 'mfa', 'two_factor_code', 'secret', 'otpurl', 'nodeauth', 'authenticator']
        const NAME_SYNONYMS = ['name', 'title', 'item name', 'issuer', 'label']
        const USER_SYNONYMS = ['username', 'login', 'login_username', 'account', 'email']

        // 3. 辅助函数：清洗密钥内容
        const cleanSecret = (str) => {
            if (!str) return ''
            return str.toString().trim().replace(/[\s-]/g, '').toUpperCase()
        }

        // 如果连通用识别都不过，且没有同义词表头，则返回
        const hasAnyTotpHeader = headers.some(h => TOTP_SYNONYMS.includes(h))
        if (!isBitwardenPass && !isBitwardenAuth && !is1Password && !isProtonPass && !isDashlane && !isGeneric && !hasAnyTotpHeader) return []

        for (let i = 1; i < lines.length; i++) {
            const row = this._splitCsvLine(lines[i])
            const rowData = {}
            headers.forEach((h, index) => { rowData[h] = row[index] || '' })

            // --- 优先级路径：已知 App 格式 ---

            if (is1Password) {
                const totpStr = (rowData['otpauth'] || '').trim()
                if (totpStr && totpStr.startsWith('otpauth://')) {
                    const accData = parseOtpUri(totpStr)
                    if (accData) {
                        accData.service = rowData['title'] || accData.service
                        accData.account = rowData['username'] || accData.account
                        rawVault.push(accData)
                    }
                }
            } else if (isBitwardenPass || isBitwardenAuth) {
                const totpStr = (rowData['login_totp'] || rowData['otpauth'] || rowData['totp'] || '').trim()
                if (totpStr) {
                    let accData = null
                    if (totpStr.startsWith('otpauth://')) {
                        accData = parseOtpUri(totpStr)
                    } else {
                        const secret = cleanSecret(totpStr)
                        const base32Re = /^[A-Z2-7]+=*$/
                        if (base32Re.test(secret)) {
                            accData = {
                                service: rowData['name'] || 'Unknown',
                                account: rowData['login_username'] || 'Unknown',
                                secret: secret,
                                algorithm: 'SHA-1',
                                digits: 6,
                                period: 30,
                                category: ''
                            }
                        }
                    }
                    if (accData) {
                        accData.service = rowData['name'] || accData.service
                        accData.account = rowData['login_username'] || accData.account
                        rawVault.push(accData)
                    }
                }
            } else if (isProtonPass) {
                const totpStr = (rowData['totp'] || '').trim()
                if (totpStr && totpStr.startsWith('otpauth://')) {
                    const accData = parseOtpUri(totpStr)
                    if (accData) {
                        accData.service = rowData['name'] || accData.service
                        accData.account = rowData['username'] || accData.account
                        accData.category = rowData['vault'] || ''
                        rawVault.push(accData)
                    }
                }
            } else if (isDashlane) {
                const totpStr = (rowData['otpurl'] || '').trim()
                if (totpStr && totpStr.startsWith('otpauth://')) {
                    const accData = parseOtpUri(totpStr)
                    if (accData) {
                        accData.service = rowData['title'] || accData.service
                        accData.account = rowData['username'] || accData.account
                        accData.category = rowData['category'] || ''
                        rawVault.push(accData)
                    }
                }
            }
            // --- 兜底路径：智能同义词识别 (支持 Keeper, NordPass, RoboForm, KeePassXC 等) ---
            else {
                // 查找包含密钥数据的列
                const totpHeader = headers.find(h => TOTP_SYNONYMS.includes(h))
                const totpVal = totpHeader ? (rowData[totpHeader] || '').trim() : ''

                if (totpVal) {
                    // 情况 A: 包含 otpauth:// 链接
                    if (totpVal.toLowerCase().startsWith('otpauth://')) {
                        const accData = parseOtpUri(totpVal)
                        if (accData) {
                            const serviceHeader = headers.find(h => NAME_SYNONYMS.includes(h))
                            const userHeader = headers.find(h => USER_SYNONYMS.includes(h))
                            accData.service = rowData[serviceHeader] || accData.service
                            accData.account = rowData[userHeader] || accData.account
                            rawVault.push(accData)
                        }
                    }
                    // 情况 B: 纯 Base32 密钥内容
                    else {
                        const secret = cleanSecret(totpVal)
                        const base32Re = /^[A-Z2-7]+=*$/
                        if (base32Re.test(secret)) {
                            const serviceHeader = headers.find(h => NAME_SYNONYMS.includes(h))
                            const userHeader = headers.find(h => USER_SYNONYMS.includes(h))
                            rawVault.push({
                                service: rowData[serviceHeader] || 'Unknown',
                                account: rowData[userHeader] || 'Unknown Account',
                                secret: secret,
                                algorithm: (rowData['algorithm'] || 'SHA1').toUpperCase().replace(/^SHA-?1$/, 'SHA-1').replace(/^SHA-?256$/, 'SHA-256').replace(/^SHA-?512$/, 'SHA-512'),
                                digits: parseInt(rowData['digits'] || '6', 10),
                                period: parseInt(rowData['period'] || '30', 10),
                                category: ''
                            })
                        }
                    }
                }
            }
        }
        return rawVault
    }
}
