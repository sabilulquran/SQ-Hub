package org.sabilulquran.keycloak.trusteddevice;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
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
    void checkedValidOtpIssuesProofAndSameDeviceValidatesThenRotates() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials", List.of());
        TrustedDeviceManager.Validation accepted = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", issue.records());

        assertTrue(accepted.trusted());
        assertNotEquals(issue.cookie(), accepted.rotatedCookie());

        TrustedDeviceManager later = managerAt(NOW.plusSeconds(TrustedDeviceManager.ROTATION_GRACE_SECONDS + 1L));
        TrustedDeviceManager.Validation replay = later.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", accepted.records());
        assertFalse(replay.trusted());
    }

    @Test
    void aSecondRequestWithinTheRotationGraceKeepsTheTrust() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials", List.of());
        TrustedDeviceManager.Validation first = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", issue.records());
        assertTrue(first.trusted());

        // The same browser presents the copy it had before the rotation reached it. The jar already
        // holds the rotated proof, so nothing is issued again.
        TrustedDeviceManager.Validation concurrent = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", first.records());
        assertTrue(concurrent.trusted());
        assertNull(concurrent.rotatedCookie());
        assertEquals(first.records().size(), concurrent.records().size());

        // Any further stale copy inside the window is accepted too, without growing the device list.
        TrustedDeviceManager.Validation repeated = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", concurrent.records());
        assertTrue(repeated.trusted());
        assertEquals(first.records().size(), repeated.records().size());

        // The rotated proof still works afterwards, so the trust is not lost either way.
        assertTrue(manager.validateAndRotate(
                first.rotatedCookie(), "realm", "user", "credentials", repeated.records()).trusted());
    }

    @Test
    void graceDoesNotOutliveItsWindowAndNeverPushesOutATrustedDevice() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials", List.of());
        TrustedDeviceManager.Validation accepted = manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", issue.records());

        // One live record plus one record inside its grace window.
        assertEquals(2, accepted.records().size());

        List<String> crowded = new ArrayList<>(accepted.records());
        TrustedDeviceManager.Issue latest = null;
        for (int device = 0; device < TrustedDeviceManager.MAX_DEVICES; device++) {
            latest = manager.issue("realm", "user", "credentials", crowded);
            crowded = new ArrayList<>(latest.records());
        }

        List<String> finalRecords = List.copyOf(crowded);
        assertEquals(TrustedDeviceManager.MAX_DEVICES, finalRecords.size(), () -> String.join(" ;; ", finalRecords));
        assertTrue(manager.validateAndRotate(
                latest.cookie(), "realm", "user", "credentials", crowded).trusted());
    }

    @Test
    void recordsWrittenBeforeTheGraceWindowStillValidate() {
        TrustedDeviceManager manager = managerAt(NOW);
        TrustedDeviceManager.Issue issue = manager.issue("realm", "user", "credentials", List.of());
        List<String> legacy = issue.records().stream()
                .map(record -> {
                    String[] fields = record.split("\\|", -1);
                    return String.join("|", "v1", fields[1], fields[2], fields[3]);
                })
                .toList();

        assertTrue(manager.validateAndRotate(
                issue.cookie(), "realm", "user", "credentials", legacy).trusted());
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
