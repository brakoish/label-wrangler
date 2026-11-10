import { alertDialog } from '@/components/ui/feedback';
let running = false;
export function setLocalPrintRunning(value: boolean) { running = value; }
export function canLeaveLocalPrint(): boolean {
  if (!running) return true;
  void alertDialog('Pause or cancel printing first', 'Pause or cancel this print run before leaving. Labels already sent to the printer may still print.');
  return false;
}
