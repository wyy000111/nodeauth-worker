import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/vue';
import { ref } from 'vue';
import DataBackup from '@/features/backup/views/dataBackup.vue';
import { commonStubs } from './test-utils';

vi.mock('@/locales', () => ({
    i18n: { global: { t: (k) => k, te: () => true, install: vi.fn() } }
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (k) => k }),
    createI18n: vi.fn(() => ({ global: { t: (k) => k } }))
}));

vi.mock('@/features/backup/composables/useBackupProviders', () => ({
    useBackupProviders: vi.fn()
}));

vi.mock('@/features/backup/composables/useBackupActions', () => ({
    useBackupActions: vi.fn()
}));

vi.mock('@/features/home/store/layoutStore', () => ({
    useLayoutStore: () => ({ isMobile: false })
}));

vi.mock('element-plus', async () => {
    const actual = await vi.importActual('element-plus');
    return {
        ...actual,
        ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
        ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) }
    };
});

describe('GitHub Backup UI (Happy Path & Edge Cases)', () => {
    const createBaseProvidersMock = () => ({
        providers: ref([]), isLoading: ref(false), showConfigDialog: ref(false), isEditing: ref(false),
        isTesting: ref(false), isSaving: ref(false), testingProviderIds: ref({}), testResults: ref({}),
        form: ref({ type: 'github', name: '', config: { token: '', owner: 'test_owner', repo: 'test_repo', branch: 'main', saveDir: '/nodeauth-backup' }, autoBackup: false }),
        fetchProviders: vi.fn(), openAddDialog: vi.fn(), testConnection: vi.fn(),
        saveProvider: vi.fn(), deleteProvider: vi.fn(), setupAuthListener: vi.fn(() => vi.fn()),
        availableTypes: ['s3', 'webdav', 'email', 'telegram', 'github'],
        isEditingWebdavPwd: ref(false),
        isEditingS3Secret: ref(false),
        isEditingTelegramToken: ref(false),
        isEditingEmailPwd: ref(false),
        isEditingGithubToken: ref(false)
    });

    const createBaseActionsMock = () => ({
        showBackupDialog: ref(false), backupPassword: ref(''), isBackingUp: ref(false),
        openBackupDialog: vi.fn(), handleBackup: vi.fn(),
        showRestoreListDialog: ref(false), backupFiles: ref([]),
        openRestoreDialog: vi.fn(), handleRestore: vi.fn()
    });

    const localStubs = {
        ...commonStubs,
        'el-tag': { template: '<span class="el-tag-stub"><slot /></span>' },
        'el-select': true, 'el-option': true, 'el-switch': true, 'Edit': true, 'Delete': true,
        'el-form-item': { template: '<div class="el-form-item-stub" :label="label"><slot/></div>', props: ['label'] }, 'el-input': true, 'ResponsiveOverlay': { template: '<div class="overlay-stub"><slot /><slot name="footer" /></div>' }
    };

    it('[HP1] should render GitHub config form fields in the add/edit dialog', async () => {
        const { useBackupProviders } = await import('@/features/backup/composables/useBackupProviders');
        const { useBackupActions } = await import('@/features/backup/composables/useBackupActions');

        const mockProviders = createBaseProvidersMock();
        mockProviders.showConfigDialog.value = true;
        mockProviders.form.value.type = 'github';

        useBackupProviders.mockReturnValue(mockProviders);
        useBackupActions.mockReturnValue(createBaseActionsMock());

        const wrapper = render(DataBackup, { global: { mocks: { $t: k => k }, stubs: localStubs } });

        // Form inputs should be bound to the GitHub specific fields
        const html = wrapper.html();
        expect(html).toContain('backup.github_token');
        expect(html).toContain('backup.github_owner');
        expect(html).toContain('backup.github_repo');
        expect(html).toContain('backup.github_branch');
    });

    it('[EC5] should securely mask the GitHub PAT in editing mode', async () => {
        const { useBackupProviders } = await import('@/features/backup/composables/useBackupProviders');
        const { useBackupActions } = await import('@/features/backup/composables/useBackupActions');

        const mockProviders = createBaseProvidersMock();
        mockProviders.showConfigDialog.value = true;
        mockProviders.isEditing.value = true;
        mockProviders.form.value.type = 'github';
        mockProviders.form.value.config.token = '******'; // API returns masked token

        useBackupProviders.mockReturnValue(mockProviders);
        useBackupActions.mockReturnValue(createBaseActionsMock());

        const wrapper = render(DataBackup, { global: { mocks: { $t: k => k }, stubs: localStubs } });

        const html = wrapper.html();
        expect(html).toContain('******');
        expect(html).toContain('backup.modify'); // The modify button to overwrite the token
    });
});
