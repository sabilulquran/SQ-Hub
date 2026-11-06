package org.sabilulquran.keycloak.karir;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.List;
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
import org.keycloak.services.managers.BruteForceProtector;

/**
 * "NIK + kata sandi" sign-in form (REC-IMPL-001 §4.3), or, in {@code sq-keluarga}, "nomor WhatsApp atau email +
 * kata sandi" (ADR-0010 as amended 2026-11-06; the nomor KK is still accepted). A NIK or KK is found by its HMAC and is
 * not stored, logged, put in an event or sent back to the browser; neither is the number or email. Failures for an
 * unknown identifier or a wrong kata sandi look the same.
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

        LoginIdentifier identifier = LoginIdentifier.parse(profile, input.getFirst(profile.loginField()));
        String password = input.getFirst(KarirForms.FIELD_PASSWORD);
        LoginIdentifier.Match match = identifier == null ? LoginIdentifier.Match.NONE
                : identifier.findAccounts(context.getSession(), context.getRealm(), profile, runtime.config().nikPepper());
        List<UserModel> accounts = match.accounts();
        if (match.ambiguous()) {
            // Several accounts hold a number or email none of them proved: only the KK may choose.
            AuthenticatorUtils.dummyHash(context);
            context.getEvent().error(KarirEvents.SHARED_CONTACT);
            context.forceChallenge(render(context, KarirForms.SHARED_CONTACT_SAME_PASSWORD));
            return;
        }
        if (accounts.isEmpty()) {
            AuthenticatorUtils.dummyHash(context);
            context.getEvent().error(Errors.USER_NOT_FOUND);
            context.failureChallenge(AuthenticationFlowError.INVALID_USER, render(context, KarirForms.INVALID_CREDENTIALS));
            return;
        }
        if (accounts.size() == 1) {
            signIn(context, accounts.get(0), password);
        } else {
            signInSharedContact(context, accounts, password);
        }
    }

    /** One account behind the identifier: the original NIK / KK rules. */
    private void signIn(AuthenticationFlowContext context, UserModel user, String password) {
        // Brute-force bookkeeping works on the opaque k_/f_ username, never on the NIK, KK, number or email.
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

        if (!passwordMatches(user, password)) {
            context.getEvent().user(user).error(Errors.INVALID_USER_CREDENTIALS);
            context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, render(context, KarirForms.INVALID_CREDENTIALS));
            return;
        }

        if (!user.isEnabled()) {
            context.getEvent().user(user).error(Errors.USER_DISABLED);
            context.forceChallenge(render(context, KarirForms.ACCOUNT_DISABLED));
            return;
        }

        succeed(context, user);
    }

    /**
     * Several family accounts proved the same WhatsApp number or email (sq-keluarga only): the kata sandi picks the
     * one. Every account with a kata sandi is checked, locked and disabled ones too, so the right kata sandi for a
     * locked account is never charged to the others; a locked or disabled account still cannot sign in. A wrong kata
     * sandi counts as a failure on every account that took part, so sharing a number never buys extra guesses.
     */
    private void signInSharedContact(AuthenticationFlowContext context, List<UserModel> accounts, String password) {
        List<UserModel> withPassword = new ArrayList<>();
        boolean anyWithoutPassword = false;
        for (UserModel user : accounts) {
            if (Candidates.hasPassword(user)) {
                withPassword.add(user);
            } else if (user.isEnabled()) {
                anyWithoutPassword = true;
            }
        }
        if (withPassword.isEmpty()) {
            AuthenticatorUtils.dummyHash(context);
            context.getEvent().error(anyWithoutPassword ? KarirEvents.PASSWORD_NOT_SET : Errors.USER_DISABLED);
            context.forceChallenge(render(context, anyWithoutPassword ? KarirForms.NO_PASSWORD : KarirForms.ACCOUNT_DISABLED));
            return;
        }
        List<UserModel> matched = new ArrayList<>();
        for (UserModel user : withPassword) {
            if (passwordMatches(user, password)) {
                matched.add(user);
            }
        }
        for (UserModel user : matched) {
            String bruteForceError = AuthenticatorUtils.getDisabledByBruteForceEventError(context, user);
            if (bruteForceError != null) {
                // Answer exactly as for one locked account: the page must not tell a right kata sandi from a wrong
                // one while the account is locked, and nothing is charged to the other accounts.
                context.getAuthenticationSession().setAuthNote(AbstractUsernameFormAuthenticator.ATTEMPTED_USERNAME, user.getUsername());
                context.getEvent().user(user).error(bruteForceError);
                context.forceChallenge(render(context, KarirForms.INVALID_CREDENTIALS));
                return;
            }
        }
        if (matched.size() > 1) {
            // The same kata sandi on two accounts of one number: only the KK can tell them apart.
            context.getEvent().error(KarirEvents.SHARED_CONTACT);
            context.forceChallenge(render(context, KarirForms.SHARED_CONTACT_SAME_PASSWORD));
            return;
        }
        if (matched.size() == 1) {
            UserModel user = matched.get(0);
            context.getAuthenticationSession().setAuthNote(AbstractUsernameFormAuthenticator.ATTEMPTED_USERNAME, user.getUsername());
            if (!user.isEnabled()) {
                context.getEvent().user(user).error(Errors.USER_DISABLED);
                context.forceChallenge(render(context, KarirForms.ACCOUNT_DISABLED));
                return;
            }
            succeed(context, user);
            return;
        }
        // Keycloak records the failure for the attempted username; the other accounts are recorded here.
        if (context.getRealm().isBruteForceProtected()) {
            BruteForceProtector protector = context.getSession().getProvider(BruteForceProtector.class);
            for (UserModel user : withPassword.subList(1, withPassword.size())) {
                protector.failedLogin(context.getRealm(), user, context.getConnection(), context.getUriInfo(), null);
            }
        }
        context.getAuthenticationSession().setAuthNote(AbstractUsernameFormAuthenticator.ATTEMPTED_USERNAME,
                withPassword.get(0).getUsername());
        context.getEvent().error(Errors.INVALID_USER_CREDENTIALS);
        context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, render(context, KarirForms.INVALID_CREDENTIALS));
    }

    private static boolean passwordMatches(UserModel user, String password) {
        return password != null && !password.isEmpty()
                && user.credentialManager().isValid(UserCredentialModel.password(password));
    }

    private static void succeed(AuthenticationFlowContext context, UserModel user) {
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
            form.addError(new FormMessage(runtime.profile().loginField(), error));
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
