import upload, { EXTRA as e1 } from './upload.mjs';
import gallery, { EXTRA as e2 } from './gallery.mjs';
import inquiries, { EXTRA as e3 } from './inquiries.mjs';
import settings, { EXTRA as e4 } from './settings.mjs';
import overlays, { EXTRA as e5 } from './overlays.mjs';

export default { ...upload, ...gallery, ...inquiries, ...settings, ...overlays };
export const EXTRA = [...e1, ...e2, ...e3, ...e4, ...e5];
