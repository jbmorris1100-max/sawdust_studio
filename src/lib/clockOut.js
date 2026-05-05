import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { logTimeEntry } from './innergy';

// SQL needed in Supabase:
// CREATE TABLE IF NOT EXISTS time_clock (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   employee_name text, work_order_id text, job_name text,
//   clock_in timestamptz, clock_out timestamptz,
//   minutes_logged int, dept text, sync_status text DEFAULT 'pending',
//   created_at timestamptz DEFAULT now()
// );

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
  await supabase.from('time_clock').insert({
    employee_name:  currentTask.employeeName ?? 'Unknown',
    work_order_id:  currentTask.workOrderId ?? null,
    job_name:       currentTask.jobName ?? null,
    clock_in:       currentTask.startedAt ?? null,
    clock_out:      endTime,
    minutes_logged: Math.round(ms / 60000),
    dept:           currentTask.dept ?? null,
    sync_status:    synced ? 'synced' : 'pending',
  }).catch(() => {});

  await AsyncStorage.multiRemove(['@sawdust_current_task', '@sawdust_shift_start']);
}
