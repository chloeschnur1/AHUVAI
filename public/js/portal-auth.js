/* Family portal sign-in, invitation acceptance and password reset. */
(function () {
  'use strict';
  const A = window.Ahuvai;
  const params = new URLSearchParams(location.search);

  function wire(form, handler) {
    if (!form) return;
    const errorBox = form.querySelector('[data-form-error]');
    const button = form.querySelector('[data-submit]');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errorBox.textContent = '';
      errorBox.classList.add('error');
      if (!A.checkRequired(form)) { errorBox.textContent = 'Please complete the highlighted fields.'; return; }
      button.disabled = true;
      try { await handler(A.formData(form), errorBox); }
      catch (err) { errorBox.textContent = err.message; }
      finally { button.disabled = false; }
    });
  }

  wire(document.querySelector('[data-login-form]'), async (d) => {
    await A.post('/api/family/login', { email: d.email, password: d.password });
    location.href = '/portal/family';
  });

  wire(document.querySelector('[data-reset-request-form]'), async (d, box) => {
    const r = await A.post('/api/family/password-reset/request', { email: d.email });
    box.classList.remove('error');
    box.textContent = r.emailEnabled
      ? 'If an account exists for this address, a reset link is on its way.'
      : 'Password reset by email is not available yet. Please contact AHUVAI and we will help you directly.';
  });

  const inviteForm = document.querySelector('[data-invite-form]');
  if (inviteForm) {
    const intro = document.querySelector('[data-invite-intro]');
    const token = params.get('token') || '';
    A.get('/api/family/invitation?token=' + encodeURIComponent(token)).then((inv) => {
      if (inv.hasAccount) {
        intro.textContent = 'An account already exists for this email address. Please sign in.';
        document.querySelector('[data-invite-signin]').hidden = false;
        return;
      }
      intro.textContent = `Welcome, ${inv.guardian}. Please create your private account for ${inv.familyName}.`;
      inviteForm.elements.email.value = inv.email;
      inviteForm.elements.name.value = inv.guardian;
      inviteForm.hidden = false;
    }).catch((err) => {
      intro.textContent = err.message;
      document.querySelector('[data-invite-signin]').hidden = false;
    });
    wire(inviteForm, async (d) => {
      await A.post('/api/family/invitation/accept', { token, name: d.name, password: d.password, consent: d.consent });
      location.href = '/portal/family';
    });
  }

  const resetForm = document.querySelector('[data-reset-form]');
  wire(resetForm, async (d) => {
    await A.post('/api/family/password-reset/complete', { token: params.get('token') || '', password: d.password });
    resetForm.hidden = true;
    document.querySelector('[data-reset-done]').hidden = false;
  });
})();
