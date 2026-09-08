package org.sabilulquran.keycloak.trusteddevice;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;

class TrustedDeviceManagerTest {
    private static final byte[] KEY = "0123456789abcdef0123456789abcdef".getBytes();
    private static final Instant NOW = Instant.parse("2026-09-08T00:00:00Z");

    @Test
    void uncheckedOrInvalidOtpNeverIssuesTrust() {
        assertFalse(TrustedDeviceDecision.shouldIssue(false, true));
        assertFalse(TrustedDeviceDecision.shouldIssue(true, false));
        assertTrue(TrustedDeviceDecision.shouldIssue(true, true));
    }

    @Test
    void checkedValidOtpIssuesProofAndSameDeviceValidatesOnceThenRotates() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials", List.of());
        TrustedDeviceManager.Validation accepted = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", issue.records());

        assertTrue(accepted.trusted());
        assertNotEquals(issue.cookie(), accepted.rotatedCookie());

        TrustedDeviceManager.Validation replay = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", accepted.records());
        assertFalse(replay.trusted());
    }

    @Test
    void anotherBrowserWithoutProofAndAnotherUserOrRealmRequireTotp() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials", List.of());

        assertFalse(manager.validateAndRotate(null, "realm", "user", "credentials", issue.records()).trusted());
        assertFalse(manager.validateAndRotate(issue.cookie(), "realm", "other", "credentials", issue.records()).trusted());
        assertFalse(manager.validateAndRotate(issue.cookie(), "other", "user", "credentials", issue.records()).trusted());
    }

    @Test
    void expiredTamperedAndCredentialResetProofsRequireTotp() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials-v1", List.of());
        char last = issue.cookie().charAt(issue.cookie().length() - 1);
        String tampered = issue.cookie().substring(0, issue.cookie().length() - 1) + (last == 'A' ? 'B' : 'A');

        assertFalse(manager.validateAndRotate(tampered, "realm", "user", "credentials-v1", issue.records()).trusted());
        assertFalse(manager.validateAndRotate(issue.cookie(), "realm", "user", "credentials-v2", issue.records()).trusted());

        TrustedDeviceManager later = managerAt(NOW.plusSeconds(TrustedDeviceManager.LIFETIME_SECONDS + 1L));
        assertFalse(later.validateAndRotate(issue.cookie(), "realm", "user", "credentials-v1", issue.records()).trusted());
    }

    @Test
    void signingKeyMustContainAtLeast256Bits() {
        assertThrows(IllegalArgumentException.class, () -> new TrustedDeviceManager(new byte[31]));
        String encoded = Base64.getEncoder().encodeToString(KEY);
        assertTrue(TrustedDeviceManager.decodeSigningKey(encoded).length >= 32);
    }

    private static TrustedDeviceManager managerAt(Instant instant) {
        SecureRandom deterministic = new SecureRandom() {
            private int value;

            @Override
            public void nextBytes(byte[] bytes) {
                for (int index = 0; index < bytes.length; index++) {
                    bytes[index] = (byte) value++;
                }
            }
        };
        return new TrustedDeviceManager(KEY, Clock.fixed(instant, ZoneOffset.UTC), deterministic);
    }
}
