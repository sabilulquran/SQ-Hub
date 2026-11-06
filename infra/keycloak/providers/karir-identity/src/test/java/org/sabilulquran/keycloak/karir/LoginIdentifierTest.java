package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

/** ADR-0010 as amended 2026-11-06: what the family sign-in field takes. Every value is synthetic. */
class LoginIdentifierTest {
    private static final String PEPPER = "p".repeat(32);
    private static final IdentityProfile KELUARGA = IdentityProfile.KELUARGA;
    private static final IdentityProfile KARIR = IdentityProfile.KARIR;

    @Test
    void familySignInTakesNumberEmailOrKk() {
        assertEquals(new LoginIdentifier(LoginIdentifier.Kind.WHATSAPP, "6285712345678"),
                LoginIdentifier.parse(KELUARGA, "0857-1234-5678"));
        assertEquals(new LoginIdentifier(LoginIdentifier.Kind.WHATSAPP, "6285712345678"),
                LoginIdentifier.parse(KELUARGA, " +62 857 1234 5678 "));
        assertEquals(new LoginIdentifier(LoginIdentifier.Kind.EMAIL, "ortu.uji@contoh.test"),
                LoginIdentifier.parse(KELUARGA, " Ortu.Uji@Contoh.TEST "));
        assertEquals(new LoginIdentifier(LoginIdentifier.Kind.REGISTRATION_ID, "3209010101900001"),
                LoginIdentifier.parse(KELUARGA, "3209-0101-0190-0001"));
    }

    @Test
    void familySignInRejectsAnythingElse() {
        assertNull(LoginIdentifier.parse(KELUARGA, null));
        assertNull(LoginIdentifier.parse(KELUARGA, "  "));
        assertNull(LoginIdentifier.parse(KELUARGA, "bukan nomor"));
        assertNull(LoginIdentifier.parse(KELUARGA, "021-555-1234"));
        assertNull(LoginIdentifier.parse(KELUARGA, "ortu@"));
        assertNull(LoginIdentifier.parse(KELUARGA, "ortu uji@contoh.test"));
        assertNull(LoginIdentifier.parse(KELUARGA, "a".repeat(250) + "@contoh.test"));
    }

    @Test
    void karirStillTakesOnlyTheNik() {
        assertEquals(LoginIdentifier.Kind.REGISTRATION_ID, LoginIdentifier.parse(KARIR, "3209010101900001").kind());
        assertNull(LoginIdentifier.parse(KARIR, "085712345678"));
        assertNull(LoginIdentifier.parse(KARIR, "calon@contoh.test"));
        assertEquals("nik", KARIR.loginField());
        assertEquals("identifier", KELUARGA.loginField());
        assertEquals("kk", KELUARGA.formField());
    }

    @Test
    void codeLimitKeysAreSeparatedByKind() {
        LoginIdentifier kk = LoginIdentifier.parse(KELUARGA, "3209010101900001");
        LoginIdentifier wa = LoginIdentifier.parse(KELUARGA, "085712345678");
        LoginIdentifier email = LoginIdentifier.parse(KELUARGA, "ortu@contoh.test");
        assertEquals(KELUARGA.hmac(PEPPER, "3209010101900001"), kk.hmac(KELUARGA, PEPPER));
        assertEquals(IdentityProfile.waHash(PEPPER, "6285712345678"), wa.hmac(KELUARGA, PEPPER));
        assertNotEquals(kk.hmac(KELUARGA, PEPPER), email.hmac(KELUARGA, PEPPER));
        assertEquals(64, email.hmac(KELUARGA, PEPPER).length());
    }
}
