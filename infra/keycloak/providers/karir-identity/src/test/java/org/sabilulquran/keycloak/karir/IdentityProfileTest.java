package org.sabilulquran.keycloak.karir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.keycloak.models.UserModel;

class IdentityProfileTest {
    private static final String PEPPER = "p".repeat(32);

    @Test
    void realmNamesSelectProfilesAndEverythingElseFailsClosed() {
        assertEquals(IdentityProfile.KARIR, IdentityProfile.forRealm("sq-karir"));
        assertEquals(IdentityProfile.KELUARGA, IdentityProfile.forRealm("sq-keluarga"));
        assertNull(IdentityProfile.forRealm("sq-staff"));
        assertNull(IdentityProfile.forRealm(null));
    }

    @Test
    void karirHmacIsUnchanged() {
        String nik = "3209010101900001";
        assertEquals(Nik.hmac(PEPPER, nik), IdentityProfile.KARIR.hmac(PEPPER, nik));
    }

    @Test
    void kkHmacUsesItsOwnDomainPrefix() {
        String kk = "3209010101900001";
        String kkHmac = IdentityProfile.KELUARGA.hmac(PEPPER, kk);
        assertNotEquals(IdentityProfile.KARIR.hmac(PEPPER, kk), kkHmac);
        // Shared test vector with Keluarga SQ: HMAC-SHA256("p" x 32, "kk:v1:3209010101900001").
        assertEquals("a1fd03c56711ba58188a65f313099627135a4d14440c5881505d891ac417f6fb", kkHmac);
        assertEquals(kkHmac, IdentityProfile.KELUARGA.hmac(PEPPER, IdentityProfile.KELUARGA.normalize("3209-0101-0190-0001")));
    }

    @Test
    void waHashUsesE164WithPlus() {
        // Shared test vector with Keluarga SQ family_contacts.wa_hmac: HMAC-SHA256("p" x 32, "wa:v1:+6281234567890").
        assertEquals("87eeab6b95dab38f452547ddb60d606cd3ddf5a58341bd2fe13497e96bb0937a",
                IdentityProfile.waHash(PEPPER, "6281234567890"));
    }

    @Test
    void environmentPrefixesAndDefaultsDifferPerRealm() {
        Map<String, String> env = Map.of(
                "SQ_KARIR_NIK_PEPPER", PEPPER,
                "SQ_KELUARGA_KK_PEPPER", "k".repeat(32),
                "SQ_KELUARGA_OTP_RELAY_SECRET", "s".repeat(32));
        KarirConfig karir = KarirConfig.fromEnvironment(env, IdentityProfile.KARIR);
        KarirConfig keluarga = KarirConfig.fromEnvironment(env, IdentityProfile.KELUARGA);
        assertEquals(PEPPER, karir.nikPepper());
        assertFalse(karir.whatsAppRelayAvailable());
        assertEquals("k".repeat(32), keluarga.nikPepper());
        assertTrue(keluarga.whatsAppRelayAvailable());
        assertEquals("http://127.0.0.1:3306/internal/otp-deliveries", keluarga.relayUrl().toString());
        assertEquals("http://127.0.0.1:3304/internal/otp-deliveries", karir.relayUrl().toString());
        assertFalse(KarirConfig.unconfigured().nikLookupAvailable());
    }

    @Test
    void karirKeepsOneNumberWithBooleanVerification() {
        FakeUser user = new FakeUser();
        IdentityProfile.KARIR.setRegisteredContact(user.model(), "6281234567890");
        assertEquals(List.of("false"), user.attributes.get("wa_verified"));
        assertEquals("6281234567890", IdentityProfile.KARIR.numberToVerify(user.model()));
        IdentityProfile.KARIR.markVerified(user.model(), "6281234567890");
        assertEquals(List.of("true"), user.attributes.get("wa_verified"));
        assertNull(IdentityProfile.KARIR.numberToVerify(user.model()));
        assertEquals(List.of("6281234567890"), IdentityProfile.KARIR.resetNumbers(user.model()));
    }

    @Test
    void keluargaTracksEachVerifiedNumber() {
        FakeUser user = new FakeUser();
        IdentityProfile profile = IdentityProfile.KELUARGA;
        profile.setRegisteredContact(user.model(), "6281234567890");
        assertNull(user.attributes.get("wa_verified"));
        user.attributes.put("wa_numbers", List.of("6281234567890", "085711112222", "bukan nomor"));

        assertEquals(List.of("6281234567890", "6285711112222"), profile.waNumbers(user.model()));
        // Nothing verified yet (e.g. migrated family): every number on record is offered for reset.
        assertEquals(List.of("6281234567890", "6285711112222"), profile.resetNumbers(user.model()));

        profile.markVerified(user.model(), "6285711112222");
        profile.markVerified(user.model(), "6285711112222");
        assertEquals(List.of("6285711112222"), user.attributes.get("wa_verified"));
        // Once one number is verified, only verified numbers are offered.
        assertEquals(List.of("6285711112222"), profile.resetNumbers(user.model()));
        assertEquals("6281234567890", profile.numberToVerify(user.model()));
    }

    @Test
    void resetChannelIdsStayCompatibleWithKarir() {
        FakeUser karir = new FakeUser();
        karir.attributes.put("wa_number", List.of("6281234567890"));
        karir.email = "nama@contoh.id";
        assertEquals(List.of("whatsapp", "email"),
                List.copyOf(ResetByCodeAuthenticator.availableChannels(IdentityProfile.KARIR, karir.model()).keySet()));

        FakeUser keluarga = new FakeUser();
        keluarga.attributes.put("wa_numbers", List.of("6281234567890", "6285711112222"));
        var channels = ResetByCodeAuthenticator.availableChannels(IdentityProfile.KELUARGA, keluarga.model());
        assertEquals(List.of("whatsapp", "whatsapp-2"), List.copyOf(channels.keySet()));
        assertEquals("6285711112222", channels.get("whatsapp-2").waDigits());
        assertEquals("whatsapp", ResetByCodeAuthenticator.kind("whatsapp-2"));
        assertEquals("email", ResetByCodeAuthenticator.kind("email"));
    }

    @Test
    void onlyKeluargaLetsTheFamilyChangeTheNumberAtVerify() {
        assertTrue(IdentityProfile.KELUARGA.allowsNumberChangeAtVerify());
        assertFalse(IdentityProfile.KARIR.allowsNumberChangeAtVerify());
    }

    @Test
    void replaceNumberSwapsOneNumberAndKeepsTheRest() {
        FakeUser keluarga = new FakeUser();
        keluarga.attributes.put("wa_numbers", List.of("6281234567890", "6285711112222"));
        keluarga.attributes.put("wa_verified", List.of("6281234567890"));
        UserModel user = keluarga.model();

        IdentityProfile.KELUARGA.replaceNumber(user, "6285711112222", "6285733334444");

        assertEquals(List.of("6281234567890", "6285733334444"), IdentityProfile.KELUARGA.waNumbers(user));
        // The verified number is untouched, and the new one still has to pass a code.
        assertTrue(IdentityProfile.KELUARGA.isVerified(user, "6281234567890"));
        assertEquals("6285733334444", IdentityProfile.KELUARGA.numberToVerify(user));
    }

    @Test
    void replaceNumberNeverStoresTheSameNumberTwice() {
        FakeUser keluarga = new FakeUser();
        keluarga.attributes.put("wa_numbers", List.of("6281234567890", "6285711112222"));
        keluarga.attributes.put("wa_verified", List.of("6281234567890"));
        UserModel user = keluarga.model();

        // The family corrects the second number into the one they already verified.
        IdentityProfile.KELUARGA.replaceNumber(user, "6285711112222", "6281234567890");

        assertEquals(List.of("6281234567890"), IdentityProfile.KELUARGA.waNumbers(user));
        assertNull(IdentityProfile.KELUARGA.numberToVerify(user));
    }

    @Test
    void usernamePrefixFollowsProfile() {
        assertTrue(Candidates.randomUsername(IdentityProfile.KARIR).matches("k_[a-z2-7]{20}"));
        assertTrue(Candidates.randomUsername(IdentityProfile.KELUARGA).matches("f_[a-z2-7]{20}"));
    }

    /** Minimal in-memory {@link UserModel} for attribute logic; any other call fails the test. */
    static final class FakeUser {
        final Map<String, List<String>> attributes = new LinkedHashMap<>();
        String email;

        UserModel model() {
            return (UserModel) Proxy.newProxyInstance(UserModel.class.getClassLoader(), new Class<?>[]{UserModel.class},
                    (proxy, method, args) -> switch (method.getName()) {
                        case "getFirstAttribute" -> {
                            List<String> values = attributes.get((String) args[0]);
                            yield values == null || values.isEmpty() ? null : values.get(0);
                        }
                        case "getAttributeStream" -> {
                            List<String> values = attributes.get((String) args[0]);
                            yield values == null ? Stream.empty() : values.stream();
                        }
                        case "setSingleAttribute" -> {
                            attributes.put((String) args[0], List.of((String) args[1]));
                            yield null;
                        }
                        case "setAttribute" -> {
                            @SuppressWarnings("unchecked")
                            List<String> values = new ArrayList<>((List<String>) args[1]);
                            attributes.put((String) args[0], values);
                            yield null;
                        }
                        case "removeAttribute" -> {
                            attributes.remove((String) args[0]);
                            yield null;
                        }
                        case "getEmail" -> email;
                        case "hashCode" -> System.identityHashCode(proxy);
                        case "equals" -> proxy == args[0];
                        case "toString" -> "FakeUser";
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
        }
    }
}
