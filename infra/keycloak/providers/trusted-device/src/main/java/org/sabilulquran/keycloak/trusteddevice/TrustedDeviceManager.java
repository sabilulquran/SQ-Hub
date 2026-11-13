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
    /**
     * How long a just-rotated proof keeps working. One sign-in can reach the authenticator more
     * than once - a reload, a retried step, or two applications asking for authentication at the
     * same moment - and without this window the second request presents a copy consumed moments
     * earlier, loses the trust, and makes the person enter a code again for the next 30 days.
     */
    static final int ROTATION_GRACE_SECONDS = 120;
    private static final String VERSION = "v1";
    /** Server-side record layout; v1 records (four fields) are still read so trust survives upgrade. */
    private static final String RECORD_VERSION = "v2";

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
        records.add(record(expiresAt, nonceHash, credentialFingerprint, expiresAt));
        return new Issue(cookie, List.copyOf(cap(records)), expiresAt);
    }

    Validation validateAndRotate(String cookie, String realmId, String userId,
                                 String credentialFingerprint, List<String> currentRecords) {
        List<String> pruned = prune(currentRecords, credentialFingerprint);
        if (cookie == null || cookie.isBlank()) {
            return Validation.rejected(pruned, Reason.NO_COOKIE);
        }

        String[] parts = cookie.split("\\.", -1);
        if (parts.length != 6 || !VERSION.equals(parts[0])) {
            return Validation.rejected(pruned, Reason.MALFORMED);
        }

        long expiresAt;
        try {
            expiresAt = Long.parseLong(parts[1]);
        } catch (NumberFormatException failure) {
            return Validation.rejected(pruned, Reason.MALFORMED);
        }

        long now = Instant.now(clock).getEpochSecond();
        if (expiresAt <= now || expiresAt > now + LIFETIME_SECONDS) {
            return Validation.rejected(pruned, Reason.EXPIRED);
        }
        if (!constantTimeEquals(parts[3], digest(realmId + ":" + userId))) {
            return Validation.rejected(pruned, Reason.OTHER_SUBJECT);
        }
        if (!constantTimeEquals(parts[4], credentialFingerprint)) {
            return Validation.rejected(pruned, Reason.CREDENTIALS_CHANGED);
        }

        String payload = String.join(".", parts[0], parts[1], parts[2], parts[3], parts[4]);
        if (!constantTimeEquals(parts[5], sign(payload))) {
            return Validation.rejected(pruned, Reason.BAD_SIGNATURE);
        }

        String nonceHash = digest(parts[2]);
        String matchedRecord = find(pruned, expiresAt, nonceHash, credentialFingerprint);
        if (matchedRecord == null) {
            return Validation.rejected(pruned, Reason.NO_SERVER_RECORD);
        }
        pruned.remove(matchedRecord);
        if (!isWithinGrace(matchedRecord)) {
            // Keep the consumed proof alive briefly, so a concurrent request from the same browser
            // still passes. After the window the copy fails closed exactly as before.
            pruned.add(record(expiresAt, nonceHash, credentialFingerprint, now + ROTATION_GRACE_SECONDS));
        }

        Issue rotated = issue(realmId, userId, credentialFingerprint, pruned);
        return new Validation(true, rotated.cookie(), rotated.records(), rotated.expiresAt(), Reason.TRUSTED);
    }

    private List<String> prune(List<String> records, String credentialFingerprint) {
        long now = Instant.now(clock).getEpochSecond();
        List<String> result = new ArrayList<>();
        if (records == null) {
            return result;
        }
        for (String value : records) {
            // Invalid server-side state is discarded, never trusted.
            long expiry = recordExpiry(value);
            long validUntil = recordValidUntil(value);
            if (expiry > now && expiry <= now + LIFETIME_SECONDS && validUntil > now
                    && constantTimeEquals(recordFingerprint(value), credentialFingerprint)) {
                result.add(value);
            }
        }
        return result;
    }

    /**
     * Keeps an account within {@link #MAX_DEVICES}. Proofs inside their rotation grace are dropped
     * first: they are about to disappear anyway, and they must never push out a device that is
     * still trusted. Otherwise the oldest record goes.
     */
    private static List<String> cap(List<String> records) {
        List<String> result = new ArrayList<>(records);
        while (result.size() > MAX_DEVICES) {
            int victim = 0;
            for (int index = 0; index < result.size(); index++) {
                if (isWithinGrace(result.get(index))) {
                    victim = index;
                    break;
                }
            }
            result.remove(victim);
        }
        return result;
    }

    private static String find(List<String> records, long expiresAt, String nonceHash, String fingerprint) {
        for (String value : records) {
            if (recordExpiry(value) == expiresAt
                    && constantTimeEquals(recordNonceHash(value), nonceHash)
                    && constantTimeEquals(recordFingerprint(value), fingerprint)) {
                return value;
            }
        }
        return null;
    }

    private static boolean isWithinGrace(String record) {
        return recordValidUntil(record) < recordExpiry(record);
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

    private static String record(long expiresAt, String nonceHash, String credentialFingerprint, long validUntil) {
        return String.join("|", RECORD_VERSION, Long.toString(expiresAt), nonceHash, credentialFingerprint,
                Long.toString(validUntil));
    }

    private static String[] fieldsOf(String record) {
        String[] fields = record == null ? new String[0] : record.split("\\|", -1);
        if (fields.length == 4 && VERSION.equals(fields[0])) {
            return fields;
        }
        if (fields.length == 5 && RECORD_VERSION.equals(fields[0])) {
            return fields;
        }
        return new String[0];
    }

    private static String recordNonceHash(String record) {
        String[] fields = fieldsOf(record);
        return fields.length == 0 ? "" : fields[2];
    }

    private static String recordFingerprint(String record) {
        String[] fields = fieldsOf(record);
        return fields.length == 0 ? "" : fields[3];
    }

    private static long recordExpiry(String record) {
        return parseField(fieldsOf(record), 1);
    }

    /**
     * When a record stops being accepted: the proof expiry for a live record, or the end of the
     * rotation grace for one that has just been replaced.
     */
    private static long recordValidUntil(String record) {
        String[] fields = fieldsOf(record);
        return fields.length == 5 ? parseField(fields, 4) : parseField(fields, 1);
    }

    private static long parseField(String[] fields, int index) {
        if (fields.length <= index) {
            return 0L;
        }
        try {
            long value = Long.parseLong(fields[index]);
            return value > 0 ? value : 0L;
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    record Issue(String cookie, List<String> records, long expiresAt) {
    }

    /**
     * Why a presented proof was accepted or refused. Diagnostics only: a reason names no
     * cookie value, nonce, user, or credential material.
     */
    enum Reason {
        TRUSTED,
        NO_COOKIE,
        MALFORMED,
        EXPIRED,
        OTHER_SUBJECT,
        CREDENTIALS_CHANGED,
        BAD_SIGNATURE,
        NO_SERVER_RECORD
    }

    record Validation(boolean trusted, String rotatedCookie, List<String> records, long expiresAt, Reason reason) {
        static Validation rejected(List<String> records, Reason reason) {
            return new Validation(false, null, List.copyOf(records), 0, reason);
        }
    }
}
