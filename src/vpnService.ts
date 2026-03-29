import axios from 'axios';
import { randomUUID } from 'crypto';
import https from 'https';

const agent = new https.Agent({  
  rejectUnauthorized: false
});

const PANEL_URL = (process.env.VPN_PANEL_URL || 'https://108.165.174.229:2053/nAsKCqW4R7JCj6J0yR/').replace(/\/+$/, '') + '/';
const USERNAME = process.env.VPN_PANEL_USERNAME || 'admin';
const PASSWORD = process.env.VPN_PANEL_PASSWORD || 'Solbon5796+-';
const INBOUND_IDS = (process.env.VPN_INBOUND_IDS || '1,2').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

let cookie = '';

async function login() {
  try {
    const params = new URLSearchParams();
    params.append('username', USERNAME);
    params.append('password', PASSWORD);

    const response = await axios.post(`${PANEL_URL}login`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: agent,
      timeout: 10000
    });
    
    if (response.data.success) {
      cookie = response.headers['set-cookie']?.[0] || '';
      return true;
    }
    return false;
  } catch (error: any) {
    console.error('[VPN] Login Error:', error.message);
    return false;
  }
}

export async function deleteClient(telegramId: number, username: string | null): Promise<boolean> {
  if (!cookie) {
    const loggedIn = await login();
    if (!loggedIn) return false;
  }

  const baseEmail = `${username || 'user'}_${telegramId}`;
  let success = true;

  for (const inboundId of INBOUND_IDS) {
    const email = inboundId === INBOUND_IDS[0] ? baseEmail : `${baseEmail}_${inboundId}`;
    try {
      const inboundResponse = await axios.get(`${PANEL_URL}panel/api/inbounds/get/${inboundId}`, {
        headers: { 'Cookie': cookie },
        httpsAgent: agent
      });

      const inbound = inboundResponse.data.obj;
      if (!inbound) continue;

      const settings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
      const client = settings.clients?.find((c: any) => c.email === email);
      
      if (!client) continue; // Already deleted

      const response = await axios.post(`${PANEL_URL}panel/api/inbounds/${inboundId}/delClient/${client.id}`, {}, {
        headers: { 'Cookie': cookie },
        httpsAgent: agent
      });

      if (!response.data.success) success = false;
    } catch (error: any) {
      console.error(`[VPN] Delete Client Error for inbound ${inboundId}:`, error.message);
      success = false;
    }
  }
  return success;
}

export async function updateClientExpiry(telegramId: number, username: string | null, expiryTimestamp: number, limitIp: number = 1): Promise<boolean> {
  if (!cookie) {
    const loggedIn = await login();
    if (!loggedIn) return false;
  }

  const baseEmail = `${username || 'user'}_${telegramId}`;
  let success = true;

  for (const inboundId of INBOUND_IDS) {
    const email = inboundId === INBOUND_IDS[0] ? baseEmail : `${baseEmail}_${inboundId}`;
    try {
      const inboundResponse = await axios.get(`${PANEL_URL}panel/api/inbounds/get/${inboundId}`, {
        headers: { 'Cookie': cookie },
        httpsAgent: agent
      });

      const inbound = inboundResponse.data.obj;
      if (!inbound) continue;

      const settings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
      const client = settings.clients?.find((c: any) => c.email === email);
      
      if (!client) continue;

      const response = await axios.post(`${PANEL_URL}panel/api/inbounds/updateClient/${client.id}`, {
        id: inboundId,
        settings: JSON.stringify({
          clients: [{
            ...client,
            expiryTime: expiryTimestamp,
            limitIp: limitIp > 0 ? limitIp + 2 : 0
          }]
        })
      }, {
        headers: { 'Cookie': cookie },
        httpsAgent: agent
      });

      if (!response.data.success) success = false;
    } catch (error: any) {
      console.error(`[VPN] Update Client Expiry Error for inbound ${inboundId}:`, error.message);
      success = false;
    }
  }
  return success;
}

export async function getClientTraffic(telegramId: number, username: string | null): Promise<{ up: number, down: number } | null> {
  if (!cookie) {
    const loggedIn = await login();
    if (!loggedIn) return null;
  }

  const baseEmail = `${username || 'user'}_${telegramId}`;
  let totalUp = 0;
  let totalDown = 0;
  let found = false;

  for (const inboundId of INBOUND_IDS) {
    const email = inboundId === INBOUND_IDS[0] ? baseEmail : `${baseEmail}_${inboundId}`;
    try {
      const response = await axios.get(`${PANEL_URL}panel/api/inbounds/getClientTraffics/${email}`, {
        headers: { 'Cookie': cookie },
        httpsAgent: agent
      });

      if (response.data.success && response.data.obj) {
        totalUp += response.data.obj.up || 0;
        totalDown += response.data.obj.down || 0;
        found = true;
      }
    } catch (error: any) {
      console.error(`[VPN] Get Client Traffic Error for ${email}:`, error.message);
    }
  }
  return found ? { up: totalUp, down: totalDown } : null;
}

async function addClientToInbound(inboundId: number, email: string, clientUuid: string, telegramId: number, expiryTimestamp: number, limitIp: number): Promise<string | null> {
  try {
    const inboundResponse = await axios.get(`${PANEL_URL}panel/api/inbounds/get/${inboundId}`, {
      headers: { 'Cookie': cookie },
      httpsAgent: agent
    });

    const inbound = inboundResponse.data.obj;
    if (!inbound) {
      console.error(`[VPN] Inbound ${inboundId} not found before adding client`);
      return null;
    }

    const streamSettings = typeof inbound.streamSettings === 'string' ? JSON.parse(inbound.streamSettings) : inbound.streamSettings;
    const security = streamSettings.security || 'none';
    const flow = security === 'reality' ? 'xtls-rprx-vision' : '';

    const addResponse = await axios.post(`${PANEL_URL}panel/api/inbounds/addClient`, {
      id: inboundId,
      settings: JSON.stringify({
        clients: [{
          id: clientUuid,
          flow: flow,
          email: email,
          limitIp: limitIp > 0 ? limitIp + 2 : 0,
          totalGB: 0,
          expiryTime: expiryTimestamp,
          enable: true,
          tgId: telegramId.toString(),
          subId: ""
        }]
      })
    }, {
      headers: { 'Cookie': cookie },
      httpsAgent: agent
    });

    let isDuplicate = false;
    if (!addResponse.data.success) {
      if (addResponse.data.msg && addResponse.data.msg.includes('Duplicate email')) {
        isDuplicate = true;
      } else {
        console.error(`[VPN] Add Client Failed for inbound ${inboundId}:`, addResponse.data.msg);
        return null;
      }
    }

    const updatedInboundResponse = await axios.get(`${PANEL_URL}panel/api/inbounds/get/${inboundId}`, {
      headers: { 'Cookie': cookie },
      httpsAgent: agent
    });

    const updatedInbound = updatedInboundResponse.data.obj;
    if (!updatedInbound) {
      console.error(`[VPN] Inbound ${inboundId} not found after adding client`);
      return null;
    }

    if (isDuplicate) {
      const settings = typeof updatedInbound.settings === 'string' ? JSON.parse(updatedInbound.settings) : updatedInbound.settings;
      const existingClient = settings.clients?.find((c: any) => c.email === email);
      if (existingClient) {
        clientUuid = existingClient.id; // Update UUID to existing one
        // We don't call updateClientExpiry here to avoid infinite loops, we assume it's handled elsewhere or we just use the existing client.
      } else {
        console.error(`[VPN] Duplicate email reported but client not found in inbound ${inboundId} settings`);
        return null;
      }
    }

    const network = streamSettings.network || 'tcp';
    const reality = streamSettings?.realitySettings || streamSettings?.settings?.realitySettings || {};
    const realityInner = reality.settings || {};

    const publicKey = reality.publicKey || realityInner.publicKey || process.env.VPN_PUBLIC_KEY;
    const shortId = reality.shortIds?.[0] || realityInner.shortIds?.[0] || '';
    const serverName = reality.serverNames?.[0] || realityInner.serverNames?.[0] || 'google.com';
    const spiderX = reality.spiderX || realityInner.spiderX || '/';

    if (!publicKey && security === 'reality') {
      console.error(`[VPN] ERROR: Public Key (pbk) not found for Reality on inbound ${inboundId}!`);
      return null;
    }

    const port = inbound.port;
    const host = new URL(PANEL_URL).hostname;

    let vlessLink = `vless://${clientUuid}@${host}:${port}?type=${network}&encryption=none&security=${security}`;
    if (flow) vlessLink += `&flow=${flow}`;
    
    if (network === 'grpc') {
      const grpcSettings = streamSettings?.grpcSettings || streamSettings?.settings?.grpcSettings || {};
      const serviceName = grpcSettings.serviceName || '';
      vlessLink += `&mode=multi&serviceName=${encodeURIComponent(serviceName)}`;
    } else if (network === 'ws') {
      const wsSettings = streamSettings?.wsSettings || streamSettings?.settings?.wsSettings || {};
      const path = wsSettings.path || '/';
      const wsHost = wsSettings.headers?.Host || '';
      vlessLink += `&path=${encodeURIComponent(path)}`;
      if (wsHost) vlessLink += `&host=${encodeURIComponent(wsHost)}`;
    } else if (network === 'tcp') {
      const tcpSettings = streamSettings?.tcpSettings || streamSettings?.settings?.tcpSettings || {};
      if (tcpSettings.header?.type === 'http') {
        vlessLink += `&headerType=http`;
        const hostHeader = tcpSettings.header.request?.headers?.Host?.[0] || '';
        if (hostHeader) vlessLink += `&host=${encodeURIComponent(hostHeader)}`;
      }
    }
    
    if (security === 'reality') {
      const decodedSpx = decodeURIComponent(spiderX);
      vlessLink += `&pbk=${publicKey}&fp=chrome&sni=${serverName}&sid=${shortId}&spx=${encodeURIComponent(decodedSpx)}`;
    } else if (security === 'tls') {
      const tlsSettings = streamSettings?.tlsSettings || streamSettings?.settings?.tlsSettings || {};
      const serverNameTls = tlsSettings.serverName || '';
      if (serverNameTls) vlessLink += `&sni=${serverNameTls}`;
      vlessLink += `&fp=chrome`;
    }
    
    // Use inbound remark for the configuration name
    const remarkName = inbound.remark ? encodeURIComponent(inbound.remark) : `ZenVPN_${email}`;
    vlessLink += `#${remarkName}`;
    
    return vlessLink;
  } catch (error: any) {
    console.error(`[VPN] Error adding client to inbound ${inboundId}:`, error.message);
    return null;
  }
}

export async function generateVlessConfig(telegramId: number, username: string | null, expiryTimestamp: number = 0, limitIp: number = 1): Promise<string | null> {
  try {
    if (!cookie) {
      const loggedIn = await login();
      if (!loggedIn) return null;
    }

    const baseEmail = `${username || 'user'}_${telegramId}`;
    let clientUuid = randomUUID();

    console.log(`[VPN] generateVlessConfig called for ${baseEmail}. INBOUND_IDS:`, INBOUND_IDS);

    // Try to find if client already exists in any inbound to reuse UUID
    for (const inboundId of INBOUND_IDS) {
      const email = inboundId === INBOUND_IDS[0] ? baseEmail : `${baseEmail}_${inboundId}`;
      try {
        const inboundResponse = await axios.get(`${PANEL_URL}panel/api/inbounds/get/${inboundId}`, {
          headers: { 'Cookie': cookie },
          httpsAgent: agent
        });
        const inbound = inboundResponse.data.obj;
        if (inbound) {
          const settings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
          const existingClient = settings.clients?.find((c: any) => c.email === email);
          if (existingClient) {
            clientUuid = existingClient.id;
            console.log(`[VPN] Found existing client in inbound ${inboundId} with UUID ${clientUuid}`);
            break;
          }
        }
      } catch (e) {}
    }

    const links: string[] = [];
    for (const inboundId of INBOUND_IDS) {
      const email = inboundId === INBOUND_IDS[0] ? baseEmail : `${baseEmail}_${inboundId}`;
      const link = await addClientToInbound(inboundId, email, clientUuid, telegramId, expiryTimestamp, limitIp);
      if (link) {
        links.push(link);
      } else {
        console.error(`[VPN] Failed to generate link for inbound ${inboundId}`);
      }
    }

    if (links.length === 0) {
      console.log('[VPN] All links failed, retrying login...');
      // If all failed, maybe cookie expired, retry once
      cookie = '';
      const retry = await login();
      if (!retry) return null;
      
      for (const inboundId of INBOUND_IDS) {
        const email = inboundId === INBOUND_IDS[0] ? baseEmail : `${baseEmail}_${inboundId}`;
        const link = await addClientToInbound(inboundId, email, clientUuid, telegramId, expiryTimestamp, limitIp);
        if (link) {
          links.push(link);
        }
      }
    }

    console.log(`[VPN] Generated ${links.length} links for ${baseEmail}`);

    if (links.length > 0) {
      // Update expiry for all just in case they were existing clients
      await updateClientExpiry(telegramId, username, expiryTimestamp, limitIp);
      return links.join('\n');
    }

    return null;
  } catch (error: any) {
    console.error('[VPN] Fatal Error in generateVlessConfig:', error.message);
    return null;
  }
}
