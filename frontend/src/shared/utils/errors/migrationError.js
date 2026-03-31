export class migrationError extends Error {
    constructor(message, code = 'MIGRATION_ERROR', details = null) {
        super(message)
        this.name = 'migrationError'
        this.code = code
        this.details = details
    }
}
