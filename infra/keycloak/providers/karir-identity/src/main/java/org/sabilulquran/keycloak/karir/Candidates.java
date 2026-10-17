package org.sabilulquran.keycloak.karir;

import java.security.SecureRandom;
import java.util.List;
import org.jboss.logging.Logger;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/** Candidate account attributes (REC-IMPL-001 §4.2) and lookup by {@code nik_hmac}. */
public final class Candidates {
    public static final String NIK_HMAC = "nik_hmac";
    public static final String WA_NUMBER = "wa_number";
    public static final String WA_VERIFIED = "wa_verified";
    public static final String SOURCE = "karir_source";
    public static final String SOURCE_SELF = "self";
    public static final String SOURCE_SIRE = "sire";

    private static final Logger LOG = Logger.getLogger(Candidates.class);
    private static final String USERNAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
    private static final SecureRandom RANDOM = new SecureRandom();

    private Candidates() {
    }

    /**
     * Finds the single account with this {@code nik_hmac}. More than one match is a data error that must not let
     * anyone sign in to an arbitrary account, so it is treated as "not found" and logged without the hash.
     */
    public static UserModel findByNikHmac(KeycloakSession session, RealmModel realm, String nikHmac) {
        return findByIdentifierHmac(session, realm, IdentityProfile.KARIR, nikHmac);
    }

    /** Same rule for any realm profile: {@code nik_hmac} in {@code sq-karir}, {@code kk_hmac} in {@code sq-keluarga}. */
    public static UserModel findByIdentifierHmac(KeycloakSession session, RealmModel realm, IdentityProfile profile,
                                                 String identifierHmac) {
        List<UserModel> matches = session.users()
                .searchForUserByUserAttributeStream(realm, profile.identifierAttribute(), identifierHmac)
                .limit(2)
                .toList();
        if (matches.size() > 1) {
            LOG.errorf("More than one account shares one %s in realm %s; refusing to choose",
                    profile.identifierAttribute(), realm.getName());
            return null;
        }
        return matches.isEmpty() ? null : matches.get(0);
    }

    /** {@code k_} followed by 20 base32 characters, the same shape Karir SQ uses for migrated accounts. */
    public static String randomUsername() {
        return randomUsername(IdentityProfile.KARIR);
    }

    /** Profile prefix ({@code k_} or {@code f_}) followed by 20 base32 characters. */
    public static String randomUsername(IdentityProfile profile) {
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        StringBuilder username = new StringBuilder(profile.usernamePrefix());
        for (byte value : bytes) {
            username.append(USERNAME_ALPHABET.charAt((value & 0xff) % 32));
        }
        return username.toString();
    }

    public static String waNumber(UserModel user) {
        String value = user.getFirstAttribute(WA_NUMBER);
        return value == null ? null : Contact.normalizeWaNumber(value);
    }

    public static boolean hasPassword(UserModel user) {
        return user.credentialManager().isConfiguredFor(org.keycloak.models.credential.PasswordCredentialModel.TYPE);
    }
}
