(function () {
  function $(id) { return document.getElementById(id); }

  function commas(s) {
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fmtFull(cents) {
    var n = Math.round(Number(cents) || 0);
    var sign = n < 0 ? "-" : "";
    var s = String(Math.abs(n));
    while (s.length < 3) s = "0" + s;
    return sign + "$" + commas(s.slice(0, -2)) + "." + s.slice(-2);
  }

  function fmtShort(cents) {
    var n = Number(cents) || 0;
    var a = Math.abs(n) / 100;
    if (a >= 1e12) return "$" + (n / 100 / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return "$" + (n / 100 / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 100 / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 100 / 1e3).toFixed(1) + "K";
    return fmtFull(n);
  }

  function fmtPx(n) {
    var v = Number(n) || 0;
    var d = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtMult(cents, start) {
    var m = (Number(cents) || 0) / start;
    if (m >= 100) return Math.round(m).toLocaleString("en-US") + "x";
    return m.toFixed(2) + "x";
  }

  function fit(canvas) {
    var r = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 300;
    var h = canvas.clientHeight || 160;
    var pw = Math.max(1, Math.floor(w * r));
    var ph = Math.max(1, Math.floor(h * r));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function boot() {
    var B = window.BOOK;
    if (!B || !B.days || !B.days.length) return;
    var days = B.days;
    var eq = B.eq;
    var names = B.names;
    var N = days.length;
    var start = B.startCents;
    var end = B.endCents;
    var active = names[0];
    var idx = 0;
    var playing = false;
    var timer = null;

    $("heroEnd").textContent = fmtFull(end);
    $("mFinal").textContent = fmtFull(end);
    $("mMult").textContent = fmtMult(end, start);
    $("mTaken").textContent = (B.taken || 0).toLocaleString("en-US");
    $("mWins").textContent = (B.wins || 0).toLocaleString("en-US");
    $("scrubStart").textContent = days[0];
    $("scrubEnd").textContent = days[N - 1];
    $("btScrub").max = String(N - 1);

    var strip = $("marketStrip");
    names.forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mkt" + (name === active ? " on" : "");
      b.dataset.name = name;
      b.innerHTML = '<span class="mkt-name"></span><canvas></canvas>';
      b.querySelector(".mkt-name").textContent = name;
      b.addEventListener("click", function () {
        active = name;
        paint();
      });
      strip.appendChild(b);
    });

    function rangeOf(series, a, b) {
      var hi = -Infinity;
      var lo = Infinity;
      for (var i = a; i <= b; i++) {
        var bar = series[i];
        if (!bar) continue;
        if (bar[1] > hi) hi = bar[1];
        if (bar[2] < lo) lo = bar[2];
      }
      if (!isFinite(hi)) return null;
      var pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.02 || 1;
      return { lo: lo - pad, hi: hi + pad };
    }

    function drawCandles(canvas, series, i, win) {
      var box = fit(canvas);
      var ctx = box.ctx;
      var w = box.w;
      var h = box.h;
      ctx.clearRect(0, 0, w, h);
      var a = Math.max(0, i - win + 1);
      var rg = rangeOf(series, a, i);
      if (!rg) return null;
      var n = i - a + 1;
      var cw = w / n;
      var bodyW = Math.max(1.5, cw * 0.62);
      for (var k = a; k <= i; k++) {
        var bar = series[k];
        if (!bar) continue;
        var x = (k - a + 0.5) * cw;
        var yH = h - ((bar[1] - rg.lo) / (rg.hi - rg.lo)) * (h - 8) - 4;
        var yL = h - ((bar[2] - rg.lo) / (rg.hi - rg.lo)) * (h - 8) - 4;
        var yO = h - ((bar[0] - rg.lo) / (rg.hi - rg.lo)) * (h - 8) - 4;
        var yC = h - ((bar[3] - rg.lo) / (rg.hi - rg.lo)) * (h - 8) - 4;
        var up = bar[3] >= bar[0];
        ctx.strokeStyle = up ? "#26a69a" : "#ef5350";
        ctx.fillStyle = up ? "#26a69a" : "#ef5350";
        ctx.beginPath();
        ctx.moveTo(x, yH);
        ctx.lineTo(x, yL);
        ctx.stroke();
        var top = Math.min(yO, yC);
        var bh = Math.max(1, Math.abs(yC - yO));
        ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
      }
      var last = null;
      for (var j = i; j >= 0; j--) if (series[j]) { last = series[j]; break; }
      return last;
    }

    function drawEquity(canvas, i, full) {
      var box = fit(canvas);
      var ctx = box.ctx;
      var w = box.w;
      var h = box.h;
      ctx.clearRect(0, 0, w, h);
      var lo = Math.log(start);
      var hi = Math.log(end);
      var span = hi - lo || 1;
      function y(v) {
        var a = Math.log(Math.max(1, v));
        return 8 + (1 - (a - lo) / span) * (h - 16);
      }
      ctx.beginPath();
      var started = false;
      var limit = full ? N - 1 : i;
      for (var k = 0; k <= limit; k++) {
        var x = (k / (N - 1)) * (w - 8) + 4;
        var yy = y(eq[k]);
        if (!started) { ctx.moveTo(x, yy); started = true; }
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = "rgba(94,234,212,0.95)";
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(94,234,212,0.45)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (!full && i < N - 1) {
        ctx.beginPath();
        var x0 = (i / (N - 1)) * (w - 8) + 4;
        ctx.moveTo(x0, 0);
        ctx.lineTo(x0, h);
        ctx.strokeStyle = "rgba(238,243,247,0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function paint() {
      var series = B.px[active];
      var last = drawCandles($("btcCanvas"), series, idx, 96);
      $("chartLabel").textContent = active;
      $("btcNow").textContent = last ? fmtPx(last[3]) : "-";
      drawEquity($("eqCanvas"), idx, false);
      drawEquity($("fullCanvas"), idx, false);
      var buttons = strip.querySelectorAll(".mkt");
      for (var b = 0; b < buttons.length; b++) {
        var name = buttons[b].dataset.name;
        buttons[b].className = "mkt" + (name === active ? " on" : "");
        drawCandles(buttons[b].querySelector("canvas"), B.px[name], idx, 48);
      }
      $("eqNow").textContent = fmtFull(eq[idx]);
      $("btEquity").textContent = fmtShort(eq[idx]);
      $("btMult").textContent = fmtMult(eq[idx], start);
      $("btDate").textContent = days[idx];
      var liveYear = $("btDateLive");
      if (liveYear) liveYear.textContent = days[idx].slice(0, 4);
      $("scrubNow").textContent = days[idx];
      $("btScrub").value = String(idx);
      var banner = $("eventBanner");
      if (days[idx].slice(5) === "01-01" && idx > 0) {
        banner.className = "event-banner on";
        $("eventTitle").textContent = days[idx].slice(0, 4);
        $("eventSub").textContent = "year open";
      } else {
        banner.className = "event-banner";
      }
      $("btStatus").textContent = idx >= N - 1 ? "End of path" : (playing ? "Running" : "Ready");
    }

    function stop() {
      playing = false;
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function step() {
      if (!playing) return;
      if (idx >= N - 1) {
        stop();
        paint();
        return;
      }
      idx += 1;
      paint();
      var delay = days[idx].slice(5) === "01-01" ? 700 : 26;
      timer = setTimeout(step, delay);
    }

    function play() {
      if (idx >= N - 1) idx = 0;
      playing = true;
      step();
    }

    $("btPlay").addEventListener("click", play);
    $("heroPlay").addEventListener("click", function () {
      var stage = $("path");
      if (stage && stage.scrollIntoView) stage.scrollIntoView({ behavior: "smooth", block: "start" });
      play();
    });
    $("btPause").addEventListener("click", function () {
      stop();
      paint();
    });
    $("btReset").addEventListener("click", function () {
      stop();
      idx = 0;
      paint();
    });
    $("btScrub").addEventListener("input", function () {
      stop();
      idx = Number($("btScrub").value) || 0;
      paint();
    });
    window.addEventListener("resize", paint);
    paint();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
