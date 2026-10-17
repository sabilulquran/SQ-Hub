package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class OtpStateTest {
    private final Map<String, String> notes = new HashMap<>();
    private final MutableClock clock = new MutableClock();
    private final OtpState otp = new OtpState(new OtpState.Notes() {
        @Override
        public String get(String name) {
            return notes.get(name);
        }

        @Override
        public void set(String name, String value) {
            notes.put(name, value);
        }

        @Override
        public void remove(String name) {
            notes.remove(name);
        }
    }, clock);

    @Test
    void codeIsSixDigitsAndOnlyItsSaltedHashIsStored() {
        String code = otp.issue("whatsapp");
        assertTrue(code.matches("\\d{6}"));
        assertFalse(notes.containsValue(code));
        assertEquals("whatsapp", otp.channel());
    }

    @Test
    void validCodeIsAcceptedOnce() {
        String code = otp.issue("whatsapp");
        assertEquals(OtpState.Check.VALID, otp.verify(code));
        assertEquals(OtpState.Check.NO_CODE, otp.verify(code));
    }

    @Test
    void codeExpiresAfterTenMinutes() {
        String code = otp.issue("email");
        clock.advance(Duration.ofMinutes(10).plusSeconds(1));
        assertEquals(OtpState.Check.EXPIRED, otp.verify(code));
    }

    @Test
    void codeStillValidJustBeforeTenMinutes() {
        String code = otp.issue("email");
        clock.advance(Duration.ofMinutes(9).plusSeconds(59));
        assertEquals(OtpState.Check.VALID, otp.verify(code));
    }

    @Test
    void fifthWrongEntryBurnsTheCode() {
        String code = otp.issue("whatsapp");
        String wrong = code.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 4; i++) {
            assertEquals(OtpState.Check.WRONG, otp.verify(wrong));
        }
        assertEquals(OtpState.Check.TOO_MANY_ATTEMPTS, otp.verify(wrong));
        assertNotEquals(OtpState.Check.VALID, otp.verify(code));
    }

    @Test
    void malformedInputIsWrong() {
        otp.issue("whatsapp");
        assertEquals(OtpState.Check.WRONG, otp.verify("12a456"));
        assertEquals(OtpState.Check.WRONG, otp.verify(null));
    }

    @Test
    void resendWaitsSixtySeconds() {
        assertEquals(0, otp.secondsUntilResend());
        otp.issue("whatsapp");
        assertEquals(60, otp.secondsUntilResend());
        clock.advance(Duration.ofSeconds(59));
        assertEquals(1, otp.secondsUntilResend());
        clock.advance(Duration.ofSeconds(1));
        assertEquals(0, otp.secondsUntilResend());
    }

    @Test
    void newCodeReplacesOldCodeAndResetsWrongCount() {
        String first = otp.issue("whatsapp");
        String wrong = first.equals("000000") ? "111111" : "000000";
        otp.verify(wrong);
        clock.advance(Duration.ofSeconds(61));
        String second = otp.issue("email");
        if (!first.equals(second)) {
            assertEquals(OtpState.Check.WRONG, otp.verify(first));
        }
        assertEquals(OtpState.Check.VALID, otp.verify(second));
        assertEquals("email", otp.channel());
    }

    @Test
    void clearForgetsTheCode() {
        String code = otp.issue("whatsapp");
        otp.clear();
        assertFalse(otp.hasCode());
        assertEquals(OtpState.Check.NO_CODE, otp.verify(code));
        assertEquals(0, otp.secondsUntilResend());
    }
}
