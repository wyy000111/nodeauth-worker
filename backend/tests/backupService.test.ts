import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackupService } from '@/features/backup/backupService';

// 💡 TDD 技巧：Mock 底层加解密，避免数据格式校验干扰验证
vi.mock('@/shared/utils/crypto', () => ({
    encryptData: vi.fn().mockResolvedValue('encrypted'),
    decryptData: vi.fn().mockResolvedValue('decrypted-password'),
    encryptBackupFile: vi.fn().mockResolvedValue('encrypted-file')
}));

describe('BackupService Security & Logic', () => {
    let backupService: BackupService;
    let mockEnv: any;
    let mockDb: any;

    beforeEach(() => {
        vi.clearAllMocks();

        const createMockQuery = (resolvedValue: any = []) => {
            const mock: any = Promise.resolve(resolvedValue);
            mock.from = vi.fn().mockReturnValue(mock);
            mock.where = vi.fn().mockReturnValue(mock);
            mock.orderBy = vi.fn().mockReturnValue(mock);
            mock.limit = vi.fn().mockReturnValue(mock);
            mock.offset = vi.fn().mockReturnValue(mock);
            mock.set = vi.fn().mockReturnValue(mock); // for update
            mock.values = vi.fn().mockReturnValue(mock); // for insert
            mock.get = vi.fn().mockReturnValue(mock);
            mock.all = vi.fn().mockReturnValue(mock);
            mock.execute = vi.fn().mockReturnValue(mock);
            return mock;
        };

        mockDb = {
            select: vi.fn().mockImplementation(() => createMockQuery()),
            update: vi.fn().mockImplementation(() => createMockQuery()),
            insert: vi.fn().mockImplementation(() => createMockQuery()),
            delete: vi.fn().mockImplementation(() => createMockQuery()),
            exec: vi.fn().mockResolvedValue(true),
            all: vi.fn(), // for legacy direct calls if any
            get: vi.fn()
        };

        mockEnv = { DB: mockDb, ENCRYPTION_KEY: 'test-key' };
        backupService = new BackupService(mockEnv);
    });

    describe('Filename Security', () => {
        it('should throw "invalid_filename_detected" for non-standard filenames', async () => {
            await expect(backupService.downloadFile(1, 'hack.sh'))
                .rejects
                .toThrowError(/invalid_filename_detected/);
        });

        it('should block directory traversal attempts', async () => {
            await expect(backupService.downloadFile(1, '../../etc/passwd.json'))
                .rejects
                .toThrowError(/invalid_filename_detected/);
        });
    });

    describe('Sensitive Data Protection', () => {
        it('should mask passwords for frontend display', async () => {
            const config = { password: 'top-secret', url: 'http://dav.com' };
            (backupService as any).maskConfigForFrontend('webdav', config);
            expect(config.password).toBe('******');
        });
    });

    describe('Backup Pruning (handleScheduledBackup)', () => {
        it('should delete the oldest auto-backups when count exceeds retainCount', async () => {
            const mockFiles = [
                { filename: 'nodeauth-backup-auto-2024-03-01.json' },
                { filename: 'nodeauth-backup-auto-2024-03-05.json' },
                { filename: 'nodeauth-backup-auto-2024-03-03.json' },
            ];

            const providersData = [{
                id: 1, name: 'Cloud', type: 'webdav',
                autoBackup: true, autoBackupPassword: '"pwd"', autoBackupRetain: 2,
                config: '{}'
            }];

            mockDb.select.mockImplementation(() => {
                const mock: any = Promise.resolve(providersData);
                mock.from = vi.fn().mockReturnValue(mock);
                return mock;
            });

            const mockProvider = {
                listBackups: vi.fn().mockResolvedValue(mockFiles),
                deleteBackup: vi.fn().mockResolvedValue(true),
                uploadBackup: vi.fn().mockResolvedValue(true)
            };

            vi.spyOn(backupService as any, 'getProvider').mockResolvedValue(mockProvider);
            vi.spyOn(backupService as any, 'generateEncryptedPayload').mockResolvedValue('content');

            await backupService.handleScheduledBackup();

            expect(mockProvider.deleteBackup).toHaveBeenCalledTimes(1);
            expect(mockProvider.deleteBackup).toHaveBeenCalledWith('nodeauth-backup-auto-2024-03-01.json');
        });
    });
});
