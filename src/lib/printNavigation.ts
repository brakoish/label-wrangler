import { alertDialog } from '@/components/ui/feedback';
let running = false;
let officeSeries = false;
export function setLocalPrintRunning(value: boolean) { running = value; }
/** True while this page is sending a "Send all in parts" series to the office printer. */
export function setOfficeSeriesRunning(value: boolean) { officeSeries = value; }
export function canLeaveLocalPrint(): boolean {
  if (running) {
    void alertDialog('Pause or cancel printing first', 'Pause or cancel this print run before leaving. Labels already sent to the printer may still print.');
    return false;
  }
  if (officeSeries) {
    void alertDialog('Still sending parts to the office printer', 'Stay on this page until every part has gone, or press Stop sending first. Parts already sent will still print.');
    return false;
  }
  return true;
}
