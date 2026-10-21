<#macro content>
  <div class="sq-account-brand sq-karir-brand" role="img" aria-label="<#if client?? && client.clientId == "spmb-keluarga">SPMB<#else>Keluarga</#if> SQ, Islamic Tahfizh School Sabilul Qur&apos;an">
    <picture>
      <source srcset="${url.resourcesPath}/img/logo-white.png" media="(prefers-color-scheme: dark)">
      <img class="sq-account-brand__logo" src="${url.resourcesPath}/img/logo.png" alt="" aria-hidden="true" width="2240" height="721">
    </picture>
    <span class="sq-karir-brand__app" aria-hidden="true"><#if client?? && client.clientId == "spmb-keluarga">${msg("keluargaAppNameSpmb")}<#else>${msg("karirAppName")}</#if></span>
  </div>
  <p class="sq-login-footer">${msg("karirFooter")}</p>
</#macro>
