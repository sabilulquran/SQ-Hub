<#import "template.ftl" as layout>
<#import "buttons.ftl" as buttons>
<#import "karir-fields.ftl" as karir>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('nik'); section>
<!-- template: sq-karir login-reset-password.ftl -->
    <#if section = "header">
        ${msg("karirResetTitle")}
    <#elseif section = "form">
        <form id="kc-reset-password-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post" novalidate="novalidate">
            <@karir.nik />
            <@karir.turnstile />
            <@buttons.actionGroup>
              <@buttons.button id="kc-form-buttons" label="karirDoContinue"/>
              <@buttons.buttonLink href=url.loginUrl label="backToLogin"/>
            </@buttons.actionGroup>
        </form>
    <#elseif section = "info">
        <span class="${properties.kcLoginMainFooterHelperText!}">${msg("karirResetInstruction")}</span>
    </#if>
</@layout.registrationLayout>
