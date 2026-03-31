export class vaultError extends Error {
    constructor(message, code = 'VAULT_ERROR', details = null) {
        super(message)
        this.name = 'vaultError'
        this.code = code
        this.details = details

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, vaultError)
        }
    }
}
