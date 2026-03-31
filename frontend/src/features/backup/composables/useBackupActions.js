import { useBackupUI } from '@/features/backup/composables/useBackupUI'
import { useBackupOperations } from '@/features/backup/composables/useBackupOperations'

export function useBackupActions(emit, fetchProviders, onRevoked) {
    const uiState = useBackupUI(onRevoked)
    const operations = useBackupOperations(uiState, emit, fetchProviders)

    return {
        ...uiState,
        ...operations
    }
}
