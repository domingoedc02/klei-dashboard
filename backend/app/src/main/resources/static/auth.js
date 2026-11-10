// Auth pages: inline validation, busy button and the six-box code. Advice only: the server re-checks everything, and
// without script every form posts as plain HTML (the single code input stays).
const RULES = {
  email: (v) => !v.trim() ? 'Enter your work email, for example you@kleibridal.com.'
    : /^\S+@\S+\.\S+$/.test(v) ? '' : 'That doesn’t look like an email. Add an @ and a domain, like kleibridal.com.',
  name: (v) => v.trim() ? '' : 'Enter your full name.',
  req: (v) => v ? '' : 'Enter your password.',
  newpw: (v) => v.length < 8 ? 'Password is too short. Use at least 8 characters.' : /\d/.test(v) ? '' : 'Add at least one number to your password.',
  match: (v, f) => v === f.elements.password.value ? '' : 'Passwords don’t match. Retype the same password in both fields.',
  code: (v) => /^\d{6}$/.test(v) ? '' : 'Enter the 6 digits from your email.',
  otp: (v) => /^\d{6}$/.test(v) ? '' : 'Enter the 6 digits from your authenticator app.',
  rcode: (v) => v.replace(/[\s-]/g, '').length === 10 ? '' : 'Enter a recovery code: 10 letters and numbers.',
}

const validate = (el) => {
  const msg = RULES[el.dataset.v](el.value, el.form)
  ;(el.cells || [el]).forEach((c) => c.setAttribute('aria-invalid', String(!!msg)))
  document.getElementById('e-' + el.id).textContent = msg
  return !msg
}

// Six boxes mirror the real input; it keeps the name, the form value and the one-time-code autofill hint.
const codeBoxes = (input) => {
  const label = input.form.querySelector(`label[for="${input.id}"]`)
  label.removeAttribute('for')
  label.id = 'code-label'
  const row = document.createElement('div')
  row.className = 'code'
  row.setAttribute('role', 'group')
  row.setAttribute('aria-labelledby', label.id)
  const cells = Array.from({ length: 6 }, (_, i) => {
    const c = document.createElement('input')
    c.type = 'text'
    c.autocomplete = i ? 'off' : 'one-time-code'
    c.setAttribute('inputmode', 'numeric')
    c.setAttribute('aria-label', `Digit ${i + 1} of 6`)
    c.setAttribute('aria-describedby', 'e-' + input.id)
    row.append(c)
    return c
  })
  const sync = () => {
    input.value = cells.map((c) => c.value).join('')
    if (input.getAttribute('aria-invalid') === 'true') validate(input)
  }
  const fill = (text, from) => {
    const d = text.replace(/\D/g, '').slice(0, 6)
    const start = d.length >= 6 ? 0 : from
    cells.forEach((c, i) => { if (i >= start && i < start + d.length) c.value = d[i - start] })
    sync()
    cells[Math.min(start + d.length, 5)].focus()
  }
  cells.forEach((c, i) => {
    c.addEventListener('input', () => {
      const v = c.value.replace(/\D/g, '')
      if (v.length > 1) return fill(v, i)
      c.value = v
      sync()
      if (v && i < 5) cells[i + 1].focus()
    })
    c.addEventListener('paste', (e) => { e.preventDefault(); fill(e.clipboardData.getData('text'), i) })
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !c.value && i) { cells[i - 1].value = ''; cells[i - 1].focus(); sync() }
      if (e.key === 'ArrowLeft' && i) cells[i - 1].focus()
      if (e.key === 'ArrowRight' && i < 5) cells[i + 1].focus()
    })
  })
  input.hidden = true
  input.cells = cells
  input.after(row)
  cells[0].focus()
}

document.querySelectorAll('form[data-validate]').forEach((f) => {
  f.noValidate = true
  const fields = [...f.querySelectorAll('[data-v]')]
  fields.filter((el) => ['code', 'otp'].includes(el.dataset.v)).forEach(codeBoxes)
  f.addEventListener('focusout', (e) => {
    if (!e.target.dataset?.v) return
    validate(e.target)
    if (e.target.name === 'password' && f.elements.confirm?.value) validate(f.elements.confirm)
  })
  f.addEventListener('input', (e) => { if (e.target.dataset.v && e.target.getAttribute('aria-invalid') === 'true') validate(e.target) })
  f.addEventListener('submit', (e) => {
    const bad = fields.filter((el) => !validate(el))
    if (bad.length) {
      e.preventDefault()
      ;(bad[0].cells?.[0] || bad[0]).focus()
      return
    }
    const b = f.querySelector('button[data-busy]')
    if (!b) return
    const label = b.textContent
    const spin = document.createElement('span')
    spin.className = 'spinner'
    b.replaceChildren(spin, b.dataset.busy)
    b.disabled = true
    b.setAttribute('aria-busy', 'true')
    // Back/forward cache restores this page as it was left; undo the busy state.
    addEventListener('pageshow', (ev) => { if (ev.persisted) { b.replaceChildren(label); b.disabled = false; b.removeAttribute('aria-busy') } }, { once: true })
  })
})
