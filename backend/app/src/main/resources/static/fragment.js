// Show/hide password. Without script the button stays hidden and the field stays masked.
document.querySelectorAll('[data-toggle]').forEach((b) => {
  const field = document.getElementById(b.dataset.toggle)
  b.hidden = false
  b.addEventListener('click', () => {
    const show = field.type === 'password'
    field.type = show ? 'text' : 'password'
    b.textContent = show ? 'Hide' : 'Show'
    b.setAttribute('aria-pressed', String(show))
  })
})

// Invite and verify links carry their token after '#', which browsers never send. Move it into the form, drop it from
// the address bar and history entry, then post. A link without a token posts an empty one and gets the expired page.
document.querySelectorAll('form[data-fragment]').forEach((f) => {
  f.elements.token.value = decodeURIComponent(location.hash.slice(1))
  history.replaceState(null, '', location.pathname + location.search)
  f.submit()
})
