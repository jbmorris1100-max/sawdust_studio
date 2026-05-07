import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { logTimeEntry } from './innergy';
import { getTenantId } from './tenant';

export async function clockOutEmployee(employeeId, currentTask) {
  if (!currentTask) return;
  const endTime = new Date().toISOString();
  let synced = false;

  try {
    if (employeeId && currentTask.workOrderId) {
      const result = await logTimeEntry({
        employeeId,
        workOrderId:  currentTask.workOrderId,
        laborItemId:  currentTask.laborItemId ?? null,
        startTime:    currentTask.startedAt,
        endTime,
      });
      synced = !!result;
    }
  } catch (_) {}

  const ms = new Date(endTime).getTime() - new Date(currentTask.startedAt ?? endTime).getTime();
  const tenantId = await getTenantId();
  const clockInTime = currentTask.startedAt ?? endTime;
  await supabase.from('time_clock').insert({
    employee_name:  currentTask.employeeName ?? 'Unknown',
    worker_name:    currentTask.employeeName ?? 'Unknown',
    work_order_id:  currentTask.workOrderId ?? null,
    job_name:       currentTask.jobName ?? null,
    clock_in:       clockInTime,
    clock_out:      endTime,
    date:           clockInTime.slice(0, 10),
    minutes_logged: Math.round(ms / 60000),
    dept:           currentTask.dept ?? null,
    sync_status:    synced ? 'synced' : 'pending',
    ...(tenantId && { tenant_id: tenantId }),
  }).catch(() => {});

  await AsyncStorage.multiRemove(['@inline_current_task', '@inline_shift_start']);
}
