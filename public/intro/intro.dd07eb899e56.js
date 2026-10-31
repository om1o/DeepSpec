(() => {
  'use strict';

  const CYCLE_MS = 13000;
  const REVIEW_START = 4000;
  const REVIEW_COMPLETE = 7000;
  const DEFAULT_REVIEW = 'Likely a ventilated brake rotor. The friction surface and center hub are visible. Confirm the part number and vehicle fitment.';
  let teardown = () => {};

  function initializeIntro() {
    const demo = document.getElementById('intro-demo');
    const toggle = document.getElementById('motion-toggle');
    const replay = document.getElementById('replay-intro');
    const phone = demo?.querySelector('.phone');
    const view = demo?.querySelector('.phone-view');
    const photo = view?.querySelector('img');
    const line = demo?.querySelector('.scan-line');
    const target = demo?.querySelector('.scan-target');
    const result = demo?.querySelector('.scan-result');
    const prompt = demo?.querySelector('.phone-prompt');
    const review = demo?.querySelector('#demo-review-text') || result?.querySelector('p');
    const status = demo?.querySelector('.review-status') || result?.querySelector('.result-kicker');
    const heading = result?.querySelector('strong');
    const matchIcon = result?.querySelector('.match-icon');
    const reviewPanel = demo?.querySelector('.demo-review-panel');
    if (!demo || !toggle || !replay || !phone || !view || !photo || !line || !target || !result || !prompt || !review) return () => {};

    const fullReview = review.dataset.review?.trim() || DEFAULT_REVIEW;
    const reviewWords = fullReview.split(/\s+/);
    const resultTitle = heading?.textContent.trim() || 'Brake rotor';
    const controller = new AbortController();
    const { signal } = controller;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = preference.matches;
    let userPaused = false;
    let hidden = document.hidden;
    let available = typeof phone.animate === 'function';
    let disposed = false;
    let resizeFrame = 0;
    let renderFrame = 0;
    let observer;
    let resizeObserver;
    let animations = [];
    let layoutSignature = '';
    let playing = false;
    const initialRect = demo.getBoundingClientRect();
    let offscreen = initialRect.bottom <= 0 || initialRect.top >= window.innerHeight;

    demo.dataset.introEngine = 'waapi-v3';
    demo.dataset.introPolish = 'focus-v1';
    demo.dataset.introDuration = String(CYCLE_MS);
    const currentPhase = () => Number(animations[0]?.currentTime || 0) % CYCLE_MS;
    const at = (milliseconds) => milliseconds / CYCLE_MS;

    function setText(element, text) {
      if (element && element.textContent !== text) element.textContent = text;
    }

    function renderReview(phase) {
      const stage = phase < 3000 ? 'scanning' : phase < REVIEW_START ? 'reviewing' : 'review';
      demo.dataset.introPhase = stage;
      setText(status, stage === 'scanning' ? 'Scanning…' : stage === 'reviewing' ? 'Reviewing…' : 'Example AI review');
      setText(heading, stage === 'scanning' ? 'Scanning part' : stage === 'reviewing' ? 'Reviewing photo' : resultTitle);
      let text = '';
      if (phase >= REVIEW_START) {
        if (reduced || phase >= REVIEW_COMPLETE) text = fullReview;
        else {
          const count = Math.max(1, Math.ceil(((phase - REVIEW_START) / (REVIEW_COMPLETE - REVIEW_START)) * reviewWords.length));
          text = reviewWords.slice(0, count).join(' ');
        }
      }
      setText(review, text);
      demo.dataset.reviewComplete = String(phase >= (reduced ? REVIEW_START : REVIEW_COMPLETE));
    }

    function renderStatic() {
      setText(status, 'Example AI review');
      setText(heading, resultTitle);
      setText(review, fullReview);
      demo.dataset.introPhase = 'review';
      demo.dataset.reviewComplete = 'true';
    }

    function stopRendering() {
      window.cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    }

    function renderTick() {
      renderFrame = 0;
      if (disposed || !playing) return;
      renderReview(currentPhase());
      renderFrame = window.requestAnimationFrame(renderTick);
    }

    function startRendering() {
      if (!renderFrame) renderFrame = window.requestAnimationFrame(renderTick);
    }

    function cancelTimeline() {
      stopRendering();
      for (const animation of animations) animation.cancel();
      animations = [];
    }

    function makeAnimation(element, frames, phase) {
      const animation = element.animate(frames, {
        duration: CYCLE_MS,
        iterations: Infinity,
        fill: 'both',
        easing: 'linear',
      });
      animation.pause();
      animation.currentTime = phase;
      animations.push(animation);
    }

    function buildTimeline(phase = 0) {
      cancelTimeline();
      const pose = getComputedStyle(phone).transform;
      const base = pose === 'none' ? '' : pose + ' ';
      const scanTravel = view.clientHeight * 0.64;
      const computedFilter = getComputedStyle(photo).filter;
      const photoFilter = computedFilter === 'none' ? '' : computedFilter + ' ';
      const settle = 'cubic-bezier(.2,.75,.2,1)';
      const focusEase = 'cubic-bezier(.22,.68,.15,1)';
      try {
        // The first effect is also the shared clock for the scan and review.
        makeAnimation(result, reduced ? [
          { offset: 0, opacity: 1 },
          { offset: 1, opacity: 1 },
        ] : [
          { offset: 0, transform: 'translateY(7px)', opacity: 0.6 },
          { offset: at(3600), transform: 'translateY(7px)', opacity: 0.6, easing: settle },
          { offset: at(4200), transform: 'translateY(0)', opacity: 1 },
          { offset: at(12300), transform: 'translateY(0)', opacity: 1 },
          { offset: 1, transform: 'translateY(7px)', opacity: 0.6 },
        ], phase);
        if (!reduced) {
          // The device stays planted; a small settle reads like the camera
          // finding the part rather than the whole interface floating around.
          makeAnimation(phone, [
            { offset: 0, transform: base + 'translateY(5px) rotate(-.35deg)', easing: settle },
            { offset: at(650), transform: base + 'translateY(0) rotate(0deg)' },
            { offset: at(12400), transform: base + 'translateY(0) rotate(0deg)', easing: 'ease-in-out' },
            { offset: 1, transform: base + 'translateY(5px) rotate(-.35deg)' },
          ], phase);
          makeAnimation(photo, [
            { offset: 0, transform: 'scale(1.012) translateY(1px)', filter: photoFilter + 'blur(.65px)', easing: focusEase },
            { offset: at(500), transform: 'scale(1.025) translateY(0)', filter: photoFilter + 'blur(.1px)', easing: 'ease-in-out' },
            { offset: at(900), transform: 'scale(1.023) translateY(0)', filter: photoFilter + 'blur(0px)', easing: 'ease-in-out' },
            { offset: at(2900), transform: 'scale(1.055) translateY(0)', filter: photoFilter + 'blur(0px)' },
            { offset: at(12400), transform: 'scale(1.055) translateY(0)', filter: photoFilter + 'blur(0px)', easing: 'ease-in-out' },
            { offset: 1, transform: 'scale(1.012) translateY(1px)', filter: photoFilter + 'blur(.65px)' },
          ], phase);
          makeAnimation(target, [
            { offset: 0, transform: 'scale(1.075)', opacity: 0.6, easing: focusEase },
            { offset: at(500), transform: 'scale(1.012)', opacity: 0.92, easing: 'ease-in-out' },
            { offset: at(850), transform: 'scale(1.025)', opacity: 0.86, easing: focusEase },
            { offset: at(1250), transform: 'scale(1)', opacity: 1 },
            { offset: at(2750), transform: 'scale(1)', opacity: 1, easing: focusEase },
            { offset: at(3070), transform: 'scale(.986)', opacity: 1, easing: settle },
            { offset: at(3400), transform: 'scale(1)', opacity: 1 },
            { offset: at(12400), transform: 'scale(1)', opacity: 1, easing: 'ease-in-out' },
            { offset: 1, transform: 'scale(1.075)', opacity: 0.6 },
          ], phase);
        }
        // Keep the requested downward scan in both modes. Reduced motion holds
        // the phone/photo still and uses a softer beam without camera movement.
        const beamOpacity = reduced ? 0.8 : 1;
        makeAnimation(line, [
          { offset: 0, transform: 'translateY(0)', opacity: beamOpacity * 0.35 },
          { offset: at(160), transform: 'translateY(0)', opacity: beamOpacity },
          // Constant downward velocity keeps the beam readable on every size.
          { offset: at(2760), transform: `translateY(${scanTravel}px)`, opacity: beamOpacity },
          { offset: at(2980), transform: `translateY(${scanTravel}px)`, opacity: 0 },
          { offset: at(12840), transform: 'translateY(0)', opacity: 0 },
          { offset: 1, transform: 'translateY(0)', opacity: beamOpacity * 0.35 },
        ], phase);
        if (matchIcon) {
          makeAnimation(matchIcon, reduced ? [
            { offset: 0, opacity: 0.65 },
            { offset: at(3850), opacity: 0.65 },
            { offset: at(4100), opacity: 1 },
            { offset: at(12600), opacity: 1 },
            { offset: 1, opacity: 0.65 },
          ] : [
            { offset: 0, transform: 'scale(.96)', opacity: 0.65 },
            { offset: at(3850), transform: 'scale(.96)', opacity: 0.65, easing: settle },
            { offset: at(4100), transform: 'scale(1.07)', opacity: 1, easing: focusEase },
            { offset: at(4350), transform: 'scale(1)', opacity: 1 },
            { offset: at(12600), transform: 'scale(1)', opacity: 1 },
            { offset: 1, transform: 'scale(.96)', opacity: 0.65 },
          ], phase);
        }
        if (reviewPanel) {
          makeAnimation(reviewPanel, reduced ? [
            { offset: 0, opacity: 0 },
            { offset: at(3850), opacity: 0 },
            { offset: at(4180), opacity: 1 },
            { offset: at(12600), opacity: 1 },
            { offset: 1, opacity: 0 },
          ] : [
            { offset: 0, transform: 'translateY(12px) scale(.985)', opacity: 0 },
            { offset: at(3800), transform: 'translateY(12px) scale(.985)', opacity: 0, easing: settle },
            { offset: at(4350), transform: 'translateY(0) scale(1)', opacity: 1 },
            { offset: at(12600), transform: 'translateY(0) scale(1)', opacity: 1 },
            { offset: 1, transform: 'translateY(12px) scale(.985)', opacity: 0 },
          ], phase);
        }
        makeAnimation(review, [
          { offset: 0, opacity: 0.2 },
          { offset: at(REVIEW_START), opacity: 0.2 },
          { offset: at(REVIEW_START + 180), opacity: 1 },
          { offset: at(12800), opacity: 1 },
          { offset: 1, opacity: 0.2 },
        ], phase);
        makeAnimation(prompt, reduced ? [
          { offset: 0, opacity: 0.55 },
          { offset: at(7200), opacity: 0.55 },
          { offset: at(7380), opacity: 1 },
          { offset: at(12800), opacity: 1 },
          { offset: 1, opacity: 0.55 },
        ] : [
          { offset: 0, transform: 'translateY(6px)', opacity: 0.55 },
          { offset: at(7200), transform: 'translateY(6px)', opacity: 0.55, easing: settle },
          { offset: at(7800), transform: 'translateY(0)', opacity: 1 },
          { offset: at(12300), transform: 'translateY(0)', opacity: 1 },
          { offset: 1, transform: 'translateY(6px)', opacity: 0.55 },
        ], phase);
        renderReview(phase);
      } catch {
        available = false;
        cancelTimeline();
        renderStatic();
      }
    }

    function update() {
      if (disposed) return;
      demo.classList.toggle('intro-reduced', reduced || !available);
      demo.classList.remove('intro-manual');
      if (available && !animations.length) buildTimeline();
      playing = available && !userPaused && !offscreen && !hidden;
      demo.classList.toggle('intro-running', available);
      demo.classList.toggle('intro-paused', available && !playing);
      for (const animation of animations) {
        if (playing && animation.playState !== 'running') animation.play();
        else if (!playing && animation.playState !== 'paused') animation.pause();
      }
      if (playing) startRendering();
      else {
        stopRendering();
        if (available) renderReview(currentPhase());
        else renderStatic();
      }
      const label = !available ? 'Animation unavailable' : userPaused ? 'Play animation' : 'Pause animation';
      toggle.disabled = !available;
      toggle.hidden = false;
      toggle.textContent = label;
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-pressed', String(userPaused));
      toggle.title = reduced ? 'A gentle scan autoplays with the camera held still.' : '';
      replay.disabled = !available;
      replay.title = available ? 'Replay the example scan and review' : '';
      demo.dataset.introState = !available ? 'unavailable' : playing ? 'playing' : 'paused';
      demo.dataset.introMode = reduced ? 'reduced' : 'full';
    }

    toggle.addEventListener('click', () => {
      if (!available) return;
      userPaused = !userPaused;
      update();
    }, { signal });

    replay.setAttribute('aria-label', 'Replay intro');
    replay.addEventListener('click', () => {
      if (!available) return;
      userPaused = false;
      buildTimeline(0);
      update();
    }, { signal });

    const onPreferenceChange = (event) => {
      const phase = currentPhase();
      reduced = event.matches;
      if (available) buildTimeline(phase);
      update();
    };
    if (typeof preference.addEventListener === 'function') preference.addEventListener('change', onPreferenceChange, { signal });
    else preference.addListener(onPreferenceChange);

    function scheduleResize() {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        const next = `${view.clientWidth}:${view.clientHeight}:${window.innerWidth}`;
        if (next !== layoutSignature) {
          const phase = currentPhase();
          layoutSignature = next;
          if (available) buildTimeline(phase);
          update();
        }
      });
    }
    layoutSignature = `${view.clientWidth}:${view.clientHeight}:${window.innerWidth}`;
    window.addEventListener('resize', scheduleResize, { signal });
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(view);
    }
    document.addEventListener('visibilitychange', () => {
      hidden = document.hidden;
      update();
    }, { signal });
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        offscreen = !entries.some((entry) => entry.isIntersecting);
        update();
      }, { threshold: 0.01 });
      observer.observe(demo);
    }

    update();
    return () => {
      disposed = true;
      controller.abort();
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      cancelTimeline();
      demo.classList.remove('intro-running', 'intro-paused', 'intro-manual');
      demo.classList.add('intro-reduced');
      renderStatic();
      if (typeof preference.removeEventListener !== 'function') preference.removeListener(onPreferenceChange);
    };
  }

  function boot() {
    teardown();
    teardown = initializeIntro();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('pagehide', () => teardown());
  window.addEventListener('pageshow', (event) => { if (event.persisted) boot(); });
})();
