package org.sabilulquran.keycloak.trusteddevice;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class TrustedDeviceManager {
    static final int LIFETIME_SECONDS = 30 * 24 * 60 * 60;
    static final int MAX_DEVICES = 10;
    private static final String VERSION = "v1";

    private final byte[] signingKey;
    private final Clock clock;
    private final SecureRandom random;

    TrustedDeviceManager(byte[] signingKey) {
        this(signingKey, Clock.systemUTC(), new SecureRandom());
    }

    TrustedDeviceManager(byte[] signingKey, Clock clock, SecureRandom random) {
        if (signingKey == null || signingKey.length < 32) {
            throw new IllegalArgumentException("trusted-device signing key must contain at least 32 bytes");
        }
        this.signingKey = signingKey.clone();
        this.clock = Objects.requireNonNull(clock);
        this.random = Objects.requireNonNull(random);
    }

    static byte[] decodeSigningKey(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("trusted-device signing key is missing");
        }
        try {
            return Base64.getDecoder().decode(value);
        } catch (IllegalArgumentException standardFailure) {
            return Base64.getUrlDecoder().decode(value);
        }
    }

    Issue issue(String realmId, String userId, String credentialFingerprint, List<String> currentRecords) {
        long expiresAt = Instant.now(clock).getEpochSecond() + LIFETIME_SECONDS;
        byte[] nonceBytes = new byte[32];
        random.nextBytes(nonceBytes);
        String nonce = encode(nonceBytes);
        String nonceHash = digest(nonce);
        String subjectHash = digest(realmId + ":" + userId);
        String payload = String.join(".", VERSION, Long.toString(expiresAt), nonce, subjectHash, credentialFingerprint);
        String cookie = payload + "." + sign(payload);

        List<String> records = prune(currentRecords, credentialFingerprint);
        records.removeIf(value -> recordNonceHash(value).equals(nonceHash));
        records.add(record(expiresAt, nonceHash, credentialFingerprint));
        if (records.size() > MAX_DEVICES) {
            records = new ArrayList<>(records.subList(records.size() - MAX_DEVICES, records.size()));
        }
        return new Issue(cookie, List.copyOf(records), expiresAt);
    }

    Validation validateAndRotate(String cookie, String realmId, String userId,
                                 String credentialFingerprint, List<String> currentRecords) {
        List<String> pruned = prune(currentRecords, credentialFingerprint);
        if (cookie == null || cookie.isBlank()) {
            return Validation.rejected(pruned);
        }

        String[] parts = cookie.split("\\.", -1);
        if (parts.length != 6 || !VERSION.equals(parts[0])) {
            return Validation.rejected(pruned);
        }

        long expiresAt;
        try {
            expiresAt = Long.parseLong(parts[1]);
        } catch (NumberFormatException failure) {
            return Validation.rejected(pruned);
        }

        long now = Instant.now(clock).getEpochSecond();
        if (expiresAt <= now || expiresAt > now + LIFETIME_SECONDS) {
            return Validation.rejected(pruned);
        }
        if (!constantTimeEquals(parts[3], digest(realmId + ":" + userId))
                || !constantTimeEquals(parts[4], credentialFingerprint)) {
            return Validation.rejected(pruned);
        }

        String payload = String.join(".", parts[0], parts[1], parts[2], parts[3], parts[4]);
        if (!constantTimeEquals(parts[5], sign(payload))) {
            return Validation.rejected(pruned);
        }

        String matchedRecord = record(expiresAt, digest(parts[2]), credentialFingerprint);
        if (!pruned.remove(matchedRecord)) {
            return Validation.rejected(pruned);
        }

        Issue rotated = issue(realmId, userId, credentialFingerprint, pruned);
        return new Validation(true, rotated.cookie(), rotated.records(), rotated.expiresAt());
    }

    private List<String> prune(List<String> records, String credentialFingerprint) {
        long now = Instant.now(clock).getEpochSecond();
        List<String> result = new ArrayList<>();
        if (records == null) {
            return result;
        }
        for (String value : records) {
            String[] fields = value.split("\\|", -1);
            if (fields.length != 4 || !VERSION.equals(fields[0])) {
                continue;
            }
            try {
                long expiry = Long.parseLong(fields[1]);
                if (expiry > now && expiry <= now + LIFETIME_SECONDS
                        && constantTimeEquals(fields[3], credentialFingerprint)) {
                    result.add(value);
                }
            } catch (NumberFormatException ignored) {
                // Invalid server-side state is discarded, never trusted.
            }
        }
        return result;
    }

    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
            return encode(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HMAC-SHA-256 is unavailable", failure);
        }
    }

    static String digest(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return encode(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("SHA-256 is unavailable", failure);
        }
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.US_ASCII), right.getBytes(StandardCharsets.US_ASCII));
    }

    private static String encode(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static String record(long expiresAt, String nonceHash, String credentialFingerprint) {
        return String.join("|", VERSION, Long.toString(expiresAt), nonceHash, credentialFingerprint);
    }

    private static String recordNonceHash(String record) {
        String[] fields = record.split("\\|", -1);
        return fields.length == 4 ? fields[2] : "";
    }

    record Issue(String cookie, List<String> records, long expiresAt) {
    }

    record Validation(boolean trusted, String rotatedCookie, List<String> records, long expiresAt) {
        static Validation rejected(List<String> records) {
            return new Validation(false, null, List.copyOf(records), 0);
        }
    }
}
