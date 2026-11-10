import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, Icon } from './icons';

const REQUIRED = ['dashboard', 'upload', 'gallery', 'inquiries', 'settings', 'search', 'bell', 'spark', 'check', 'close', 'alert', 'info', 'chevron', 'upload-cloud', 'trash', 'download', 'edit', 'mail', 'plus'];

describe('icons', () => {
  it('has every icon the screens need', () => {
    for (const n of REQUIRED) expect(ICON_NAMES).toContain(n);
  });

  it.each(ICON_NAMES)('%s is a decorative currentColor svg with a drawing', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.querySelector('path, circle, rect')).toBeTruthy();
  });

  it('large adds the lg class', () => {
    expect(render(<Icon name="check" large />).container.querySelector('svg')!.getAttribute('class')).toBe('icon lg');
  });
});
