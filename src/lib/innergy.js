const BASE_URL = 'https://app.innergy.com/api/v1';

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.EXPO_PUBLIC_INNERGY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: getHeaders(), ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getProjects() {
  try {
    return await apiFetch('/api/projects');
  } catch (e) {
    console.error('[innergy] getProjects:', e.message);
    return null;
  }
}

export async function getWorkOrders() {
  try {
    return await apiFetch('/api/projectWorkOrders');
  } catch (e) {
    console.error('[innergy] getWorkOrders:', e.message);
    return null;
  }
}

export async function getShipmentItems(projectId) {
  try {
    return await apiFetch(`/api/project/${projectId}/shipmentItems`);
  } catch (e) {
    console.error('[innergy] getShipmentItems:', e.message);
    return null;
  }
}

export async function logTimeEntry(data) {
  try {
    return await apiFetch('/api/timeTracking', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error('[innergy] logTimeEntry:', e.message);
    return null;
  }
}

export async function getMaterialsToBuy() {
  try {
    return await apiFetch('/api/materialsToBuy');
  } catch (e) {
    console.error('[innergy] getMaterialsToBuy:', e.message);
    return null;
  }
}

export async function lookupPartByNumber(partNumber) {
  try {
    const items = await apiFetch('/api/shipmentItems');
    if (!items || !Array.isArray(items)) return null;
    return items.find((item) => item.partNumber === partNumber || item.part_number === partNumber) ?? null;
  } catch (e) {
    console.error('[innergy] lookupPartByNumber:', e.message);
    return null;
  }
}

export async function testConnection() {
  try {
    await apiFetch('/api/version');
    return true;
  } catch (e) {
    console.error('[innergy] testConnection:', e.message);
    return false;
  }
}
