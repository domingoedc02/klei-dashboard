// Resend button: disabled for data-wait seconds after a code was sent. Without script it stays enabled; the server
// refuses a resend inside the 30 seconds anyway.
document.querySelectorAll('[data-countdown]').forEach((b) => {
  let left = Number(b.dataset.wait) || 0
  if (left <= 0) return
  const label = b.textContent
  const tick = () => {
    b.disabled = left > 0
    b.textContent = left > 0 ? `${label} (${left})` : label
    if (left-- > 0) setTimeout(tick, 1000)
  }
  tick()
})
