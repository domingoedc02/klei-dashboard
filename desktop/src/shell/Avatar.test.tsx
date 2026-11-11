import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

const text = (name: string) => render(<Avatar name={name} />).container.textContent;

describe('Avatar initials', () => {
  it('takes the first letter of the first and last word', () => {
    expect(text('Eleanor Park')).toBe('EP');
    expect(text('  mary  jane  watson ')).toBe('MW');
  });

  it('is one letter for one word, blank for none, and keeps a whole code point', () => {
    expect(text('Eleanor')).toBe('E');
    expect(text('   ')).toBe('');
    expect(text('𐐨a Park')).toBe('𐐀P');
  });
});
