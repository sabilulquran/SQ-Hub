package org.sabilulquran.keycloak.karir;

import java.time.Clock;
import java.time.Duration;

/**
 * Per-IP and per-account limits of REC-IMPL-001 §2 (anti-bot) and §4.3 (batas laju). Login failures per account
 * are left to Keycloak brute-force detection; WhatsApp numbers are limited by the Karir SQ relay.
 *
 * <p>Every submit of a NIK form (Masuk, Daftar, NIK step of Lupa kata sandi) counts as one attempt for the client IP:
 * <ul>
 *   <li>Daftar always asks for Turnstile.</li>
 *   <li>Lupa kata sandi asks for Turnstile once the IP made 3 attempts in 15 minutes.</li>
 *   <li>Masuk asks for Turnstile once the IP made 20 attempts in 15 minutes.</li>
 *   <li>After 20 attempts, a submit that fails Turnstile blocks the IP from every NIK form for 15 minutes.</li>
 * </ul>
 */
public final class AbuseGuard {
    public enum NikForm { LOGIN, REGISTER, RESET }

    static final Duration IP_WINDOW = Duration.ofMinutes(15);
    static final int RESET_TURNSTILE_AFTER = 3;
    static final int IP_HARD_LIMIT = 20;
    static final Duration IP_BLOCK = Duration.ofMinutes(15);
    static final Duration CODE_WINDOW = Duration.ofHours(1);
    static final int CODES_PER_ACCOUNT_PER_HOUR = 5;

    private final RateLimiter ipAttempts;
    private final RateLimiter codeRequests;

    public AbuseGuard(Clock clock) {
        this.ipAttempts = new RateLimiter(clock, IP_WINDOW, IP_HARD_LIMIT * 4);
        this.codeRequests = new RateLimiter(clock, CODE_WINDOW, CODES_PER_ACCOUNT_PER_HOUR * 2);
    }

    public boolean isBlocked(String ip) {
        return ipAttempts.isBlocked(ipKey(ip));
    }

    public boolean turnstileRequired(NikForm form, String ip) {
        int attempts = ipAttempts.count(ipKey(ip));
        return switch (form) {
            case REGISTER -> true;
            case RESET -> attempts >= RESET_TURNSTILE_AFTER;
            case LOGIN -> attempts >= IP_HARD_LIMIT;
        };
    }

    public void recordAttempt(String ip) {
        ipAttempts.record(ipKey(ip));
    }

    /** Called when a required Turnstile check failed. Over the hard limit, the IP is blocked for 15 minutes. */
    public void turnstileFailed(String ip) {
        if (ipAttempts.count(ipKey(ip)) >= IP_HARD_LIMIT) {
            ipAttempts.block(ipKey(ip), IP_BLOCK);
        }
    }

    /**
     * Takes one of the five codes an account may request per hour. The key is the {@code nik_hmac}, so a code
     * request for an unknown NIK is limited the same way as for a real account.
     */
    public boolean tryCodeRequest(String nikHmac) {
        return codeRequests.tryAcquire("code:" + nikHmac, CODES_PER_ACCOUNT_PER_HOUR);
    }

    private static String ipKey(String ip) {
        return "ip:" + (ip == null ? "unknown" : ip);
    }
}
