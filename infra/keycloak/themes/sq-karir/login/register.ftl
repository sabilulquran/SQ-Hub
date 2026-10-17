<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<#import "karir-fields.ftl" as karir>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('nik','firstName','waNumber','password','password-confirm','consent'); section>
<!-- template: sq-karir register.ftl -->
    <#if section = "header">
        ${msg("karirRegisterTitle")}
    <#elseif section = "form">
        <#if karirNikRegistered?? && karirNikRegistered>
            <div class="${properties.kcAlertClass!} pf-m-info sq-karir-registered" role="status">
                <span class="${properties.kcAlertTitleClass!} kc-feedback-text">${msg("karirNikRegistered")}</span>
            </div>
            <@buttons.actionGroup>
                <a id="kc-registered-login" href="${url.loginUrl}" class="${properties.kcButtonPrimaryClass} ${properties.kcButtonBlockClass}">${msg("doLogIn")}</a>
            </@buttons.actionGroup>
        <#else>
        <form id="kc-register-form" class="${properties.kcFormClass!}" action="${url.registrationAction}" method="post" novalidate="novalidate">
            <@karir.nik value=(register.formData.nik!'') />
            <@field.input name="firstName" label=msg("karirFullName") value=(register.formData.firstName!'') autocomplete="name" />
            <@field.group name="waNumber" label=msg("karirWaNumber") error=messagesPerField.get('waNumber')>
                <span class="${properties.kcInputClass} <#if messagesPerField.existsError('waNumber')>${properties.kcError}</#if>">
                    <input id="waNumber" name="waNumber" value="${register.formData.waNumber!''}" type="tel" inputmode="tel"
                           autocomplete="tel" aria-describedby="waNumber-help"
                           aria-invalid="<#if messagesPerField.existsError('waNumber')>true</#if>"/>
                </span>
                <p id="waNumber-help" class="sq-karir-help">${msg("karirWaNumberHelp")}</p>
            </@field.group>
            <@field.password name="password" label=msg("password") autocomplete="new-password" />
            <@field.password name="password-confirm" label=msg("passwordConfirm") autocomplete="new-password" />
            <@field.group name="consent" label=msg("karirConsentLabel") error=messagesPerField.get('consent')>
                <label class="sq-karir-consent" for="consent">
                    <input id="consent" name="consent" type="checkbox" <#if (register.formData.consent!'') == 'on'>checked</#if>
                           aria-invalid="<#if messagesPerField.existsError('consent')>true</#if>"/>
                    <span>${msg("karirConsentText")}</span>
                </label>
            </@field.group>
            <@karir.turnstile />
            <@buttons.actionGroup>
                <@buttons.button id="kc-register" label="karirDoRegister"/>
            </@buttons.actionGroup>
        </form>
        </#if>
    <#elseif section = "info">
        <span>${msg("karirHaveAccount")} <a href="${url.loginUrl}">${msg("doLogIn")}</a></span>
    </#if>
</@layout.registrationLayout>
