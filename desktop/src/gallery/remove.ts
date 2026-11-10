import type { ShellApi } from '../shell/context';
import { forgetGallery } from './memory';

export const MAX_DELETE = 100;

const folders = (n: number) => (n === 1 ? '1 folder' : `${n} folders`);

/** What the bulk confirm dialog says: up to three names, then "and N more", and how many photos go with them. */
export function deleteSpec(names: string[], photos: number, run: () => Promise<void>) {
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return {
    title: `Delete ${folders(names.length)}?`,
    body: `This removes ${names.slice(0, 3).join(', ')}${more} and ${photos === 1 ? '1 photo' : `${photos} photos`} from Gallery. This can’t be undone.`,
    confirm: { label: `Delete ${folders(names.length)}`, danger: true, run },
  };
}

/** The viewer's confirm dialog: one folder, named in the title. */
export function deleteOneSpec(name: string, photos: number, run: () => Promise<void>) {
  return {
    title: `Delete “${name}”?`,
    body: `This removes the folder and its ${photos === 1 ? '1 photo' : `${photos} photos`} from Gallery. This can’t be undone.`,
    confirm: { label: 'Delete folder', danger: true, run },
  };
}

/** FR-18: asks the server to delete Gowns for good. True when the server answered, so the caller can leave its view. */
export async function removeGowns(shell: ShellApi, ids: string[], single = false): Promise<boolean> {
  try {
    const r = await shell.request<{ deleted?: number }>('POST', '/api/v1/gowns/delete', { ids });
    if (r.status === 200) {
      forgetGallery();
      const n = r.body?.deleted ?? 0;
      shell.toast(n === 0 ? 'Those gowns were already deleted' : single ? 'Folder deleted' : `${folders(n)} deleted`);
      return true;
    }
    if (r.status === 422) shell.toast(`Delete up to ${MAX_DELETE} gowns at a time.`, 'error');
    else if (r.status === 403) shell.toast("You don't have permission to delete gowns.", 'error');
    else shell.toast("Couldn't delete the gowns. Try again.", 'error');
  } catch {
    shell.toast("Couldn't delete the gowns. Try again.", 'error'); /* the shell already raised the offline banner or the expiry */
  }
  return false;
}
