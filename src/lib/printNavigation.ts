let running = false;
export function setLocalPrintRunning(value: boolean) { running = value; }
export function canLeaveLocalPrint(): boolean {
  if (!running) return true;
  window.alert('Pause or cancel this print run before leaving. Labels already sent to the printer may still print.');
  return false;
}
