import { parseOtpUri } from '@/shared/utils/totp';
import { loadResource } from '@/shared/services/offlineRegistry';


/**
 * Proton Pass (.pgp) Strategy
 * Uses OpenPGP (Armored Message)
 */
export const protonPassStrategy = {
    name: 'Proton Pass (.pgp)',
    fileType: 'text/plain',

    async parse(armoredContent, password) {
        try {
            // 🚀 动态安全加载：统一通过注册表拉取
            const openpgpModule = await loadResource('openpgp');
            const openpgp = openpgpModule?.default || openpgpModule;

            const message = await openpgp.readMessage({
                armoredMessage: armoredContent
            });

            const { data: decrypted } = await openpgp.decrypt({
                message,
                passwords: [password],
                format: 'utf8'
            });

            const decryptedJson = JSON.parse(decrypted);
            const results = [];

            const vaults = decryptedJson.vaults || {};

            for (const vaultId in vaults) {
                const vault = vaults[vaultId];
                const items = vault.items || [];
                for (const item of items) {
                    const data = item.data || {};
                    const content = data.content || {};
                    const metadata = data.metadata || {};

                    if (content.totpUri) {
                        const parsed = parseOtpUri(content.totpUri);
                        if (parsed) {
                            // Use metadata name if available for service
                            if (metadata.name) parsed.service = metadata.name;
                            if (content.itemUsername) parsed.account = content.itemUsername;
                            results.push(parsed);
                        }
                    }
                }
            }

            return results;
        } catch (err) {
            console.error('Proton Pass PGP decryption failed:', err);
            throw new Error('INVALID_FORMAT_OR_PASSWORD');
        }
    }
};
