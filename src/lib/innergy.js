const BASE_URL = 'https://app.innergy.com/api';

function getHeaders() {
  return {
    'Api-Key': process.env.EXPO_PUBLIC_INNERGY_API_KEY,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: getHeaders(), ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// API returns { Items: [...] } for list endpoints
function unwrapItems(data) {
  if (!data) return null;
  return Array.isArray(data) ? data : (data.Items ?? null);
}

export async function getProjects() {
  try {
    const data = await apiFetch('/projects');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getProjects:', e.message);
    return null;
  }
}

export async function getWorkOrders() {
  try {
    const data = await apiFetch('/projectWorkOrders');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getWorkOrders:', e.message);
    return null;
  }
}

export async function getShipmentItems(projectId) {
  try {
    const data = await apiFetch(`/project/${projectId}/shipmentItems`);
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getShipmentItems:', e.message);
    return null;
  }
}

export async function logTimeEntry(data) {
  try {
    return await apiFetch('/timeTracking', {
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
    const data = await apiFetch('/materialsToBuy');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getMaterialsToBuy:', e.message);
    return null;
  }
}

// Matches on WoNumber, ShipmentItemName, or Sku (case-insensitive)
export async function lookupPartByNumber(partNumber) {
  try {
    const data = await apiFetch('/shipmentItems');
    const items = unwrapItems(data);
    if (!items) return null;
    const upper = partNumber.toUpperCase();
    return (
      items.find(
        (item) =>
          (item.WoNumber ?? '').toUpperCase() === upper ||
          (item.ShipmentItemName ?? '').toUpperCase() === upper ||
          (item.Sku ?? '').toUpperCase() === upper
      ) ?? null
    );
  } catch (e) {
    console.error('[innergy] lookupPartByNumber:', e.message);
    return null;
  }
}

export async function testConnection() {
  try {
    await apiFetch('/version');
    return true;
  } catch (e) {
    console.error('[innergy] testConnection:', e.message);
    return false;
  }
}
