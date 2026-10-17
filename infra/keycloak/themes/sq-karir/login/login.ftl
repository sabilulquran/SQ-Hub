<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<#import "karir-fields.ftl" as karir>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('nik') displayInfo=realm.registrationAllowed; section>
<!-- template: sq-karir login.ftl -->
    <#if section = "header">
        ${msg("karirLoginTitle")}
    <#elseif section = "form">
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <form id="kc-form-login" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post" novalidate="novalidate">
                <@karir.nik />
                <@field.password name="password" label=msg("password") error="" forgotPassword=realm.resetPasswordAllowed autocomplete="current-password" />
                <@karir.turnstile />
                <@buttons.loginButton />
            </form>
          </div>
        </div>
    <#elseif section = "info">
        <#if realm.registrationAllowed>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("karirNoAccount")} <a href="${url.registrationUrl}">${msg("karirDoRegister")}</a></span>
                </div>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
