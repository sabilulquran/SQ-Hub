package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

/** Synthetic NIK and phone values only. Expected values were computed with karir-sq lib/nik.ts and lib/phone.ts. */
class NikAndContactTest {
    private static final String PEPPER = "test-pepper-for-unit-tests-only-0123456789";

    @ParameterizedTest
    @CsvSource({
            "3201234567890123, 3201234567890123",
            "' 3201 2345 6789 0123 ', 3201234567890123",
            "3201.2345.6789.0123, 3201234567890123",
            "3201-2345-6789-0123, 3201234567890123",
            "9601234567890123, 9601234567890123",
            "1101234567890123, 1101234567890123"
    })
    void normalizesValidNik(String input, String expected) {
        assertEquals(expected, Nik.normalize(input));
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
            "", "320123456789012", "32012345678901234", "320123456789012a", "1001234567890123",
            "9701234567890123", "0001234567890123", "3333333333333333", "3201/2345/6789/0123"
    })
    void rejectsInvalidNik(String input) {
        assertNull(Nik.normalize(input));
    }

    @Test
    void hmacMatchesKarirSq() {
        assertEquals("1ad6601e13d6eff78436354c5d01b6bc98bf9025ff3ad6750f820b8321818f7c",
                Nik.hmac(PEPPER, "3201234567890123"));
        assertEquals("42200b06bf05d061f80e6181d1bfa25cc3945d89f281ceb255964094967fc013",
                Nik.hmac(PEPPER, "9601234567890123"));
    }

    @ParameterizedTest
    @CsvSource({
            "081234567890, 6281234567890",
            "81234567890, 6281234567890",
            "6281234567890, 6281234567890",
            "+62 812-3456-7890, 6281234567890",
            "(0812) 3456.7890, 6281234567890"
    })
    void normalizesWhatsAppNumbers(String input, String expected) {
        assertEquals(expected, Contact.normalizeWaNumber(input));
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "0212345678", "+1 415 555 0100", "08123", "0812345678901234", "0812abc4567"})
    void rejectsInvalidWhatsAppNumbers(String input) {
        assertNull(Contact.normalizeWaNumber(input));
    }

    @Test
    void masksContacts() {
        assertEquals("0812•••••890", Contact.maskWaNumber("6281234567890"));
        assertEquals("0812••••••901", Contact.maskWaNumber("62812345678901"));
        assertEquals("n•••••@contoh.id", Contact.maskEmail("nama@contoh.id"));
    }

    @Test
    void randomUsernameHasKarirShape() {
        for (int i = 0; i < 100; i++) {
            String username = Candidates.randomUsername();
            assertEquals(22, username.length());
            assertEquals(true, username.matches("k_[a-z2-7]{20}"));
        }
    }
}
