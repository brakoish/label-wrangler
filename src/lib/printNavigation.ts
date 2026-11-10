import { alertDialog, choiceDialog } from '@/components/ui/feedback';
let running = false;
let officeSeries = false;
let stopSeries: (() => void) | null = null;
let seriesEnded: Array<() => void> = [];
export function setLocalPrintRunning(value: boolean) { running = value; }
/**
 * True while this page is sending a "Send all in parts" series to the office
 * printer. `stop` asks the series to stop after the part that is going now.
 */
export function setOfficeSeriesRunning(value: boolean, stop?: () => void) {
  officeSeries = value;
  stopSeries = value ? stop ?? null : null;
  if (!value) { const waiting = seriesEnded; seriesEnded = []; for (const done of waiting) done(); }
}
/** True while a "Send all in parts" series is going on this page. */
export function officeSeriesActive(): boolean { return officeSeries; }
/**
 * Stops a "Send all in parts" series after the part that is going now (a
 * part is never cut off mid-send) and resolves once the series has ended.
 * Resolves at once when no series is going.
 */
export function stopOfficeSeries(): Promise<void> {
  if (!officeSeries) return Promise.resolve();
  return new Promise((resolve) => { seriesEnded.push(resolve); stopSeries?.(); });
}
/**
 * Whether a link may leave this page now. `leave` is called later when the
 * person chooses "Stop after this part and leave": the series stops after the
 * part that is going now (it is never cut off mid-send), then the page leaves.
 */
export function canLeaveLocalPrint(leave?: () => void): boolean {
  if (running) {
    void alertDialog('Pause or cancel printing first', 'Pause or cancel this print run before leaving. Labels already sent to the printer may still print.');
    return false;
  }
  if (officeSeries) {
    const stop = stopSeries;
    if (!stop || !leave) {
      void alertDialog('Still sending parts to the office printer', 'Stay on this page until every part has gone, or press “Stop after this part” first. Parts already queued still print.');
      return false;
    }
    void choiceDialog({
      title: 'Still sending parts to the office printer',
      body: 'Parts already queued still print. Stay until the last part is queued, or stop after the part that’s going now and leave.',
      confirmLabel: 'Stay on this page',
      altLabel: 'Stop after this part and leave',
    }).then((answer) => {
      if (answer !== 'alt' || !stop || !leave) return;
      seriesEnded.push(leave);
      stop();
    });
    return false;
  }
  return true;
}
