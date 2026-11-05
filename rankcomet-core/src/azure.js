// Azure OpenAI-client die alleen een EU Data Zone-deployment accepteert. Bij een andere configuratie
// weigert de app te starten. De transport-functie is injecteerbaar; in tests altijd gemockt.
export const EU_REGIOS = ['swedencentral', 'westeurope', 'northeurope', 'francecentral', 'germanywestcentral', 'italynorth', 'polandcentral', 'spaincentral'];
export const EU_DEPLOYMENT_TYPES = ['DataZoneStandard', 'DataZoneProvisionedManaged', 'DataZoneBatch'];

export function controleerAzureEnv(env = process.env) {
  const endpoint = env.RC_AZURE_OPENAI_ENDPOINT || '';
  const regio = (env.RC_AZURE_OPENAI_REGIO || '').toLowerCase();
  const type = env.RC_AZURE_OPENAI_DEPLOYMENT_TYPE || '';
  const deployment = env.RC_AZURE_OPENAI_DEPLOYMENT || '';
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('RC_AZURE_OPENAI_ENDPOINT ontbreekt of is ongeldig'); }
  if (url.protocol !== 'https:' || !/\.(openai\.azure\.com|cognitiveservices\.azure\.com)$/.test(url.hostname)) throw new Error('Azure OpenAI-endpoint moet https://<naam>.openai.azure.com zijn');
  if (!EU_REGIOS.includes(regio)) throw new Error('Azure OpenAI-regio ligt niet in de EU; start geweigerd');
  if (!EU_DEPLOYMENT_TYPES.includes(type)) throw new Error('Azure OpenAI-deployment is geen EU Data Zone-deployment; start geweigerd');
  if (!deployment) throw new Error('RC_AZURE_OPENAI_DEPLOYMENT ontbreekt');
  if (!env.RC_AZURE_OPENAI_KEY) throw new Error('RC_AZURE_OPENAI_KEY ontbreekt');
  return { endpoint: url.origin, regio, type, deployment, apiVersie: env.RC_AZURE_OPENAI_API_VERSIE || '2024-10-21' };
}

export function maakAzureClient(env = process.env, transport) {
  const cfg = controleerAzureEnv(env);
  if (typeof transport !== 'function') throw new Error('Geen transport opgegeven');
  return {
    cfg,
    async chat(berichten, opties = {}) {
      const url = `${cfg.endpoint}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${cfg.apiVersie}`;
      return transport(url, { method: 'POST', headers: { 'api-key': env.RC_AZURE_OPENAI_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ messages: berichten, ...opties }) });
    },
  };
}
