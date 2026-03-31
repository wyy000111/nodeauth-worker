/**
 * Google Authenticator 迁移协议解码策略 (Decoding Strategy)
 */

export const gaMigrationStrategy = {
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
     * Decode the raw bytes from a GA migration QR code into VaultItems.
     * @param {Uint8Array} dataBytes 
     * @returns {VaultItem[]}
     */
    decodePayload(dataBytes) {
        const accounts = []
        let pos = 0

        function readVarint() {
            let result = 0
            let shift = 0
            while (pos < dataBytes.length) {
                const byte = dataBytes[pos++]
                result |= (byte & 0x7f) << shift
                if ((byte & 0x80) === 0) break
                shift += 7
            }
            return result
        }

        while (pos < dataBytes.length) {
            const tag = dataBytes[pos++]
            const fieldNumber = tag >> 3
            const wireType = tag & 0x07

            if (fieldNumber === 1 && wireType === 2) {
                const length = readVarint()
                const endPos = pos + length

                let secret = null
                let name = ''
                let issuer = ''
                let algorithm = 'SHA1'
                let digits = 6
                while (pos < endPos) {
                    const pTag = dataBytes[pos++]
                    const pField = pTag >> 3
                    const pWire = pTag & 0x07

                    if (pField === 1 && pWire === 2) {
                        const sLen = readVarint()
                        const sBytes = dataBytes.slice(pos, pos + sLen)
                        const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
                        let bits = 0, value = 0, output = ''
                        for (let i = 0; i < sBytes.length; i++) {
                            value = (value << 8) | sBytes[i]
                            bits += 8
                            while (bits >= 5) {
                                output += ALPHABET[(value >>> (bits - 5)) & 31]
                                bits -= 5
                            }
                        }
                        if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
                        secret = output
                        pos += sLen
                    } else if (pField === 2 && pWire === 2) {
                        const nLen = readVarint()
                        name = new TextDecoder().decode(dataBytes.slice(pos, pos + nLen))
                        pos += nLen
                    } else if (pField === 3 && pWire === 2) {
                        const iLen = readVarint()
                        issuer = new TextDecoder().decode(dataBytes.slice(pos, pos + iLen))
                        pos += iLen
                    } else if (pField === 4 && pWire === 0) {
                        const aVal = readVarint()
                        if (aVal === 2) algorithm = 'SHA256'
                        else if (aVal === 3) algorithm = 'SHA512'
                        else if (aVal === 4) algorithm = 'MD5'
                    } else if (pField === 5 && pWire === 0) {
                        const dVal = readVarint()
                        if (dVal === 2) digits = 8
                    } else if (pField === 6 && pWire === 0) {
                        readVarint()
                    } else {
                        if (pWire === 0) readVarint()
                        else if (pWire === 2) pos += readVarint()
                        else break
                    }
                }

                if (secret) {
                    let account = name
                    let finalIssuer = issuer
                    if (!finalIssuer && name.includes(':')) {
                        const parts = name.split(':')
                        finalIssuer = parts[0].trim()
                        account = parts[1].trim()
                    }

                    accounts.push({
                        service: finalIssuer || 'Unknown',
                        account: account || 'Unknown',
                        secret: secret,
                        algorithm,
                        digits,
                        period: 30,
                        category: ''
                    })
                }
                pos = endPos
            } else {
                if (wireType === 0) readVarint()
                else if (wireType === 2) pos += readVarint()
                else break
            }
        }
        return accounts
    }
}
