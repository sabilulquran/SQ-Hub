package org.sabilulquran.keycloak.karir;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * One-time code kept in the authentication session (REC-IMPL-001 §4.3): 6 digits, valid 10 minutes, at most 5 wrong
 * entries per code, a new code only after 60 seconds. Only a salted hash of the code is stored, never the code.
 */
public final class OtpState {
    /** Minimal view of authentication-session notes, so the rules are testable without Keycloak. */
    public interface Notes {
        String get(String name);

        void set(String name, String value);

        void remove(String name);
    }

    public enum Check { VALID, WRONG, EXPIRED, TOO_MANY_ATTEMPTS, NO_CODE }

    static final Duration VALIDITY = Duration.ofMinutes(10);
    static final Duration RESEND_AFTER = Duration.ofSeconds(60);
    static final int MAX_WRONG = 5;

    private static final String HASH = "karir.otp.hash";
    private static final String SALT = "karir.otp.salt";
    private static final String ISSUED_AT = "karir.otp.issuedAt";
    private static final String WRONG = "karir.otp.wrong";
    private static final String CHANNEL = "karir.otp.channel";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Notes notes;
    private final Clock clock;

    public OtpState(Notes notes, Clock clock) {
        this.notes = notes;
        this.clock = clock;
    }

    /** Creates a new code, stores its hash and returns the code for delivery. */
    public String issue(String channel) {
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        notes.set(SALT, HexFormat.of().formatHex(salt));
        notes.set(HASH, hash(salt, code));
        notes.set(ISSUED_AT, Long.toString(clock.millis()));
        notes.set(WRONG, "0");
        notes.set(CHANNEL, channel);
        return code;
    }

    /** Forgets the current code, for example after the delivery failed. */
    public void clear() {
        notes.remove(HASH);
        notes.remove(SALT);
        notes.remove(ISSUED_AT);
        notes.remove(WRONG);
        notes.remove(CHANNEL);
    }

    public boolean hasCode() {
        return notes.get(HASH) != null;
    }

    public String channel() {
        return notes.get(CHANNEL);
    }

    /** Seconds until another code may be requested; 0 when a new code may be sent now. */
    public long secondsUntilResend() {
        String issued = notes.get(ISSUED_AT);
        if (issued == null) {
            return 0;
        }
        long wait = Long.parseLong(issued) + RESEND_AFTER.toMillis() - clock.millis();
        return wait <= 0 ? 0 : (wait + 999) / 1000;
    }

    public Check verify(String input) {
        String expected = notes.get(HASH);
        String saltHex = notes.get(SALT);
        String issued = notes.get(ISSUED_AT);
        if (expected == null || saltHex == null || issued == null) {
            return Check.NO_CODE;
        }
        if (clock.millis() - Long.parseLong(issued) > VALIDITY.toMillis()) {
            notes.remove(HASH);
            return Check.EXPIRED;
        }
        int wrong = Integer.parseInt(notes.get(WRONG) == null ? "0" : notes.get(WRONG));
        if (wrong >= MAX_WRONG) {
            notes.remove(HASH);
            return Check.TOO_MANY_ATTEMPTS;
        }
        String candidate = input == null ? "" : input.strip();
        boolean matches = candidate.matches("\\d{6}") && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.US_ASCII),
                hash(HexFormat.of().parseHex(saltHex), candidate).getBytes(StandardCharsets.US_ASCII));
        if (matches) {
            notes.remove(HASH);
            notes.remove(SALT);
            notes.remove(WRONG);
            return Check.VALID;
        }
        wrong++;
        notes.set(WRONG, Integer.toString(wrong));
        if (wrong >= MAX_WRONG) {
            notes.remove(HASH);
            return Check.TOO_MANY_ATTEMPTS;
        }
        return Check.WRONG;
    }

    private static String hash(byte[] salt, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(salt, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(code.getBytes(StandardCharsets.US_ASCII)));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HmacSHA256 is unavailable", failure);
        }
    }
}
