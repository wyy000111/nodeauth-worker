import {
    CopyDocument, Plus, Sort, Upload, Download, Cloudy,
    Lock, MagicStick, Setting
} from '@element-plus/icons-vue'
import Fingerprint from '@/shared/components/icons/iconFingerprint.vue'
import Toolbox from '@/shared/components/icons/iconToolbox.vue'
import IconAbout from '@/shared/components/icons/iconAbout.vue'

export const menuItems = [
    {
        key: 'vault',
        label: 'menu.vault',
        icon: CopyDocument
    },
    {
        key: 'add-vault',
        label: 'menu.add',
        icon: Plus
    },
    {
        key: 'migration',
        label: 'menu.migration',
        icon: Sort,
        children: [
            { key: 'migration-export', label: 'migration.export', icon: Upload },
            { key: 'migration-import', label: 'migration.import', icon: Download }
        ]
    },
    {
        key: 'backups',
        label: 'menu.backup',
        icon: Cloudy
    },
    {
        key: 'tools',
        label: 'menu.tools',
        icon: Toolbox
    },
    {
        key: 'settings',
        label: 'menu.settings',
        icon: Setting,
        children: [
            { key: 'settings-passkey', label: 'menu.passkey', icon: Fingerprint },
            { key: 'settings-security', label: 'menu.security', icon: Lock },
            { key: 'settings-appearance', label: 'menu.appearance', icon: MagicStick },
            { key: 'settings-about', label: 'menu.about', icon: IconAbout }
        ]
    }
]
