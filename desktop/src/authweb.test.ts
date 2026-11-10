import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// static/auth.js is a plain script on the Auth Web pages (CSP forbids inline script), so run its text against a page.
const script = readFileSync(resolve(__dirname, '../../backend/app/src/main/resources/static/auth.js'), 'utf8');
const run = () => new Function(script)();

const VERIFY = `<form data-validate>
  <label for="code">Verification code</label>
  <input id="code" name="code" data-v="code" aria-describedby="e-code"><span id="e-code"></span>
  <button type="submit" data-busy="Verifying…">Verify email</button></form>`;
const SIGN_IN = `<form data-validate>
  <label for="email">Work email</label><input id="email" name="email" data-v="email" aria-describedby="e-email"><span id="e-email"></span>
  <label for="password">Password</label><input id="password" name="password" data-v="req" aria-describedby="e-password"><span id="e-password"></span>
  <button type="submit" data-busy="Signing in…">Sign in</button></form>`;

const boxes = () => [...document.querySelectorAll<HTMLInputElement>('.code input')];
const paste = (el: HTMLElement, text: string) => {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => text } });
  el.dispatchEvent(e);
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('auth.js code boxes', () => {
  beforeEach(() => {
    document.body.innerHTML = VERIFY;
    run();
  });

  it('six labelled boxes; pasting 123456 into the first fills all and the hidden input', () => {
    expect(boxes().map((b) => b.getAttribute('aria-label'))).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Digit ${n} of 6`));
    paste(boxes()[0], '123456');
    expect(boxes().map((b) => b.value).join('')).toBe('123456');
    expect((document.getElementById('code') as HTMLInputElement).value).toBe('123456');
  });

  it('typing a digit moves on; a paste with spaces keeps only the digits', () => {
    boxes()[0].value = '4';
    boxes()[0].dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.activeElement).toBe(boxes()[1]);
    paste(boxes()[0], '12 34-56');
    expect((document.getElementById('code') as HTMLInputElement).value).toBe('123456');
  });

  it('submitting short shows the cause, marks every box invalid and blocks the post', () => {
    const f = document.querySelector('form')!;
    paste(boxes()[0], '12');
    const ok = f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(ok).toBe(false);
    expect(document.getElementById('e-code')!.textContent).toBe('Enter the 6 digits from your email.');
    expect(boxes().every((b) => b.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(document.activeElement).toBe(boxes()[0]);
  });
});

describe('auth.js inline validation and busy state', () => {
  beforeEach(() => {
    document.body.innerHTML = SIGN_IN;
    run();
  });

  it('an empty then a malformed email on focusout gives cause and remedy, tied by aria-invalid', () => {
    const email = document.getElementById('email') as HTMLInputElement;
    email.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(document.getElementById('e-email')!.textContent).toBe('Enter your work email, for example you@kleibridal.com.');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    email.value = 'eleanor';
    email.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(document.getElementById('e-email')!.textContent).toBe('That doesn’t look like an email. Add an @ and a domain, like kleibridal.com.');
    email.value = 'eleanor@kleibridal.com';
    email.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it('valid input posts, and the button turns busy with a spinner', () => {
    (document.getElementById('email') as HTMLInputElement).value = 'eleanor@kleibridal.com';
    (document.getElementById('password') as HTMLInputElement).value = 'x';
    const f = document.querySelector('form')!;
    expect(f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))).toBe(true);
    const b = f.querySelector('button')!;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe('Signing in…');
    expect(b.querySelector('.spinner')).toBeTruthy();
  });
});
