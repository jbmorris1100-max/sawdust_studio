import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTenant } from './tenant';

const DEFAULT_BASE_URL = 'https://app.innergy.com/api';

const DEPT_LABOR_NAMES = {
  Production: 'Production Labor',
  Assembly:   'Assembly Labor',
  Finishing:  'Finishing Labor',
  Craftsman:  'Craftsman Labor',
};

export async function hasInnergy() {
  const tenant = await getTenant();
  return !!(tenant?.innergy_api_key);
}

async function getHeaders() {
  const tenant = await getTenant();
  const apiKey = tenant?.innergy_api_key ?? null;
  return {
    'Api-Key':      apiKey ?? '',
    'Content-Type': 'application/json',
  };
}

async function getBaseUrl() {
  const tenant = await getTenant();
  return tenant?.innergy_base_url ?? DEFAULT_BASE_URL;
}

async function apiFetch(path, options = {}) {
  const [headers, baseUrl] = await Promise.all([getHeaders(), getBaseUrl()]);
  const res = await fetch(`${baseUrl}${path}`, { headers, ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function unwrapItems(data) {
  if (!data) return null;
  return Array.isArray(data) ? data : (data.Items ?? null);
}

// ── Exported functions — all return null silently if no API key ──

export async function getProjects() {
  if (!await hasInnergy()) return null;
  try {
    const data = await apiFetch('/projects');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getProjects:', e.message);
    return null;
  }
}

export async function getWorkOrders() {
  if (!await hasInnergy()) return null;
  try {
    const data = await apiFetch('/projectWorkOrders');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getWorkOrders:', e.message);
    return null;
  }
}

export async function getShipmentItems(projectId) {
  if (!await hasInnergy()) return null;
  try {
    const path = projectId ? `/project/${projectId}/shipmentItems` : '/shipmentItems';
    const data  = await apiFetch(path);
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getShipmentItems:', e.message);
    return null;
  }
}

export async function getMaterialsToBuy() {
  if (!await hasInnergy()) return null;
  try {
    const data = await apiFetch('/materialsToBuy');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getMaterialsToBuy:', e.message);
    return null;
  }
}

export async function getLaborKanbanItems() {
  if (!await hasInnergy()) return null;
  try {
    const data = await apiFetch('/laborKanbanItems');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getLaborKanbanItems:', e.message);
    return null;
  }
}

export async function getDateManagement(year, month) {
  if (!await hasInnergy()) return null;
  try {
    const data = await apiFetch(`/dateManagement/${year}/${month}`);
    return unwrapItems(data) ?? data;
  } catch (e) {
    console.error('[innergy] getDateManagement:', e.message);
    return null;
  }
}

export async function lookupPartByNumber(partNumber) {
  if (!await hasInnergy()) return null;
  try {
    const data  = await apiFetch('/shipmentItems');
    const items = unwrapItems(data);
    if (!items) return null;
    const upper = partNumber.toUpperCase();
    return items.find(item =>
      (item.WoNumber         ?? '').toUpperCase() === upper ||
      (item.ShipmentItemName ?? '').toUpperCase() === upper ||
      (item.Sku              ?? '').toUpperCase() === upper ||
      (item.PartNumber       ?? '').toUpperCase() === upper ||
      (item.Barcode          ?? '').toUpperCase() === upper
    ) ?? null;
  } catch (e) {
    console.error('[innergy] lookupPartByNumber:', e.message);
    return null;
  }
}

export function extractWorkOrderContext(item) {
  if (!item) return null;
  return {
    workOrderId:   item.WorkOrderId ?? item.WoId ?? null,
    workOrderName: item.WorkOrderName ?? item.WoName ?? item.WoNumber ?? '',
    jobName:       item.ProjectName  ?? item.JobName  ?? item.Job ?? '',
    dept:          item.Dept         ?? item.DeptName ?? item.Department ?? '',
    itemId:        item.Id ?? null,
  };
}

export async function testConnection() {
  if (!await hasInnergy()) return false;
  try {
    await apiFetch('/version');
    return true;
  } catch (e) {
    console.error('[innergy] testConnection:', e.message);
    return false;
  }
}

// ── Employee / labor ID caching ───────────────────────────────

export async function getEmployees() {
  if (!await hasInnergy()) return null;
  try {
    const data = await apiFetch('/employees');
    return unwrapItems(data);
  } catch (e) {
    console.error('[innergy] getEmployees:', e.message);
    return null;
  }
}

export async function getEmployeeId(name) {
  if (!await hasInnergy()) return null;
  try {
    const cached = await AsyncStorage.getItem('@innergy_employee_id');
    if (cached) return parseInt(cached, 10);
    const employees = await getEmployees();
    if (!employees) return null;
    const match = employees.find(e =>
      `${e.FirstName ?? ''} ${e.LastName ?? ''}`.trim().toLowerCase() === name.toLowerCase()
    );
    if (match) {
      const id = match.Id ?? match.EmployeeId;
      await AsyncStorage.setItem('@innergy_employee_id', String(id));
      return id;
    }
    return null;
  } catch (e) {
    console.error('[innergy] getEmployeeId:', e.message);
    return null;
  }
}

export async function getLaborItemId(dept) {
  if (!await hasInnergy()) return null;
  try {
    const tenant = await getTenant();
    const laborMap = tenant?.labor_item_map ?? {};
    if (laborMap[dept]) return laborMap[dept];

    const key    = `@innergy_labor_id_${dept.toLowerCase()}`;
    const cached = await AsyncStorage.getItem(key);
    if (cached) return parseInt(cached, 10);
    const data  = await apiFetch('/labors');
    const items = unwrapItems(data);
    if (!items) return null;
    const target = DEPT_LABOR_NAMES[dept] ?? `${dept} Labor`;
    const match  = items.find(l =>
      (l.Name ?? l.LaborName ?? '').toLowerCase() === target.toLowerCase()
    );
    if (match) {
      const id = match.Id ?? match.LaborId;
      await AsyncStorage.setItem(key, String(id));
      return id;
    }
    return null;
  } catch (e) {
    console.error('[innergy] getLaborItemId:', e.message);
    return null;
  }
}

// ── Time tracking ─────────────────────────────────────────────

export async function logTimeEntry({ employeeId, workOrderId, laborItemId, startTime, endTime }) {
  if (!await hasInnergy()) return null;
  try {
    return await apiFetch('/timeTracking', {
      method: 'POST',
      body: JSON.stringify({
        EmployeeId:  employeeId,
        WorkOrderId: workOrderId,
        LaborItemId: laborItemId ?? null,
        StartTime:   startTime,
        EndTime:     endTime ?? null,
      }),
    });
  } catch (e) {
    console.error('[innergy] logTimeEntry:', e.message);
    return null;
  }
}

// ── Work order lookup ─────────────────────────────────────────

export async function getWorkOrdersByProjectNumber(projectNum) {
  if (!await hasInnergy()) return null;
  try {
    const data  = await apiFetch(`/projectWorkOrders?projectNumber=${encodeURIComponent(projectNum)}`);
    const items = unwrapItems(data);
    if (items?.length) return items;
  } catch (_) {}
  try {
    const all   = await apiFetch('/projectWorkOrders');
    const items = unwrapItems(all);
    if (!items) return null;
    const lower = projectNum.toLowerCase();
    return items.filter(wo =>
      (wo.ProjectNumber ?? wo.WoNumber ?? wo.JobNumber ?? '').toLowerCase().includes(lower) ||
      (wo.ProjectName   ?? wo.JobName  ?? '').toLowerCase().includes(lower)
    );
  } catch (e) {
    console.error('[innergy] getWorkOrdersByProjectNumber:', e.message);
    return null;
  }
}

// ── Part / work-order mutations ───────────────────────────────

export async function markPartScanned(workOrderId, shipmentItemId) {
  if (!await hasInnergy()) return null;
  try {
    return await apiFetch('/workOrderShipmentItemParts/externalFields', {
      method: 'POST',
      body: JSON.stringify({ workOrderId, shipmentItemId, scannedAt: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('[innergy] markPartScanned:', e.message);
    return null;
  }
}

export async function applyWorkOrderTag(workOrderId, tag) {
  if (!await hasInnergy()) return null;
  try {
    return await apiFetch(`/projectWorkOrders/${workOrderId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    });
  } catch (e) {
    console.error('[innergy] applyWorkOrderTag:', e.message);
    return null;
  }
}

export async function postWorkOrderNote(workOrderId, note) {
  if (!await hasInnergy()) return null;
  try {
    return await apiFetch(`/projectWorkOrders/${workOrderId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  } catch (e) {
    console.error('[innergy] postWorkOrderNote:', e.message);
    return null;
  }
}

export async function createImpediment({ type, workOrderId, description }) {
  if (!await hasInnergy()) return null;
  try {
    return await apiFetch('/impediments', {
      method: 'POST',
      body: JSON.stringify({ Type: type, WorkOrderId: workOrderId, Description: description }),
    });
  } catch (e) {
    console.error('[innergy] createImpediment:', e.message);
    return null;
  }
}
