import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pill } from './ui';

describe('Pill', () => {
  it.each(['info', 'pos', 'neutral', 'warn', 'neg'] as const)('%s renders its tone class and its word', (tone) => {
    const { container } = render(<Pill tone={tone}>Word</Pill>);
    const el = container.querySelector('span')!;
    expect(el.className).toBe(`pill ${tone}`);
    expect(el.textContent).toBe('Word');
  });
});
