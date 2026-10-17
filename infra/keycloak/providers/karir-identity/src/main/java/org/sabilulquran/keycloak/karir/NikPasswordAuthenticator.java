package org.sabilulquran.keycloak.karir;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.authenticators.browser.AbstractUsernameFormAuthenticator;
import org.keycloak.authentication.authenticators.util.AuthenticatorUtils;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserCredentialModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.services.managers.AuthenticationManager;

/**
 * "NIK + kata sandi" sign-in form (REC-IMPL-001 §4.3), or "Nomor KK + kata sandi" in {@code sq-keluarga}
 * (KEL-IMPL-001 §4.3). The user is found by the identifier HMAC; the NIK or KK is not stored,
 * logged, put in an event or sent back to the browser. Failures for wrong NIK or wrong kata sandi look the same.
 */
final class NikPasswordAuthenticator implements Authenticator {
    static final String TEMPLATE = "login.ftl";
    private static final Logger LOG = Logger.getLogger(NikPasswordAuthenticator.class);

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        context.challenge(render(context, null));
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        IdentityProfile profile = runtime.profile();
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();
        // A previous attempt in this browser must never be charged to the account of this attempt or vice versa.
        context.getAuthenticationSession().removeAuthNote(AbstractUsernameFormAuthenticator.ATTEMPTED_USERNAME);
        context.clearUser();

        String ip = KarirForms.clientIp(context.getConnection());
        String abuse = KarirForms.checkAbuse(runtime, AbuseGuard.NikForm.LOGIN, ip, input.getFirst(TurnstileVerifier.FORM_FIELD));
        if (abuse != null) {
            context.getEvent().error(KarirForms.IP_BLOCKED.equals(abuse) ? KarirEvents.IP_BLOCKED : KarirEvents.TURNSTILE_FAILED);
            context.forceChallenge(render(context, abuse));
            return;
        }
        if (!runtime.config().nikLookupAvailable()) {
            LOG.warnf("%s is not configured; sign-in in realm %s is unavailable",
                    profile.pepperVariable(), context.getRealm().getName());
            context.getEvent().error(Errors.INVALID_CONFIG);
            context.forceChallenge(render(context, KarirForms.SERVICE_UNAVAILABLE));
            return;
        }

        String identifier = profile.normalize(input.getFirst(profile.formField()));
        String password = input.getFirst(KarirForms.FIELD_PASSWORD);
        UserModel user = identifier == null ? null
                : Candidates.findByIdentifierHmac(context.getSession(), context.getRealm(), profile,
                        profile.hmac(runtime.config().nikPepper(), identifier));
        if (user == null) {
            AuthenticatorUtils.dummyHash(context);
            context.getEvent().error(Errors.USER_NOT_FOUND);
            context.failureChallenge(AuthenticationFlowError.INVALID_USER, render(context, KarirForms.INVALID_CREDENTIALS));
            return;
        }

        // Brute-force bookkeeping works on the opaque k_/f_ username, never on the NIK or KK.
        context.getAuthenticationSession().setAuthNote(AbstractUsernameFormAuthenticator.ATTEMPTED_USERNAME, user.getUsername());
        String bruteForceError = AuthenticatorUtils.getDisabledByBruteForceEventError(context, user);
        if (bruteForceError != null) {
            context.getEvent().user(user).error(bruteForceError);
            context.forceChallenge(render(context, KarirForms.INVALID_CREDENTIALS));
            return;
        }

        if (!Candidates.hasPassword(user)) {
            if (!user.isEnabled()) {
                context.getEvent().user(user).error(Errors.USER_DISABLED);
                context.forceChallenge(render(context, KarirForms.ACCOUNT_DISABLED));
            } else {
                context.getEvent().user(user).error(KarirEvents.PASSWORD_NOT_SET);
                context.forceChallenge(render(context, KarirForms.NO_PASSWORD));
            }
            return;
        }

        if (password == null || password.isEmpty()
                || !user.credentialManager().isValid(UserCredentialModel.password(password))) {
            context.getEvent().user(user).error(Errors.INVALID_USER_CREDENTIALS);
            context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, render(context, KarirForms.INVALID_CREDENTIALS));
            return;
        }

        if (!user.isEnabled()) {
            context.getEvent().user(user).error(Errors.USER_DISABLED);
            context.forceChallenge(render(context, KarirForms.ACCOUNT_DISABLED));
            return;
        }

        context.getAuthenticationSession().setAuthNote(AuthenticationManager.PASSWORD_VALIDATED, "true");
        context.setUser(user);
        context.success();
    }

    private Response render(AuthenticationFlowContext context, String error) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        String ip = KarirForms.clientIp(context.getConnection());
        LoginFormsProvider form = context.form();
        KarirForms.turnstile(form, runtime.config(),
                runtime.abuseGuard().turnstileRequired(AbuseGuard.NikForm.LOGIN, ip));
        if (error != null) {
            form.addError(new FormMessage(runtime.profile().formField(), error));
        }
        return form.createForm(TEMPLATE);
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
