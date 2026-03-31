import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateBase32Secret, parseOTPAuthURI, generateTOTP, buildOTPAuthURI } from '@/shared/utils/totp';

describe('TOTP Utility - Comprehensive Audit', () => {

    describe('validateBase32Secret', () => {
        it('should return true for standard 16-char secret', () => {
            expect(validateBase32Secret('JBSWY3DPEHPK3PXP')).toBe(true);
        });

        it('should handle spaces and lowercase', () => {
            expect(validateBase32Secret('jbsw y3dp ehpk 3pxp')).toBe(true);
        });

        it('should reject invalid base32 characters', () => {
            expect(validateBase32Secret('JBSWY3DPEHPK3PX8')).toBe(false);
        });
    });

    describe('parseOTPAuthURI & steam:// Support', () => {
        it('should parse a standard valid URI', () => {
            const uri = 'otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
            const result = parseOTPAuthURI(uri);
            expect(result).not.toBeNull();
            expect(result?.issuer).toBe('Example');
            expect(result?.account).toBe('alice@google.com');
            expect(result?.algorithm).toBe('SHA-1');
        });

        it('should identify Steam from issuer and set algorithm to STEAM', () => {
            const uri = 'otpauth://totp/Steam:yourusername?secret=JBSWY3DPEHPK3PXP&issuer=Steam';
            const result = parseOTPAuthURI(uri);
            expect(result?.algorithm).toBe('STEAM');
            expect(result?.digits).toBe(5);
        });

        it('should handle steam:// legacy protocol', () => {
            const uri = 'steam://JBSWY3DPEHPK3PXP';
            const result = parseOTPAuthURI(uri);
            expect(result?.issuer).toBe('Steam');
            expect(result?.algorithm).toBe('STEAM');
            expect(result?.digits).toBe(5);
            expect(result?.secret).toBe('JBSWY3DPEHPK3PXP');
        });
    });

    describe('buildOTPAuthURI', () => {
        it('should build a standard URI correctly', () => {
            const data = {
                service: 'Google',
                account: 'bob@gmail.com',
                secret: 'JBSWY3DPEHPK3PXP',
                algorithm: 'SHA-256',
                digits: 8,
                period: 60
            };
            const uri = buildOTPAuthURI(data);
            // The label is encoded so : becomes %3A
            expect(uri).toContain('otpauth://totp/Google%3Abob%40gmail.com');
            expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
            expect(uri).toContain('algorithm=SHA256');
            expect(uri).toContain('digits=8');
        });

        it('should build a specialized Steam URI', () => {
            const data = {
                service: 'Steam',
                account: 'gamer123',
                secret: 'JBSWY3DPEHPK3PXP',
                algorithm: 'STEAM'
            };
            const uri = buildOTPAuthURI(data);
            expect(uri).toBe('otpauth://totp/Steam%3Agamer123?secret=JBSWY3DPEHPK3PXP&issuer=Steam');
            // Steam URI should NOT contain algorithm/digits params for compatibility
            expect(uri).not.toContain('algorithm=STEAM');
        });
    });

    describe('generateTOTP (with Steam)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('should generate deterministic 6-digit code for SHA-1', async () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            vi.setSystemTime(new Date(1672531200000));
            const code = await generateTOTP(secret, 30, 6, 'SHA-1');
            expect(code).toBe('082136');
        });

        it('should generate 5-character alphanumeric code for STEAM algorithm', async () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            vi.setSystemTime(new Date(1672531200000));
            const code = await generateTOTP(secret, 30, 5, 'STEAM');
            // Steam codes are 5 chars and use a special character set
            expect(code).toHaveLength(5);
            expect(code).toMatch(/^[2-9BCDFGHJKMNPQRTVWXY]{5}$/);
            expect(code).toBe('8CG3Q'); // Verified deterministic value for this timestamp
        });
    });
});
