import { describe, expect, it } from 'vitest';
import { overallPct, stepLabel } from './Processing';

describe('overallPct', () => {
  it.each([
    [1, 0, 30, 0],
    [2, 15, 30, 37], // the story says 25; its own formula gives 37
    [4, 0, 1, 75],
    [2, 40, 30, 50],
    [1, 0, 0, 0],
  ])('step %i, %i of %i is %i%%', (step, done, total, pct) => expect(overallPct(step, done, total)).toBe(pct));
});

describe('stepLabel', () => {
  it('counts photos in step 1 and names the others', () => {
    expect(stepLabel(1, 1)).toBe('Reading 1 photo');
    expect(stepLabel(1, 30)).toBe('Reading 30 photos');
    expect([2, 3, 4].map((n) => stepLabel(n, 30))).toEqual(['Grouping images of the same gown', 'Tagging silhouette, fabric, neckline', 'Writing descriptions']);
  });
});
