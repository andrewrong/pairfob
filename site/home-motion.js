// Homepage motion: the hero "one session on two screens" loop, the feature tour
// over real PWA screens, their pause controls, and the decorative pairing QR.
//
// Scenes only advance while they are actually playing, so pausing, scrolling
// away or hiding the tab freezes them in place instead of skipping ahead.
// Localized strings are read from the DOM (home-i18n.js fills them), so the loop
// follows a language switch without its own copy table.
(function () {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) root.classList.add("no-motion");

  const str = (id) => document.getElementById(id)?.textContent.trim() ?? "";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  drawPairingQr(document.getElementById("qr"));

  const stage = document.querySelector(".stage");
  const tour = document.getElementById("tour");
  if (!stage || !tour) return;

  const visible = new Map();
  const io =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
            sync();
          },
          { threshold: 0.15 },
        )
      : null;

  // ---------- feature tour (tabs) ----------
  const panel = document.getElementById("tour-panel");
  const items = [...tour.querySelectorAll(".tour-item")];
  const shots = [...tour.querySelectorAll(".shot img")];
  const tourToggle = document.getElementById("tour-toggle");
  let idx = 0;
  let tourElapsed = 0;
  let tourHeld = false;

  const restartBar = (i) => {
    const bar = items[i].querySelector(".bar");
    bar.replaceWith(bar.cloneNode(true));
  };

  function select(i, user) {
    idx = i;
    tourElapsed = 0;
    items.forEach((item, j) => {
      item.setAttribute("aria-selected", String(j === i));
      item.tabIndex = j === i ? 0 : -1;
    });
    shots.forEach((img) => {
      const on = img.dataset.name === items[i].dataset.shot;
      img.classList.toggle("on", on);
      if (on) img.removeAttribute("aria-hidden");
      else img.setAttribute("aria-hidden", "true");
    });
    panel.setAttribute("aria-labelledby", items[i].id);
    if (user) setTourPlaying(false);
    else restartBar(i);
  }

  function labelTourToggle() {
    const playing = tour.classList.contains("playing");
    tourToggle.querySelector("span").textContent = str(playing ? "s-tour-pause" : "s-tour-play");
  }

  function setTourPlaying(on) {
    tour.classList.toggle("playing", on);
    tourToggle.setAttribute("aria-pressed", String(!on));
    labelTourToggle();
    tourElapsed = 0;
    sync();
  }

  items.forEach((item, i) => item.addEventListener("click", () => select(i, true)));
  tour.querySelector(".tour-list").addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let next = null;
    if (event.key in step) next = (idx + step[event.key] + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
    items[next].focus();
  });
  tourToggle.addEventListener("click", () => {
    const resume = tourToggle.getAttribute("aria-pressed") === "true";
    if (resume) restartBar(idx);
    setTourPlaying(resume);
  });
  tour.addEventListener("pointerenter", () => {
    tourHeld = true;
    sync();
  });
  tour.addEventListener("pointerleave", () => {
    tourHeld = tour.contains(document.activeElement);
    sync();
  });
  tour.addEventListener("focusin", () => {
    tourHeld = true;
    sync();
  });
  tour.addEventListener("focusout", (event) => {
    if (tour.contains(event.relatedTarget)) return;
    tourHeld = tour.matches(":hover");
    sync();
  });

  const tourRunning = () =>
    tour.classList.contains("playing") && visible.get(tour) === true && !tourHeld && !document.hidden;

  // ---------- hero loop ----------
  const heroToggle = document.getElementById("hero-toggle");
  let heroPaused = false;
  const heroRunning = () => !heroPaused && visible.get(stage) !== false && !document.hidden;

  function labelHeroToggle() {
    const label = str(heroPaused ? "s-play" : "s-pause");
    heroToggle.setAttribute("aria-label", label);
    heroToggle.title = label;
  }

  function sync() {
    stage.classList.toggle("paused", !heroRunning());
    tour.classList.toggle("held", tour.classList.contains("playing") && !tourRunning());
  }

  document.addEventListener("visibilitychange", sync);
  heroToggle.addEventListener("click", () => {
    heroPaused = !heroPaused;
    heroToggle.setAttribute("aria-pressed", String(heroPaused));
    labelHeroToggle();
    sync();
  });
  window.addEventListener("pairfob-lang", () => {
    labelHeroToggle();
    labelTourToggle();
  });

  if (reduce || !io) {
    setTourPlaying(false);
    return;
  }
  io.observe(tour);
  io.observe(stage);
  setInterval(() => {
    if (!tourRunning()) return;
    tourElapsed += 100;
    if (tourElapsed >= 5000) select((idx + 1) % items.length, false);
  }, 100);

  root.classList.add("js");
  // wait() only counts time while the hero is running.
  const wait = async (ms) => {
    let left = ms;
    while (left > 0) {
      const step = Math.min(50, left);
      await sleep(step);
      if (heroRunning()) left -= step;
    }
  };
  const staged = [...stage.querySelectorAll("[data-s]")];
  const field = document.getElementById("field");
  const act = document.getElementById("act");
  const dot = document.getElementById("sd");
  const label = document.getElementById("sd-label");
  const ttyLine = document.getElementById("tty-line");
  const mdLine = document.getElementById("md-line");
  const beats = [...stage.querySelectorAll("#beats li")];

  // The mini terminal on phones mirrors the newest laptop line.
  function mdHtml(step) {
    const prompt = escapeHtml(str("s-prompt"));
    return [
      "",
      '<span class="dim">• 12 tests, 11 passed, </span><span class="bad">1 failed</span>',
      '<span class="acc">›</span> ' + prompt,
      '<span class="warn">Would you like to run the following command?</span>',
      '<span class="ok">✓ 12 tests, 12 passed (1.8s)</span>',
    ][step];
  }
  const flash = (el) => {
    el.classList.remove("hl");
    void el.offsetWidth;
    el.classList.add("hl");
  };
  const show = (step) => {
    staged.forEach((el) => el.classList.toggle("off", Number(el.dataset.s) > step));
    mdLine.innerHTML = mdHtml(step);
    if (step > 1) flash(mdLine);
  };
  const beat = (n) =>
    beats.forEach((li) => {
      const b = Number(li.dataset.b);
      li.classList.toggle("on", b === n);
      li.classList.toggle("past", b < n);
    });
  // kind: "done" | "work" | "wait" → the PWA's Turn finished / Working / Needs you.
  const status = (kind) => {
    const cls = kind === "work" ? "" : kind;
    dot.className = "sd " + cls;
    label.className = "st " + cls;
    label.textContent = str("s-" + kind);
  };
  const setAct = (kind) => {
    act.dataset.kind = kind;
  };
  const placeholder = () => {
    field.textContent = str("s-ph");
    field.classList.add("ph");
  };
  const press = async () => {
    act.classList.add("hit");
    await wait(200);
    act.classList.remove("hit");
  };

  sync();
  (async function loop() {
    for (;;) {
      show(1);
      beat(1);
      status("done");
      setAct("enter");
      placeholder();
      await wait(800);
      field.classList.remove("ph");
      field.textContent = "";
      setAct("send");
      for (const ch of str("s-prompt")) {
        field.textContent += ch;
        await wait(90);
      }
      await wait(500);
      beat(2);
      await press();
      placeholder();
      show(2);
      status("work");
      setAct("stop");
      flash(ttyLine);
      await wait(1700);
      beat(3);
      show(3);
      status("wait");
      setAct("enter");
      await wait(2000);
      beat(4);
      await press();
      show(4);
      status("done");
      setAct("enter");
      await wait(3400);
    }
  })();

  function escapeHtml(value) {
    return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
})();

// A decorative stand-in for the terminal QR code in step 2 (stable seed).
function drawPairingQr(canvas) {
  const g = canvas?.getContext?.("2d");
  if (!g) return;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const dark = "#0b0e13";
  const light = "#e9edf3";
  g.fillStyle = dark;
  g.fillRect(0, 0, 33, 33);
  g.fillStyle = light;
  for (let y = 2; y < 31; y++) for (let x = 2; x < 31; x++) if (rnd() > 0.5) g.fillRect(x, y, 1, 1);
  for (const [x, y] of [[2, 2], [24, 2], [2, 24]]) {
    g.fillStyle = light;
    g.fillRect(x, y, 7, 7);
    g.fillStyle = dark;
    g.fillRect(x + 1, y + 1, 5, 5);
    g.fillStyle = light;
    g.fillRect(x + 2, y + 2, 3, 3);
    g.fillStyle = dark;
    g.fillRect(x === 2 ? x + 7 : x - 1, y, 1, 8);
    g.fillRect(x, y === 2 ? y + 7 : y - 1, 8, 1);
  }
}
