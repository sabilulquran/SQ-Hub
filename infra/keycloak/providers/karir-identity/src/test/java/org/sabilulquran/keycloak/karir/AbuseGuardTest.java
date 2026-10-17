package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class AbuseGuardTest {
    private static final String IP = "198.51.100.7";
    private final MutableClock clock = new MutableClock();
    private final AbuseGuard guard = new AbuseGuard(clock);

    @Test
    void registrationAlwaysAsksForTurnstile() {
        assertTrue(guard.turnstileRequired(AbuseGuard.NikForm.REGISTER, IP));
    }

    @Test
    void resetAsksForTurnstileAfterThreeAttemptsIn15Minutes() {
        guard.recordAttempt(IP);
        guard.recordAttempt(IP);
        assertFalse(guard.turnstileRequired(AbuseGuard.NikForm.RESET, IP));
        guard.recordAttempt(IP);
        assertTrue(guard.turnstileRequired(AbuseGuard.NikForm.RESET, IP));
        assertFalse(guard.turnstileRequired(AbuseGuard.NikForm.RESET, "198.51.100.8"));
        clock.advance(Duration.ofMinutes(15).plusSeconds(1));
        assertFalse(guard.turnstileRequired(AbuseGuard.NikForm.RESET, IP));
    }

    @Test
    void loginAsksForTurnstileAfterTwentyAttempts() {
        for (int i = 0; i < 19; i++) {
            guard.recordAttempt(IP);
        }
        assertFalse(guard.turnstileRequired(AbuseGuard.NikForm.LOGIN, IP));
        guard.recordAttempt(IP);
        assertTrue(guard.turnstileRequired(AbuseGuard.NikForm.LOGIN, IP));
    }

    @Test
    void failedTurnstileOverTheLimitBlocksTheIpFor15Minutes() {
        guard.turnstileFailed(IP);
        assertFalse(guard.isBlocked(IP), "below the limit a failed check only refuses that submit");
        for (int i = 0; i < 20; i++) {
            guard.recordAttempt(IP);
        }
        guard.turnstileFailed(IP);
        assertTrue(guard.isBlocked(IP));
        assertFalse(guard.isBlocked("198.51.100.8"));
        clock.advance(Duration.ofMinutes(14));
        assertTrue(guard.isBlocked(IP));
        clock.advance(Duration.ofMinutes(1).plusSeconds(1));
        assertFalse(guard.isBlocked(IP));
    }

    @Test
    void fiveCodesPerAccountPerHour() {
        String account = "a".repeat(64);
        for (int i = 0; i < 5; i++) {
            assertTrue(guard.tryCodeRequest(account));
        }
        assertFalse(guard.tryCodeRequest(account));
        assertTrue(guard.tryCodeRequest("b".repeat(64)));
        clock.advance(Duration.ofMinutes(59));
        assertFalse(guard.tryCodeRequest(account));
        clock.advance(Duration.ofMinutes(1).plusSeconds(1));
        assertTrue(guard.tryCodeRequest(account));
    }
}
