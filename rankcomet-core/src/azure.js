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

// De schrijfhulp voor de pijplijn (stap 4): één functie chat(berichten, { json }) die de tekst van het
// antwoord en het tokenverbruik teruggeeft. In tests is dit een nep-model; hier de echte Azure-aanroep.
// [A48] Alleen het antwoord zelf en de aantallen tokens komen terug; de prompt wordt niet gelogd.
export function maakModel(env = process.env, fetchFn = globalThis.fetch) {
  const client = maakAzureClient(env, async (url, init) => {
    const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(120000) });
    const tekst = await r.text();
    let data = null; try { data = JSON.parse(tekst); } catch {}
    if (!r.ok) { const e = new Error(`Azure OpenAI gaf ${r.status}`); e.status = r.status; e.azureCode = data?.error?.code; throw e; }
    return data;
  });
  return {
    async chat(berichten, { json = true, temperatuur = 0.4, maxTokens = 4000 } = {}) {
      const data = await client.chat(berichten, { temperature: temperatuur, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) });
      const keuze = data?.choices?.[0];
      if (!keuze?.message?.content) throw new Error('Azure OpenAI gaf geen inhoud');
      return { tekst: keuze.message.content, tokens: { in: data.usage?.prompt_tokens ?? null, uit: data.usage?.completion_tokens ?? null }, afgebroken: keuze.finish_reason === 'length' };
    },
  };
}
