export interface BackupFile {
    filename: string;
    size: number;
    lastModified: string;
}

export interface BackupProvider {
    testConnection(): Promise<boolean>;
    listBackups(): Promise<BackupFile[]>;
    uploadBackup(filename: string, data: string): Promise<void>;
    downloadBackup(filename: string): Promise<string>;
    deleteBackup(filename: string): Promise<void>;
    onConfigUpdate?: (newConfig: any) => Promise<void>;
}