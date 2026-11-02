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
    $("mWinPct").textContent = B.taken ? (100 * B.wins / B.taken).toFixed(2) + "%" : "-";
    $("scrubStart").textContent = days[0];
    $("scrubEnd").textContent = days[N - 1];
    $("btScrub").max = String(N - 1);

    var bySym = names.map(function () { return []; });
    (B.trades || []).forEach(function (tr) { bySym[tr[0]].push(tr); });
    var kindWord = { t: "target", s: "stop", m: "time", g: "gap", l: "liquidated" };

    var strip = $("marketStrip");
    names.forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mkt" + (name === active ? " on" : "");
      b.dataset.name = name;
      b.innerHTML = '<span class="mkt-name"></span><span class="mkt-line px"><em>price:</em> <b>-</b></span><span class="mkt-line eq"><em>equity:</em> <b>-</b></span><canvas></canvas>';
      b.querySelector(".mkt-name").textContent = name;
      b.addEventListener("click", function () {
        active = name;
        paint();
      });
      strip.appendChild(b);
    });

    function rangeOf(series, a, b, trades) {
      var hi = -Infinity;
      var lo = Infinity;
      function eat(v) {
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      for (var i = a; i <= b; i++) {
        var bar = series[i];
        if (!bar) continue;
        eat(bar[1]);
        eat(bar[2]);
      }
      if (trades) {
        for (var t = 0; t < trades.length; t++) {
          var tr = trades[t];
          if (tr[1] > b || tr[2] < a) continue;
          eat(tr[4]);
          eat(tr[5]);
          eat(tr[6]);
        }
      }
      if (!isFinite(hi)) return null;
      var pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
      return { lo: lo - pad, hi: hi + pad };
    }

    function yOf(price, rg, h) {
      return h - ((price - rg.lo) / (rg.hi - rg.lo)) * (h - 18) - 8;
    }

    function focusOf(trades, i) {
      if (!trades) return null;
      var live = null;
      var just = null;
      for (var t = 0; t < trades.length; t++) {
        var tr = trades[t];
        if (tr[1] <= i && tr[2] >= i) live = tr;
        if (tr[2] === i) just = tr;
      }
      return live || just;
    }

    function drawCandles(canvas, series, i, win, trades, marks) {
      var box = fit(canvas);
      var ctx = box.ctx;
      var w = box.w;
      var h = box.h;
      ctx.clearRect(0, 0, w, h);
      var focus = marks ? focusOf(trades, i) : null;
      var a = Math.max(0, i - win + 1);
      var rg = rangeOf(series, a, i, null);
      if (!rg) {
        ctx.fillStyle = "rgba(138,154,171,0.7)";
        ctx.font = "12px JetBrains Mono, monospace";
        ctx.fillText("No bars yet", 12, h / 2);
        return null;
      }
      ctx.save();
      ctx.strokeStyle = "rgba(140,170,190,0.09)";
      ctx.lineWidth = 1;
      for (var g = 1; g <= 3; g++) {
        var gy = 8 + ((h - 26) * g) / 4;
        ctx.beginPath();
        ctx.moveTo(8, gy);
        ctx.lineTo(w - 8, gy);
        ctx.stroke();
      }
      ctx.restore();
      var n = i - a + 1;
      var cw = w / n;
      var bodyW = Math.max(3, Math.min(14, cw * 0.55));
      function xDay(k) { return (k - a + 0.5) * cw; }
      for (var k = a; k <= i; k++) {
        var bar = series[k];
        if (!bar) continue;
        var x = (k - a + 0.5) * cw;
        var yH = yOf(bar[1], rg, h);
        var yL = yOf(bar[2], rg, h);
        var yO = yOf(bar[0], rg, h);
        var yC = yOf(bar[3], rg, h);
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
      function exitPxOf(tr) {
        if (tr[7] === "t") return tr[5];
        if (tr[7] === "m") return series[tr[2]] ? series[tr[2]][3] : tr[4];
        return tr[6];
      }
      function exitCol(tr) {
        if (tr[7] === "t") return "#66bb6a";
        if (tr[7] === "m") return "#ffd54f";
        return "#ef5350";
      }
      function chip(text, x, y, color) {
        ctx.font = "10px JetBrains Mono, monospace";
        var tw = ctx.measureText(text).width;
        var bx = Math.max(6, Math.min(w - tw - 8, x));
        var by = Math.max(12, Math.min(h - 6, y));
        ctx.fillStyle = "rgba(8,14,20,0.88)";
        ctx.fillRect(bx - 4, by - 10, tw + 8, 14);
        ctx.fillStyle = color;
        ctx.fillText(text, bx, by);
      }
      if (marks && trades) {
        ctx.save();
        ctx.lineWidth = 1;
        for (var t = 0; t < trades.length; t++) {
          var tr = trades[t];
          if (tr[1] > i || tr[2] < a) continue;
          var openNow = tr[1] <= i && tr[2] >= i;
          if (tr[1] >= a && tr[1] <= i && tr[2] <= i && !openNow) {
            ctx.strokeStyle = "rgba(125,211,252,0.28)";
            ctx.beginPath();
            ctx.moveTo(xDay(tr[1]), yOf(tr[4], rg, h));
            ctx.lineTo(xDay(tr[2]), yOf(exitPxOf(tr), rg, h));
            ctx.stroke();
          }
          if (tr[1] >= a && tr[1] <= i) {
            var ex = xDay(tr[1]);
            var ey = yOf(tr[4], rg, h);
            ctx.fillStyle = "#7dd3fc";
            ctx.beginPath();
            ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#7dd3fc";
            ctx.beginPath();
            ctx.arc(ex, ey, 4.6, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (tr[2] <= i && tr[2] >= a) {
            ctx.fillStyle = exitCol(tr);
            ctx.fillRect(xDay(tr[2]) - 3, yOf(exitPxOf(tr), rg, h) - 3, 6, 6);
          }
        }
        if (focus && focus[1] <= i) {
          var yTp = yOf(focus[5], rg, h);
          var ySl = yOf(focus[6], rg, h);
          var yTop = Math.min(yTp, ySl);
          var yBot = Math.max(yTp, ySl);
          ctx.fillStyle = "rgba(125,211,252,0.05)";
          ctx.fillRect(0, yTop, w, yBot - yTop);
          ctx.setLineDash([7, 5]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(102,187,106,0.95)";
          ctx.beginPath();
          ctx.moveTo(0, yTp);
          ctx.lineTo(w, yTp);
          ctx.stroke();
          ctx.strokeStyle = "rgba(239,83,80,0.95)";
          ctx.beginPath();
          ctx.moveTo(0, ySl);
          ctx.lineTo(w, ySl);
          ctx.stroke();
          ctx.setLineDash([]);
          if (focus[1] >= a) {
            ctx.strokeStyle = "rgba(125,211,252,0.7)";
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(xDay(focus[1]), yTp);
            ctx.lineTo(xDay(focus[1]), ySl);
            ctx.stroke();
          }
          chip("TP " + fmtPx(focus[5]), w - 148, yTp - 8, "#66bb6a");
          chip("SL " + fmtPx(focus[6]), w - 148, ySl + 12, "#ef5350");
        }
        ctx.restore();
      } else if (trades) {
        for (var d = 0; d < trades.length; d++) {
          var dot = trades[d];
          if (dot[1] < a || dot[1] > i) continue;
          ctx.fillStyle = dot[2] <= i ? exitCol(dot) : "#7dd3fc";
          ctx.fillRect(xDay(dot[1]) - 1.5, 4, 3, 3);
        }
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
      var xLast = 4;
      for (var k = 0; k <= limit; k++) {
        var x = (k / (N - 1)) * (w - 8) + 4;
        var yy = y(eq[k]);
        xLast = x;
        if (!started) { ctx.moveTo(x, yy); started = true; }
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = "rgba(94,234,212,0.95)";
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(94,234,212,0.45)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (started) {
        ctx.lineTo(xLast, h);
        ctx.lineTo(4, h);
        ctx.closePath();
        ctx.fillStyle = "rgba(94,234,212,0.07)";
        ctx.fill();
      }
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
      var si = names.indexOf(active);
      var mine = bySym[si] || [];
      var last = drawCandles($("btcCanvas"), series, idx, 720, mine, true);
      var live = null;
      var closed = null;
      for (var q = 0; q < mine.length; q++) {
        var tr = mine[q];
        if (tr[1] <= idx && tr[2] >= idx) live = tr;
        if (tr[2] === idx) closed = tr;
      }
      var shown = live || closed;
      var hit = $("hitLine");
      if (hit) {
        if (!shown) hit.innerHTML = "Waiting for the next fill";
        else {
          var word = shown[2] > idx ? "live" : (kindWord[shown[7]] || "close");
          var tone = shown[2] > idx ? "" : (shown[7] === "t" ? "win" : (shown[7] === "m" ? "" : "loss"));
          hit.innerHTML = active + " · " + (shown[3] ? "long" : "short")
            + " · <b class=\"" + tone + "\">" + word + "</b>"
            + " · TP " + fmtPx(shown[5]) + " · SL " + fmtPx(shown[6]);
        }
      }
      $("chartLabel").textContent = active;
      $("btcNow").textContent = last ? fmtPx(last[3]) : "-";
      $("eqUnder").textContent = fmtFull(eq[idx]);
      drawEquity($("eqCanvas"), idx, false);
      drawEquity($("fullCanvas"), idx, false);
      var bookEq = fmtShort(eq[idx]);
      var buttons = strip.querySelectorAll(".mkt");
      for (var b = 0; b < buttons.length; b++) {
        var name = buttons[b].dataset.name;
        buttons[b].className = "mkt" + (name === active ? " on" : "");
        var bar = drawCandles(buttons[b].querySelector("canvas"), B.px[name], idx, idx + 1, bySym[b], false);
        buttons[b].querySelector(".px b").textContent = bar ? fmtPx(bar[3]) : "-";
        buttons[b].querySelector(".eq b").textContent = bookEq;
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

    var lastTs = 0;
    var acc = 0;
    var dayMs = 1000 / 72;

    function stop() {
      playing = false;
      if (timer) cancelAnimationFrame(timer);
      timer = null;
      lastTs = 0;
      acc = 0;
    }

    function frame(ts) {
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      var dt = ts - lastTs;
      if (dt > 48) dt = 48;
      lastTs = ts;
      acc += dt;
      var moved = false;
      while (acc >= dayMs && idx < N - 1) {
        acc -= dayMs;
        idx += 1;
        moved = true;
      }
      if (moved) paint();
      if (idx >= N - 1) {
        stop();
        paint();
        return;
      }
      timer = requestAnimationFrame(frame);
    }

    function play() {
      if (idx >= N - 1) idx = 0;
      playing = true;
      lastTs = 0;
      acc = 0;
      paint();
      timer = requestAnimationFrame(frame);
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
