#!/usr/bin/env node

/**
 * NodeAuth Backup Decryptor
 * -----------------------
 * A standalone script to decrypt NodeAuth backup files.
 * 
 * Usage: node decrypt_backup.js <backup_file.json> <password>
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Crypto Configuration (Must match NodeAuth standards)
const CRYPTO_CONFIG = {
    ALGO_NAME: 'aes-256-gcm',
    KDF_NAME: 'sha256',
    ITERATIONS: 100000,
    KEY_LEN: 32,
    SALT_LEN: 16,
    IV_LEN: 12,
    TAG_LEN: 16
};

function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('\x1b[33m%s\x1b[0m', 'Usage: node decrypt_backup.js <path_to_backup.json> <password>');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    const password = args[1];

    if (!fs.existsSync(filePath)) {
        console.error('\x1b[31m%s\x1b[0m', `Error: File not found at ${filePath}`);
        process.exit(1);
    }

    let backupContent;
    try {
        const fileData = fs.readFileSync(filePath, 'utf8');
        backupContent = JSON.parse(fileData);
    } catch (e) {
        console.error('\x1b[31m%s\x1b[0m', `Error: Failed to read or parse JSON file: ${e.message}`);
        process.exit(1);
    }

    if (!backupContent.encrypted || !backupContent.data) {
        console.error('\x1b[31m%s\x1b[0m', 'Error: This file does not appear to be an encrypted NodeAuth backup or it is already decrypted.');
        process.exit(1);
    }

    try {
        const decryptedData = decrypt(backupContent.data, password);
        const prettyJson = JSON.stringify(decryptedData, null, 2);

        console.log('\x1b[32m%s\x1b[0m', '✅ Decryption Successful!');
        console.log('\x1b[36m%s\x1b[0m', '--- Decrypted Content ---');
        console.log(prettyJson);
        console.log('\x1b[36m%s\x1b[0m', '-------------------------');

        // Optional: Save to file
        const outputFilename = `decrypted-${path.basename(filePath)}`;
        fs.writeFileSync(outputFilename, prettyJson);
        console.log('\x1b[32m%s\x1b[0m', `Result saved to: ${outputFilename}`);

    } catch (e) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Decryption Failed: ${e.message}`);
        console.error('\x1b[33m%s\x1b[0m', 'Check if your password is correct.');
        process.exit(1);
    }
}

/**
 * Decrypts the base64 data string using the provided password
 */
function decrypt(base64Data, password) {
    const combined = Buffer.from(base64Data, 'base64');

    // Structure: [salt(16)] + [iv(12)] + [ciphertext(remaining - 16)] + [tag(16)]
    // Note: Node.js decipher.setAuthTag requires the tag to be separated.
    const salt = combined.subarray(0, CRYPTO_CONFIG.SALT_LEN);
    const iv = combined.subarray(CRYPTO_CONFIG.SALT_LEN, CRYPTO_CONFIG.SALT_LEN + CRYPTO_CONFIG.IV_LEN);
    const authTag = combined.subarray(combined.length - CRYPTO_CONFIG.TAG_LEN);
    const ciphertext = combined.subarray(CRYPTO_CONFIG.SALT_LEN + CRYPTO_CONFIG.IV_LEN, combined.length - CRYPTO_CONFIG.TAG_LEN);

    // Derive key
    const key = crypto.pbkdf2Sync(
        password,
        salt,
        CRYPTO_CONFIG.ITERATIONS,
        CRYPTO_CONFIG.KEY_LEN,
        CRYPTO_CONFIG.KDF_NAME
    );

    // Decrypt
    const decipher = crypto.createDecipheriv(CRYPTO_CONFIG.ALGO_NAME, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, null, 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
}

main();
