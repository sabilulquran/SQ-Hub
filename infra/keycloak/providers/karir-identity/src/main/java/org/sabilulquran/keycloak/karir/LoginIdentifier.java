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
 * 2026-11-06), and still accepts the nomor KK as a fallback that the page does not offer.
 *
 * <p>Only family accounts take part in a number or email lookup: an account with a {@code kk_hmac} that is not a
 * brokered staff identity. A number or email may be on more than one family account (one parent with children on two
 * KKs). When any of them proved it (a verified number, a verified email), only those take part, and the caller lets
 * the kata sandi choose. A number or email that nobody proved names an account only when exactly one account holds
 * it; otherwise the match is {@linkplain Match#ambiguous() ambiguous} and the caller asks for the KK. So an account
 * registered with somebody else's number never competes with that person's own account.
 */
record LoginIdentifier(Kind kind, String value) {
    enum Kind { REGISTRATION_ID, WHATSAPP, EMAIL }

    /** More accounts than this behind one proved number or email is not a family; the lookup then finds nothing. */
    static final int MAX_MATCHES = 5;
    /** Accounts read per lookup before filtering. */
    private static final int SCAN_LIMIT = 50;

    private static final Pattern EMAIL = Pattern.compile("[^\\s@]{1,64}@[^\\s@]+\\.[^\\s@]+");
    private static final String SOURCE_STAFF_BROKER = "staff_broker";
    private static final Logger LOG = Logger.getLogger(LoginIdentifier.class);

    /**
     * The accounts a lookup found. {@code ambiguous} means several accounts hold an identifier none of them proved:
     * the KK has to choose, and no kata sandi or code may.
     */
    record Match(List<UserModel> accounts, boolean ambiguous) {
        static final Match NONE = new Match(List.of(), false);

        static Match of(List<UserModel> accounts) {
            return new Match(List.copyOf(accounts), false);
        }
    }

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

    boolean isContact() {
        return kind != Kind.REGISTRATION_ID;
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

    /** Whether this account proved the typed number or email. */
    boolean provedBy(IdentityProfile profile, UserModel user) {
        return switch (kind) {
            case REGISTRATION_ID -> true;
            case WHATSAPP -> profile.isVerified(user, value);
            case EMAIL -> user.isEmailVerified() && value.equalsIgnoreCase(user.getEmail());
        };
    }

    /** The accounts this identifier names; see the class comment for the rules. */
    Match findAccounts(KeycloakSession session, RealmModel realm, IdentityProfile profile, String pepper) {
        if (kind == Kind.REGISTRATION_ID) {
            UserModel user = Candidates.findByIdentifierHmac(session, realm, profile, profile.hmac(pepper, value));
            return user == null ? Match.NONE : Match.of(List.of(user));
        }
        List<UserModel> holders = (kind == Kind.WHATSAPP
                ? session.users().searchForUserByUserAttributeStream(realm, profile.waAttribute(), value).limit(SCAN_LIMIT)
                : session.users().searchForUserStream(realm,
                                Map.of(UserModel.EMAIL, value, UserModel.EXACT, Boolean.TRUE.toString()), 0, SCAN_LIMIT)
                        .filter(user -> value.equalsIgnoreCase(user.getEmail())))
                .filter(user -> isFamilyAccount(session, realm, profile, user))
                .toList();
        List<UserModel> proved = holders.stream().filter(user -> provedBy(profile, user)).toList();
        if (proved.size() > MAX_MATCHES) {
            LOG.errorf("More than %d accounts proved one %s in realm %s; refusing to choose",
                    MAX_MATCHES, kind == Kind.WHATSAPP ? "WhatsApp number" : "email", realm.getName());
            return Match.NONE;
        }
        if (!proved.isEmpty()) {
            return Match.of(proved);
        }
        return holders.size() > 1 ? new Match(holders, true) : Match.of(holders);
    }

    /**
     * A family account: it holds a KK and is not a brokered staff identity. A staff parent signs in with the staff
     * Akun SQ; a local kata sandi must never be set on that principal through a number or email (ADR-0010).
     */
    private static boolean isFamilyAccount(KeycloakSession session, RealmModel realm, IdentityProfile profile,
                                           UserModel user) {
        return user.getFirstAttribute(profile.identifierAttribute()) != null
                && !SOURCE_STAFF_BROKER.equals(user.getFirstAttribute(profile.sourceAttribute()))
                && session.users().getFederatedIdentitiesStream(realm, user).findAny().isEmpty();
    }
}
