package org.sabilulquran.keycloak.karir;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * What a user typed in the identifier field of the sign-in or "Lupa kata sandi" form, and the accounts it names.
 *
 * <p>{@code sq-karir} takes the NIK only. {@code sq-keluarga} takes a WhatsApp number or an email (ADR-0010, amended
 * 2026-11-06), and still accepts the nomor KK as a fallback that the page does not offer. A WhatsApp number or an
 * email may belong to more than one family account (one parent with children on two KKs), so a lookup returns every
 * account it names, up to {@link #MAX_MATCHES}; the caller decides by kata sandi or asks for the KK.
 */
record LoginIdentifier(Kind kind, String value) {
    enum Kind { REGISTRATION_ID, WHATSAPP, EMAIL }

    /** More accounts than this behind one number or email is not a family; the lookup then finds nothing. */
    static final int MAX_MATCHES = 5;

    private static final Pattern EMAIL = Pattern.compile("[^\\s@]{1,64}@[^\\s@]+\\.[^\\s@]+");
    private static final Logger LOG = Logger.getLogger(LoginIdentifier.class);

    /** The identifier, or {@code null} when the input is none of the kinds this realm takes. */
    static LoginIdentifier parse(IdentityProfile profile, String input) {
        if (input == null || input.isBlank()) {
            return null;
        }
        String registrationId = profile.normalize(input);
        if (registrationId != null) {
            return new LoginIdentifier(Kind.REGISTRATION_ID, registrationId);
        }
        if (!profile.contactLogin()) {
            return null;
        }
        String trimmed = input.strip();
        if (trimmed.indexOf('@') >= 0) {
            String email = trimmed.toLowerCase(Locale.ROOT);
            return email.length() <= 255 && EMAIL.matcher(email).matches() ? new LoginIdentifier(Kind.EMAIL, email) : null;
        }
        String wa = Contact.normalizeWaNumber(trimmed);
        return wa == null ? null : new LoginIdentifier(Kind.WHATSAPP, wa);
    }

    /**
     * A keyed hash of the identifier for the per-identifier code limit. The registration identifier keeps its own
     * {@code nik_hmac} / {@code kk_hmac}; a number uses the {@code wa_hash} form; an email its own domain prefix.
     */
    String hmac(IdentityProfile profile, String pepper) {
        return switch (kind) {
            case REGISTRATION_ID -> profile.hmac(pepper, value);
            case WHATSAPP -> IdentityProfile.waHash(pepper, value);
            case EMAIL -> IdentityProfile.hmacHex(pepper, "email:v1:" + value);
        };
    }

    /** Every account this identifier names: at most one for a NIK or KK, up to {@link #MAX_MATCHES} otherwise. */
    List<UserModel> findAccounts(KeycloakSession session, RealmModel realm, IdentityProfile profile, String pepper) {
        if (kind == Kind.REGISTRATION_ID) {
            UserModel user = Candidates.findByIdentifierHmac(session, realm, profile, profile.hmac(pepper, value));
            return user == null ? List.of() : List.of(user);
        }
        List<UserModel> matches = kind == Kind.WHATSAPP
                ? session.users().searchForUserByUserAttributeStream(realm, profile.waAttribute(), value)
                        .limit(MAX_MATCHES + 1L).toList()
                : session.users().searchForUserStream(realm,
                                Map.of(UserModel.EMAIL, value, UserModel.EXACT, Boolean.TRUE.toString()), 0, MAX_MATCHES + 1)
                        .filter(user -> value.equalsIgnoreCase(user.getEmail()))
                        .toList();
        if (matches.size() > MAX_MATCHES) {
            LOG.errorf("More than %d accounts share one %s in realm %s; refusing to choose",
                    MAX_MATCHES, kind == Kind.WHATSAPP ? "WhatsApp number" : "email", realm.getName());
            return List.of();
        }
        return matches;
    }
}
