package org.sabilulquran.keycloak.trusteddevice;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.authenticators.browser.AbstractUsernameFormAuthenticator;
import org.keycloak.authentication.authenticators.browser.OTPFormAuthenticator;
import org.keycloak.events.Details;
import org.keycloak.events.Errors;
import org.keycloak.models.UserCredentialModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.credential.OTPCredentialModel;
import org.keycloak.models.credential.PasswordCredentialModel;
import org.keycloak.services.messages.Messages;
import org.keycloak.services.validation.Validation;

final class TrustedDeviceOtpAuthenticator extends OTPFormAuthenticator {
    static final String COOKIE_NAME = "SQ_TRUSTED_DEVICE";
    static final String USER_ATTRIBUTE = "sq.internal.trusted-device.v1";
    static final String FORM_FIELD = "trustDevice";
    private final TrustedDeviceManager manager;

    TrustedDeviceOtpAuthenticator(TrustedDeviceManager manager) {
        this.manager = manager;
    }

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        UserModel user = context.getUser();
        if (user == null) {
            expireCookie(context);
            super.authenticate(context);
            return;
        }
        if (!user.isEnabled()) {
            expireCookie(context);
            context.failure(AuthenticationFlowError.USER_DISABLED);
            return;
        }
        if (manager == null) {
            expireCookie(context);
            super.authenticate(context);
            return;
        }

        String cookie = context.getSession().getContext().getRequestHeaders().getCookies().containsKey(COOKIE_NAME)
                ? context.getSession().getContext().getRequestHeaders().getCookies().get(COOKIE_NAME).getValue()
                : null;
        String fingerprint = credentialFingerprint(user);
        List<String> records = user.getAttributeStream(USER_ATTRIBUTE).collect(Collectors.toCollection(ArrayList::new));
        TrustedDeviceManager.Validation result = manager.validateAndRotate(
                cookie, context.getRealm().getId(), user.getId(), fingerprint, records);
        persistRecords(user, result.records());

        if (result.trusted()) {
            setCookie(context, result.rotatedCookie(), TrustedDeviceManager.LIFETIME_SECONDS);
            context.success();
            return;
        }

        if (cookie != null) {
            expireCookie(context);
        }
        super.authenticate(context);
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        MultivaluedMap<String, String> inputData = context.getHttpRequest().getDecodedFormParameters();
        String otp = inputData.getFirst("otp");
        String credentialId = inputData.getFirst("selectedCredentialId");

        if (credentialId == null || credentialId.isEmpty()) {
            OTPCredentialModel defaultCredential = getCredentialProvider(context.getSession())
                    .getDefaultCredential(context.getSession(), context.getRealm(), context.getUser());
            credentialId = defaultCredential == null ? "" : defaultCredential.getId();
        }
        context.getEvent().detail(Details.SELECTED_CREDENTIAL_ID, credentialId);
        context.form().setAttribute(SELECTED_OTP_CREDENTIAL_ID, credentialId);

        UserModel user = context.getUser();
        boolean userEnabled = enabledUser(context, user);
        if (userEnabled) {
            context.getAuthenticationSession().removeAuthNote(AbstractUsernameFormAuthenticator.SESSION_INVALID);
        }
        if ("true".equals(context.getAuthenticationSession().getAuthNote(AbstractUsernameFormAuthenticator.SESSION_INVALID))) {
            context.getEvent().user(user).error(Errors.INVALID_AUTHENTICATION_SESSION);
            expireCookie(context);
            return;
        }
        if (!userEnabled) {
            context.getAuthenticationSession().setAuthNote(AbstractUsernameFormAuthenticator.SESSION_INVALID, "true");
            expireCookie(context);
            return;
        }
        if (otp == null) {
            context.challenge(challenge(context, null));
            return;
        }

        boolean valid = user.credentialManager().isValid(
                new UserCredentialModel(credentialId, getCredentialProvider(context.getSession()).getType(), otp));
        if (!valid) {
            context.getEvent().user(user).error(Errors.INVALID_USER_CREDENTIALS);
            Response response = challenge(context, Messages.INVALID_TOTP, Validation.FIELD_OTP_CODE);
            context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, response);
            return;
        }

        boolean requested = "on".equals(inputData.getFirst(FORM_FIELD));
        if (TrustedDeviceDecision.shouldIssue(requested, true) && manager != null) {
            String fingerprint = credentialFingerprint(user);
            List<String> records = user.getAttributeStream(USER_ATTRIBUTE)
                    .collect(Collectors.toCollection(ArrayList::new));
            TrustedDeviceManager.Issue issue = manager.issue(
                    context.getRealm().getId(), user.getId(), fingerprint, records);
            persistRecords(user, issue.records());
            setCookie(context, issue.cookie(), TrustedDeviceManager.LIFETIME_SECONDS);
        }
        context.success(OTPCredentialModel.TYPE);
    }

    static String credentialFingerprint(UserModel user) {
        String material = user.credentialManager().getStoredCredentialsStream()
                .filter(credential -> PasswordCredentialModel.TYPE.equals(credential.getType())
                        || OTPCredentialModel.TYPE.equals(credential.getType()))
                .sorted(Comparator.comparing(credential -> credential.getType() + ":" + credential.getId()))
                .map(credential -> String.join(":",
                        credential.getType(),
                        credential.getId() == null ? "" : credential.getId(),
                        credential.getCreatedDate() == null ? "" : credential.getCreatedDate().toString()))
                .collect(Collectors.joining("|"));
        return TrustedDeviceManager.digest(material);
    }

    private static void persistRecords(UserModel user, List<String> records) {
        if (records.isEmpty()) {
            user.removeAttribute(USER_ATTRIBUTE);
        } else {
            user.setAttribute(USER_ATTRIBUTE, records);
        }
    }

    private static void setCookie(AuthenticationFlowContext context, String value, int maxAge) {
        String path = "/realms/" + context.getRealm().getName() + "/";
        NewCookie cookie = new NewCookie.Builder(COOKIE_NAME)
                .version(1)
                .value(value)
                .path(path)
                .maxAge(maxAge)
                .secure(true)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.LAX)
                .build();
        context.getSession().getContext().getHttpResponse().setCookieIfAbsent(cookie);
    }

    private static void expireCookie(AuthenticationFlowContext context) {
        String path = "/realms/" + context.getRealm().getName() + "/";
        NewCookie cookie = new NewCookie.Builder(COOKIE_NAME)
                .version(1)
                .path(path)
                .maxAge(0)
                .secure(true)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.LAX)
                .build();
        context.getSession().getContext().getHttpResponse().setCookieIfAbsent(cookie);
    }
}
