/**
 * Video kompozitsiyasining brauzerdagi qismi (HyperFrames render paytida Chrome ichida ishlaydi): shriftlar yuklangach matnlar
 * o'z qutisiga sig'diriladi, keyin bitta to'xtatilgan GSAP vaqt chizig'i quriladi va window.__timelines["main"] ga qo'yiladi.
 * Hamma vaqtlar — kompozitsiya soniyalari (server hisoblaydi: composition.ts). Tasodif, soat, tarmoq yo'q — har kadr faqat
 * vaqtdan kelib chiqadi (HyperFrames qoidasi).
 */
export const RUNTIME_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('hf-data').textContent);
  // Ixtiyoriy qismlar (bitta fikrda nuqtalar, bitta so'zda urg'u) bo'lmasa GSAP ogohlantirmasin
  gsap.config({ nullTargetWarn: false });
  var q = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /** Matnni qutiga sig'dirish: eng katta o'lchamdan boshlab, so'z ham, qatorlar soni ham sig'guncha kichraytiriladi */
  function fit(el) {
    var max = +el.dataset.max, min = +el.dataset.min, lines = +el.dataset.lines, lh = +(el.dataset.lh || 1.1);
    for (var s = max; s >= min; s -= 2) {
      el.style.fontSize = s + 'px';
      if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= Math.ceil(s * lh * lines) + 6) return;
    }
  }

  function build() {
    q('.fit').forEach(fit);
    var tl = gsap.timeline({ paused: true });
    var T = D.total;

    // ─── Sahna turlari ───────────────────────────────────────────────────
    function exit(root, sc, last) {
      if (!last) tl.to(root + ' .in', { opacity: 0, y: -70, duration: 0.26, ease: 'power2.in' }, sc.end - 0.26);
    }
    var SCENES = {
      hook: function (root, sc, last) {
        var words = q(root + ' .wi');
        tl.fromTo(words, { yPercent: 115, rotation: 5 }, { yPercent: 0, rotation: 0, duration: 0.7, ease: 'power4.out', stagger: 0.07 }, sc.start + 0.05);
        var hl = sc.start + 0.05 + words.length * 0.07 + 0.3;
        tl.fromTo(root + ' .hl-bar', { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: 'power3.inOut' }, hl);
        tl.fromTo(root + ' .hl .wi', { color: D.colors.onBg }, { color: D.colors.onAccent, duration: 0.2 }, hl + 0.15);
        tl.fromTo(root + ' .stage', { scale: 1.05 }, { scale: 1, duration: sc.end - sc.start, ease: 'none' }, sc.start);
        exit(root, sc, last);
      },
      point: function (root, sc, last) {
        var t = sc.start;
        tl.fromTo(root + ' .num', { opacity: 0, x: -90 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' }, t);
        tl.fromTo(root + ' .card', { clipPath: 'inset(0% 100% 0% 0% round 40px)' }, { clipPath: 'inset(0% 0% 0% 0% round 40px)', duration: 0.6, ease: 'power3.inOut' }, t + 0.05);
        tl.fromTo(root + ' .card .wi', { yPercent: 110 }, { yPercent: 0, duration: 0.55, ease: 'power3.out', stagger: 0.05 }, t + 0.3);
        tl.fromTo(root + ' .card-mark', { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)' }, t + 0.55);
        tl.fromTo(root + ' .dots .on', { scale: 0.3 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }, t + 0.5);
        tl.fromTo(root + ' .stage', { y: 30 }, { y: -30, duration: sc.end - sc.start, ease: 'none' }, t);
        exit(root, sc, last);
      },
      claim: function (root, sc, last) {
        var t = sc.start, words = q(root + ' .wi');
        tl.fromTo(root + ' .panel', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.55, ease: 'power4.inOut' }, t - 0.05);
        tl.fromTo(words, { yPercent: 110 }, { yPercent: 0, duration: 0.6, ease: 'power4.out', stagger: 0.08 }, t + 0.3);
        tl.fromTo(root + ' .rule', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power3.inOut' }, t + 0.35 + words.length * 0.08);
        tl.fromTo(root + ' .stage', { scale: 1 }, { scale: 1.06, duration: sc.end - sc.start, ease: 'none' }, t);
        tl.fromTo('#mark', { opacity: 1 }, { opacity: 0, duration: 0.25, immediateRender: false }, t);
        if (!last) {
          tl.to(root + ' .panel', { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.4, ease: 'power3.in' }, sc.end - 0.4);
          tl.to(root + ' .stage', { opacity: 0, duration: 0.25 }, sc.end - 0.35);
          tl.fromTo('#mark', { opacity: 0 }, { opacity: 1, duration: 0.25, immediateRender: false }, sc.end);
        }
      },
      sign: function (root, sc) {
        var t = sc.start;
        tl.fromTo('#mark', { opacity: 1 }, { opacity: 0, duration: 0.3, immediateRender: false }, t);
        tl.fromTo(root + ' .ring', { strokeDashoffset: 880 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, t);
        tl.fromTo(root + ' .mono-text', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(2)' }, t + 0.25);
        tl.fromTo(root + ' .ch', { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'power3.out', stagger: 0.03 }, t + 0.45);
        tl.fromTo(root + ' .tag', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, t + 0.95);
        tl.fromTo(root + ' .cta', { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, t + 1.3);
      },
    };


    // Fon: yorug'lik dog'lari va to'r butun video davomida sekin siljiydi, tepada jarayon chizig'i
    tl.fromTo('#g1', { x: -140, y: -90 }, { x: 160, y: 140, duration: T, ease: 'none' }, 0);
    tl.fromTo('#g2', { x: 120, y: 80 }, { x: -170, y: -120, duration: T, ease: 'none' }, 0);
    tl.fromTo('#grid', { x: 0, y: 0 }, { x: -120, y: -120, duration: T, ease: 'none' }, 0);
    tl.fromTo('#bar', { scaleX: 0 }, { scaleX: 1, duration: T, ease: 'none' }, 0);

    // Sahna rasmlari: oldingisi ustiga sekin chiqadi va butun sahna davomida sekin yaqinlashadi (Ken Burns)
    D.shots.forEach(function (s, i) {
      tl.fromTo('#' + s.id + ' .shot-in', { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power1.out' }, s.start);
      var dir = i % 2 ? 1 : -1;
      tl.fromTo('#' + s.id + ' img', { scale: 1.08, xPercent: -2 * dir }, { scale: 1.2, xPercent: 2 * dir, duration: s.end - s.start, ease: 'none' }, s.start);
    });

    // Sahnalar orasida urg'u rangidagi qiya chiziq pastdan tepaga o'tadi
    D.cuts.forEach(function (c, i) {
      tl.fromTo('#band' + i, { y: 0, rotation: -9 }, { y: -2900, rotation: -9, duration: 0.55, ease: 'power2.inOut' }, c - 0.3);
    });

    D.scenes.forEach(function (sc, i) { SCENES[sc.kind]('#sc' + i, sc, i === D.scenes.length - 1); });

    // Subtitr: guruh paydo bo'ladi, aytilayotgan so'z urg'u rangida biroz ko'tariladi (kattalashsa yonidagi bo'shliqni yopardi), guruh vaqti tugashi bilan yo'qoladi
    D.caps.forEach(function (c) {
      tl.fromTo('#' + c.id, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.14, ease: 'power2.out' }, c.start);
      c.words.forEach(function (w) {
        tl.fromTo('#' + w.id, { color: D.colors.capText, y: 0 }, { color: D.colors.capHi, y: -4, duration: 0.08, ease: 'power1.out' }, w.start);
        tl.to('#' + w.id, { color: D.colors.capText, y: 0, duration: 0.1, ease: 'power1.out' }, w.end);
      });
      tl.set('#' + c.id, { opacity: 0, visibility: 'hidden' }, c.end);
    });

    // Ro'yxatga faqat hamma tween qo'shilgach qo'yiladi (bo'sh vaqt chizig'i erta qo'yilsa video bo'sh chiqadi)
    window.__timelines['main'] = tl;

  }

  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('800 80px PDisplay'), document.fonts.load('700 40px PText')]).then(function () { return document.fonts.ready; }).then(build, build);
  } else {
    build();
  }
})();
`;
