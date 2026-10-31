(() => {
  'use strict';

  let teardown = () => {};

  function initialize() {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const controller = new AbortController();
    const effects = new Map();
    const targets = new Map();
    let observer;

    // Content is always visible in HTML/CSS. Animate only when it enters view;
    // unsupported APIs, missing JS and reduced motion keep the original layout.
    const collect = (selector, delay = 0, distance = 14) => {
      document.querySelectorAll(selector).forEach((element) => {
        targets.set(element, { delay, distance });
      });
    };
    collect('.feature-row > .visual-panel', 0, 16);
    collect('.feature-row > .feature-copy', 70, 14);
    collect('.questions-heading, .more-section > h2', 0, 12);
    collect('.anywhere-section > h2, .anywhere-section > p, .anywhere-section > .glass-button', 0, 12);
    collect('.image-callout, .evidence-note, .saved-label, .share-note', 100, 8);
    document.querySelectorAll('.conversation > p:not(.example-label)').forEach((element, index) => {
      targets.set(element, { delay: index * 90, distance: 10 });
    });
    document.querySelectorAll('.explore-card').forEach((element, index) => {
      targets.set(element, { delay: index * 65, distance: 14 });
    });

    const stop = (element) => {
      effects.get(element)?.cancel();
      effects.delete(element);
    };

    const reveal = (element) => {
      if (preference.matches || typeof element.animate !== 'function' || element.matches(':focus-within')) return;
      const { delay, distance } = targets.get(element);
      const effect = element.animate([
        { opacity: .5, transform: `translateY(${distance}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 580, delay, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'backwards' });
      effects.set(element, effect);
      effect.onfinish = () => stop(element);
      effect.oncancel = () => effects.delete(element);
    };

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          reveal(entry.target);
        }
      }, { threshold: .12, rootMargin: '0px 0px -3% 0px' });
      for (const element of targets.keys()) observer.observe(element);
    }

    // A focused control should never wait for an entrance effect.
    document.addEventListener('focusin', (event) => {
      for (const element of effects.keys()) {
        if (element.contains(event.target)) stop(element);
      }
    }, { signal: controller.signal });

    const stopAll = () => {
      for (const element of effects.keys()) stop(element);
    };
    preference.addEventListener?.('change', stopAll, { signal: controller.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAll();
    }, { signal: controller.signal });

    return () => {
      controller.abort();
      observer?.disconnect();
      stopAll();
    };
  }

  teardown = initialize();
  window.addEventListener('pagehide', () => teardown());
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) teardown = initialize();
  });
})();
