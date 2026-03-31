export class backupError extends Error {
    constructor(message, code = 'BACKUP_ERROR', details = null) {
        super(message)
        this.name = 'backupError'
        this.code = code
        this.details = details

        // Error stack trace maintenance for V8 engines (like Node.js or Chrome)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, backupError)
        }
    }
}
