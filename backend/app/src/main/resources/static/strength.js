// Password strength meter: four bars and a word. Advice only; the server enforces the rule.
const WORDS = ['', 'Weak', 'Fair', 'Good', 'Strong']
const score = (p) => {
  if (!p) return 0
  const n = (p.length >= 8) + (p.length >= 12) + (/\d/.test(p) && /[a-z]/i.test(p)) + (/[a-z]/.test(p) && /[A-Z]/.test(p) || /[^a-z0-9]/i.test(p))
  return Math.max(1, n)
}
document.querySelectorAll('[data-strength]').forEach((m) => {
  const field = document.getElementById(m.dataset.strength)
  const word = m.querySelector('.word')
  const update = () => {
    const s = score(field.value)
    m.dataset.level = String(s)
    word.textContent = WORDS[s]
  }
  field.addEventListener('input', update)
  update()
})
