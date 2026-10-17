package org.sabilulquran.keycloak.karir;

import jakarta.ws.rs.core.MultivaluedHashMap;
import jakarta.ws.rs.core.MultivaluedMap;
import java.util.ArrayList;
import java.util.List;
import org.jboss.logging.Logger;
import org.keycloak.authentication.FormAction;
import org.keycloak.authentication.FormContext;
import org.keycloak.authentication.ValidationContext;
import org.keycloak.events.Details;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserCredentialModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.policy.PasswordPolicyManagerProvider;
import org.keycloak.policy.PolicyError;

/**
 * Registration form action (REC-IMPL-001 §4.3): NIK, nama lengkap, nomor WhatsApp, kata sandi, persetujuan data and
 * Turnstile. A new account gets a random {@code k_} username, {@code nik_hmac}, {@code karir_source=self} and the
 * WhatsApp verification required action. An NIK that already has an account only gets "NIK ini sudah terdaftar".
 */
final class NikRegistrationFormAction implements FormAction {
    static final String FIELD_NAME = "firstName";
    static final String FIELD_WA = "waNumber";
    static final String FIELD_PASSWORD_CONFIRM = "password-confirm";
    static final String FIELD_CONSENT = "consent";
    static final int MAX_NAME_LENGTH = 255;

    private static final String NOTE_USERNAME = "karir.register.username";
    private static final String NOTE_NIK_HMAC = "karir.register.nikHmac";
    private static final String NOTE_WA = "karir.register.wa";
    private static final String NOTE_NIK_REGISTERED = "karir.register.nikRegistered";
    private static final Logger LOG = Logger.getLogger(NikRegistrationFormAction.class);

    @Override
    public void buildPage(FormContext context, LoginFormsProvider form) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        KarirForms.turnstile(form, runtime.config(), true);
        if ("true".equals(context.getAuthenticationSession().getAuthNote(NOTE_NIK_REGISTERED))) {
            form.setAttribute("karirNikRegistered", true);
            context.getAuthenticationSession().removeAuthNote(NOTE_NIK_REGISTERED);
        }
    }

    @Override
    public void validate(ValidationContext context) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        IdentityProfile profile = runtime.profile();
        String field = profile.formField();
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();
        MultivaluedMap<String, String> echo = echo(input, field);
        context.getAuthenticationSession().removeAuthNote(NOTE_NIK_REGISTERED);

        String ip = KarirForms.clientIp(context.getConnection());
        String abuse = KarirForms.checkAbuse(runtime, AbuseGuard.NikForm.REGISTER, ip, input.getFirst(TurnstileVerifier.FORM_FIELD));
        if (abuse != null) {
            fail(context, echo, KarirForms.IP_BLOCKED.equals(abuse) ? KarirEvents.IP_BLOCKED : KarirEvents.TURNSTILE_FAILED,
                    List.of(new FormMessage(null, abuse)));
            return;
        }
        if (!runtime.config().nikLookupAvailable()) {
            LOG.warnf("%s is not configured; registration in realm %s is unavailable",
                    profile.pepperVariable(), context.getRealm().getName());
            fail(context, echo, Errors.INVALID_CONFIG, List.of(new FormMessage(null, KarirForms.SERVICE_UNAVAILABLE)));
            return;
        }

        List<FormMessage> errors = new ArrayList<>();
        String nik = profile.normalize(input.getFirst(field));
        if (nik == null) {
            errors.add(new FormMessage(field, KarirForms.INVALID_NIK));
        }
        String name = input.getFirst(FIELD_NAME) == null ? "" : input.getFirst(FIELD_NAME).strip();
        if (name.isEmpty() || name.length() > MAX_NAME_LENGTH) {
            errors.add(new FormMessage(FIELD_NAME, KarirForms.NAME_REQUIRED));
        }
        String wa = Contact.normalizeWaNumber(input.getFirst(FIELD_WA));
        if (wa == null) {
            errors.add(new FormMessage(FIELD_WA, KarirForms.INVALID_WA));
        }
        String password = input.getFirst(KarirForms.FIELD_PASSWORD);
        String username = Candidates.randomUsername(profile);
        if (password == null || password.isEmpty()) {
            errors.add(new FormMessage(KarirForms.FIELD_PASSWORD, KarirForms.PASSWORD_REQUIRED));
        } else if (!password.equals(input.getFirst(FIELD_PASSWORD_CONFIRM))) {
            errors.add(new FormMessage(FIELD_PASSWORD_CONFIRM, KarirForms.PASSWORD_MISMATCH));
        } else {
            PolicyError policy = context.getSession().getProvider(PasswordPolicyManagerProvider.class).validate(username, password);
            if (policy != null) {
                errors.add(new FormMessage(KarirForms.FIELD_PASSWORD, policy.getMessage(), policy.getParameters()));
            }
        }
        if (!"on".equals(input.getFirst(FIELD_CONSENT))) {
            errors.add(new FormMessage(FIELD_CONSENT, KarirForms.CONSENT_REQUIRED));
        }

        if (nik != null) {
            String nikHmac = profile.hmac(runtime.config().nikPepper(), nik);
            if (Candidates.findByIdentifierHmac(context.getSession(), context.getRealm(), profile, nikHmac) != null) {
                // Only this message: nothing else about the existing account is revealed.
                context.getAuthenticationSession().setAuthNote(NOTE_NIK_REGISTERED, "true");
                context.excludeOtherErrors();
                fail(context, echo, KarirEvents.NIK_ALREADY_REGISTERED,
                        List.of(new FormMessage(field, KarirForms.NIK_REGISTERED)));
                return;
            }
            context.getAuthenticationSession().setAuthNote(NOTE_NIK_HMAC, nikHmac);
        }

        if (!errors.isEmpty()) {
            fail(context, echo, Errors.INVALID_REGISTRATION, errors);
            return;
        }
        context.getAuthenticationSession().setAuthNote(NOTE_USERNAME, username);
        context.getAuthenticationSession().setAuthNote(NOTE_WA, wa);
        context.success();
    }

    @Override
    public void success(FormContext context) {
        IdentityProfile profile = KarirRuntime.forRealm(context.getRealm()).profile();
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();
        String username = context.getAuthenticationSession().getAuthNote(NOTE_USERNAME);
        String nikHmac = context.getAuthenticationSession().getAuthNote(NOTE_NIK_HMAC);
        String wa = context.getAuthenticationSession().getAuthNote(NOTE_WA);
        context.getAuthenticationSession().removeAuthNote(NOTE_USERNAME);
        context.getAuthenticationSession().removeAuthNote(NOTE_NIK_HMAC);
        context.getAuthenticationSession().removeAuthNote(NOTE_WA);

        UserModel user = context.getSession().users().addUser(context.getRealm(), username);
        user.setEnabled(true);
        user.setFirstName(input.getFirst(FIELD_NAME).strip());
        user.setSingleAttribute(profile.identifierAttribute(), nikHmac);
        profile.setRegisteredContact(user, wa);
        user.setSingleAttribute(profile.sourceAttribute(), IdentityProfile.SOURCE_SELF);
        user.credentialManager().updateCredential(UserCredentialModel.password(input.getFirst(KarirForms.FIELD_PASSWORD), false));
        user.addRequiredAction(VerifyWhatsAppRequiredActionFactory.PROVIDER_ID);

        context.setUser(user);
        context.getEvent().user(user).detail(Details.REGISTER_METHOD, "form");
    }

    private static void fail(ValidationContext context, MultivaluedMap<String, String> echo, String eventError,
                             List<FormMessage> errors) {
        context.error(eventError);
        context.validationError(echo, errors);
    }

    /** Form values sent back to the page: never the kata sandi or the Turnstile token. */
    private static MultivaluedMap<String, String> echo(MultivaluedMap<String, String> input, String identifierField) {
        MultivaluedMap<String, String> echo = new MultivaluedHashMap<>();
        for (String field : List.of(identifierField, FIELD_NAME, FIELD_WA, FIELD_CONSENT)) {
            if (input.getFirst(field) != null) {
                echo.putSingle(field, input.getFirst(field));
            }
        }
        return echo;
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public void close() {
    }
}
