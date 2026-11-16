import type { LabelFormat, LabelTemplate } from '../types';
import type { KioskCategory } from './plan';

/** A run in the kiosk's lists (GET /api/kiosk/runs). */
export interface KioskRunListItem {
  id: string; name: string; designName: string;
  /** A roll label design: it can print on the office printer. */
  thermal: boolean;
  totalLabels: number; status: string; createdAt: string;
  kiosk: { stage: 'test' | 'approved' | 'stopped'; testCount: number; productName: string } | null;
  /** What the office printer did (labels sent, on their way, needing a check; anySent: any send at all). */
  office: { sent: number; onTheWay: number; failedLabels: number; anySent: boolean };
}
/** GET /api/kiosk/designs. */
export interface KioskDesignsAnswer {
  ready: boolean; categoriesReady: boolean; ids: string[];
  categories: Record<string, KioskCategory[]>; canEdit: boolean;
  designs?: Array<{ template: LabelTemplate; format: LabelFormat }>;
}
