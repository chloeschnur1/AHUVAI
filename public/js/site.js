/* Public website: navigation, gentle reveal animations, sign-up and contact forms. */
(function () {
  'use strict';
  const A = window.Ahuvai;

  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.getElementById('mobile-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
    });
  }
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('in'));

  for (const form of document.querySelectorAll('[data-api-form]')) {
    const wrap = form.closest('[data-form-wrap]');
    const errorBox = form.querySelector('[data-form-error]');
    const button = form.querySelector('[data-submit]');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errorBox.textContent = '';
      if (!A.checkRequired(form)) { errorBox.textContent = 'Please complete the highlighted fields.'; return; }
      const data = A.formData(form);
      if (data.num_children) data.num_children = Number(data.num_children);
      button.disabled = true;
      try {
        await A.post(form.dataset.apiForm, data);
        if (form.dataset.redirect) { location.href = form.dataset.redirect; return; }
        form.hidden = true;
        const thanks = wrap.querySelector('[data-form-thanks]');
        thanks.hidden = false;
        thanks.focus();
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        errorBox.textContent = err.message;
      } finally { button.disabled = false; }
    });
  }
})();
