import { describe, expect, it } from 'vitest';
import { deleteOneSpec, deleteSpec } from './remove';

const run = async () => undefined;

describe('delete copy', () => {
  it('bulk: singular and plural folder, names capped at three, photo count', () => {
    const one = deleteSpec(['Willow'], 1, run);
    expect(one.title).toBe('Delete 1 folder?');
    expect(one.body).toBe('This removes Willow and 1 photo from Gallery. This can’t be undone.');
    expect(one.confirm.label).toBe('Delete 1 folder');
    const five = deleteSpec(['A', 'B', 'C', 'D', 'E'], 12, run);
    expect(five.title).toBe('Delete 5 folders?');
    expect(five.body).toBe('This removes A, B, C and 2 more and 12 photos from Gallery. This can’t be undone.');
    expect(five.confirm.label).toBe('Delete 5 folders');
  });

  it('viewer: names the folder in the title and says Delete folder', () => {
    const s = deleteOneSpec('Willow', 3, run);
    expect(s.title).toBe('Delete “Willow”?');
    expect(s.body).toBe('This removes the folder and its 3 photos from Gallery. This can’t be undone.');
    expect(s.confirm.label).toBe('Delete folder');
    expect(deleteOneSpec('W', 1, run).body).toContain('its 1 photo from');
  });
});
