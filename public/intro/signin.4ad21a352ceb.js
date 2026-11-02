(() => {
  'use strict';

  if (document.documentElement.dataset.signinTransition === 'ready') return;
  document.documentElement.dataset.signinTransition = 'ready';

  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let overlay;
  let card;
  let sheen;
  let fallback;
  let cancelButton;
  let status;
  let trigger;
  let active = false;
  let navigationTimer = 0;
  let animations = [];
  let lockedElements = [];
  let previousOverflow = '';
  let previousPadding = '';

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'signin-transition';
    overlay.hidden = true;
    overlay.dataset.state = 'idle';
    overlay.innerHTML = `
      <div class="signin-veil" aria-hidden="true"></div>
      <div class="signin-halo" aria-hidden="true"></div>
      <section class="signin-glass-card" role="dialog" aria-modal="true" aria-labelledby="signin-transition-title" aria-describedby="signin-transition-description" tabindex="-1">
        <div class="signin-glass-edge" aria-hidden="true"></div>
        <div class="signin-glass-sheen" aria-hidden="true"></div>
        <button class="signin-close" type="button" aria-label="Cancel opening DeepSpec"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
        <div class="signin-brand-surface"><img class="signin-blue-glass-logo" src="/intro/assets/blue-glass-mark.svg" width="128" height="128" alt="DeepSpec blue-glass logo"></div>
        <h2 id="signin-transition-title">Opening DeepSpec</h2>
        <p id="signin-transition-description">Opening your scanner.</p>
        <div class="signin-progress" aria-hidden="true"><span></span></div>
        <a class="signin-continue" href="/scan">Continue to scanner <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></a>
        <p class="signin-live-status" role="status" aria-live="polite"></p>
      </section>`;
    document.body.append(overlay);
    card = overlay.querySelector('.signin-glass-card');
    sheen = overlay.querySelector('.signin-glass-sheen');
    fallback = overlay.querySelector('.signin-continue');
    cancelButton = overlay.querySelector('.signin-close');
    status = overlay.querySelector('.signin-live-status');
    cancelButton.addEventListener('click', () => reset(true));
    overlay.querySelector('.signin-veil').addEventListener('click', () => reset(true));
  }

  function cancelAnimations() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function reset(restoreFocus = false) {
    window.clearTimeout(navigationTimer);
    navigationTimer = 0;
    cancelAnimations();
    if (overlay) {
      overlay.hidden = true;
      overlay.dataset.state = 'idle';
      overlay.style.removeProperty('opacity');
      status.textContent = '';
    }
    for (const [element, wasInert] of lockedElements) element.inert = wasInert;
    lockedElements = [];
    if (active) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
    }
    active = false;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
  }

  function lockPage() {
    previousOverflow = document.body.style.overflow;
    previousPadding = document.body.style.paddingRight;
    const gutter = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (gutter) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight || '0') + gutter}px`;
    document.body.style.overflow = 'hidden';
    for (const element of document.body.children) {
      if (element === overlay || !(element instanceof HTMLElement) || element.tagName === 'SCRIPT') continue;
      lockedElements.push([element, element.inert]);
      element.inert = true;
    }
  }

  function animate(element, frames, options) {
    if (typeof element.animate !== 'function') return;
    const animation = element.animate(frames, { fill: 'both', ...options });
    animations.push(animation);
  }

  function begin(anchor, event) {
    try {
      ensureOverlay();
    } catch {
      // Keep the anchor's native navigation if the optional transition cannot mount.
      return;
    }
    event.preventDefault();
    if (active) return;

    const destination = anchor.href;
    const reduced = preference.matches;
    const duration = reduced ? 160 : 980;
    trigger = anchor;
    lockPage();
    active = true;
    overlay.hidden = false;
    overlay.dataset.state = 'opening';
    overlay.dataset.motion = reduced ? 'reduced' : 'full';
    overlay.dataset.duration = String(duration);
    fallback.href = destination;
    status.textContent = 'Opening the DeepSpec scanner.';
    card.focus({ preventScroll: true });

    const rect = anchor.getBoundingClientRect();
    const fromX = Math.max(-100, Math.min(100, rect.left + rect.width / 2 - window.innerWidth / 2));
    const fromY = Math.max(-70, Math.min(70, rect.top + rect.height / 2 - window.innerHeight / 2));
    try {
      animate(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 140 : 240, easing: 'ease-out' });
      if (!reduced) {
        animate(card, [
          { offset: 0, opacity: 0, transform: `translate(${fromX}px, ${fromY}px) scale(.73)`, filter: 'blur(10px)', easing: 'cubic-bezier(.16,.84,.18,1)' },
          { offset: .58, opacity: 1, transform: 'translate(0,0) scale(1.018)', filter: 'blur(0px)', easing: 'cubic-bezier(.2,.75,.2,1)' },
          { offset: 1, opacity: 1, transform: 'translate(0,0) scale(1)', filter: 'blur(0px)' },
        ], { duration: 820 });
        animate(sheen, [
          { transform: 'translateX(-145%) rotate(-24deg)', opacity: 0 },
          { offset: .25, opacity: .65 },
          { offset: .75, opacity: .35 },
          { transform: 'translateX(180%) rotate(-24deg)', opacity: 0 },
        ], { duration: 920, easing: 'cubic-bezier(.15,.45,.35,1)' });
        animate(overlay.querySelector('.signin-halo'), [
          { opacity: 0, transform: 'translate(-50%,-50%) scale(.65)' },
          { opacity: .75, transform: 'translate(-50%,-50%) scale(1)' },
        ], { duration: 850, easing: 'cubic-bezier(.16,.8,.2,1)' });
        animate(overlay.querySelector('.signin-progress span'), [
          { transform: 'scaleX(0)' }, { transform: 'scaleX(1)' },
        ], { duration: 920, easing: 'cubic-bezier(.2,.65,.25,1)' });
      }
    } catch {
      cancelAnimations();
    }

    // A timer independent of animation promises keeps navigation reliable on all browsers.
    navigationTimer = window.setTimeout(() => {
      if (!active) return;
      overlay.dataset.state = 'navigating';
      status.textContent = 'Continuing to the scanner. If this page stays open, use Continue to scanner.';
      try {
        window.location.assign(destination);
      } catch {
        overlay.dataset.state = 'navigation-fallback';
        fallback.focus({ preventScroll: true });
      }
    }, duration);
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[data-entry]') : null;
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target.toLowerCase() !== '_self')) return;
    let url;
    try { url = new URL(anchor.href); } catch { return; }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    begin(anchor, event);
  });

  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      reset(true);
    } else if (event.key === 'Tab') {
      const first = cancelButton;
      const last = fallback;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card)) {
        event.preventDefault(); first.focus();
      }
    }
  });
  window.addEventListener('pagehide', () => reset());
  window.addEventListener('pageshow', (event) => { if (event.persisted) reset(); });
})();
