(function () {
  function $(id) { return document.getElementById(id); }
  function fmtMoney(n) {
    n = Number(n) || 0;
    var a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return "$" + Math.round(n).toLocaleString("en-US");
    return "$" + n.toFixed(0);
  }
  function fmtPx(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function fmtPct(n) { n = Number(n) || 0; return (n >= 0 ? "+" : "") + n.toFixed(0) + "%"; }
  function fmtPctAbs(n, d) { return (Number(n) || 0).toFixed(d == null ? 1 : d) + "%"; }
  function fmtQty(q) { q = Number(q) || 0; return q >= 100 ? q.toFixed(0) : q.toFixed(2); }

  function boot() {
    var P = window.AXE_EDGE_INVESTOR_PATH;
    var status = $("btStatus");
    if (!P || !P.o || !P.o.length) {
      if (status) status.textContent = "Data missing - hard refresh";
      return;
    }
    var o = P.o, h = P.h, l = P.l, c = P.c, d = P.d, eq = P.eq;
    var N = P.n || o.length;
    var WIN = 28;
    var trades = P.trades || [];
    var events = P.events || [];
    var startEq = P.start || 30000;

    // metrics (safe)
    try {
      if ($("mFinal")) $("mFinal").textContent = fmtMoney(P.end);
      if ($("mMult")) $("mMult").textContent = ((P.end || 0) / startEq).toFixed(0) + "x";
      if ($("mTape")) $("mTape").textContent = String(P.trades_on_tape || trades.length);
      if ($("mHostsEx")) $("mHostsEx").textContent = String(P.hosts_excluded || 0);
      if ($("mWR")) $("mWR").textContent = fmtPctAbs(P.decisive_wr_pct || 0, 2);
      if ($("mWL")) $("mWL").textContent = (P.wins || 0) + " / " + (P.losses || 0);
      if ($("mDdProfit")) $("mDdProfit").textContent = fmtPctAbs(P.max_dd_profit_pct || 0);
      if ($("mEng")) $("mEng").textContent = P.backtest_engine_version || "-";
      if ($("mHash")) $("mHash").textContent = P.params_hash16 || "-";
      if ($("mMeta")) $("mMeta").textContent = (P.meta_stem || "-").replace("backtest_", "");
    } catch (e1) {}

    var btcCanvas = $("btcCanvas");
    var eqCanvas = $("eqCanvas");
    if (!btcCanvas || !eqCanvas) {
      if (status) status.textContent = "Canvas missing";
      return;
    }
    var btcCtx = btcCanvas.getContext("2d");
    var eqCtx = eqCanvas.getContext("2d");

    var closesAt = new Array(N);
    for (var i = 0; i < N; i++) closesAt[i] = [];
    for (var t = 0; t < trades.length; t++) {
      var fo = Math.max(0, Math.min(N - 1, trades[t][1]));
      closesAt[fo].push(trades[t]);
    }
    var cumW = new Array(N), cumL = new Array(N), cumC = new Array(N);
    var w = 0, lss = 0, cc = 0;
    for (var f = 0; f < N; f++) {
      for (var b = 0; b < closesAt[f].length; b++) {
        var r = closesAt[f][b][8];
        if (r === 1) w++; else if (r === 2) lss++;
        cc++;
      }
      cumW[f] = w; cumL[f] = lss; cumC[f] = cc;
    }

    var playing = false, idx = 0, timer = null;
    var TICK_FAST = 38;
    var TICK_TRADE = 220;
    var TICK_TRADE_EDGE = 420;
    var TICK_EVENT = 480;
    var opensAt = new Array(N);
    for (var oi = 0; oi < N; oi++) opensAt[oi] = false;
    for (var ot = 0; ot < trades.length; ot++) {
      var ei = Math.max(0, Math.min(N - 1, trades[ot][0]));
      opensAt[ei] = true;
    }

    function eventNear(i) {
      for (var e = 0; e < events.length; e++) if (Math.abs(events[e].i - i) <= 2) return events[e];
      return null;
    }
    function eventDist(i) {
      var best = 9999;
      for (var e = 0; e < events.length; e++) {
        var dd = Math.abs(events[e].i - i);
        if (dd < best) best = dd;
      }
      return best;
    }
    function activeTrade(i) {
      for (var t = trades.length - 1; t >= 0; t--) {
        var tr = trades[t];
        if (tr[0] <= i && tr[1] >= i) return tr;
      }
      return null;
    }
    function lastClose(i) {
      for (var f = i; f >= 0; f--) if (closesAt[f].length) return closesAt[f][closesAt[f].length - 1];
      return null;
    }
    function paceMs(i) {
      var ed = eventDist(i);
      if (ed <= 1) return TICK_EVENT;
      if (ed <= 3) return Math.round(TICK_EVENT * 0.7);
      var act = activeTrade(i);
      if (opensAt[i] || (closesAt[i] && closesAt[i].length)) return TICK_TRADE_EDGE;
      if (act) {
        var fromOpen = i - act[0];
        var toClose = act[1] - i;
        if (fromOpen <= 2 || toClose <= 2) return TICK_TRADE_EDGE;
        return TICK_TRADE;
      }
      // ease in before a nearby open/close/event
      for (var look = 1; look <= 3; look++) {
        var j = i + look;
        if (j < N && (opensAt[j] || (closesAt[j] && closesAt[j].length) || eventDist(j) <= 1)) {
          return Math.round(TICK_FAST + (TICK_TRADE - TICK_FAST) * (1 - (look - 1) / 3));
        }
      }
      return TICK_FAST;
    }
    function paceLabel(i) {
      if (eventDist(i) <= 2) return "Event focus";
      if (opensAt[i] || (closesAt[i] && closesAt[i].length)) return "Trade focus";
      if (activeTrade(i)) return "Trade focus";
      return "Fast-forward";
    }

    var SMA_N = 9;
    var sma = new Array(N);
    (function () {
      var sum = 0;
      for (var i = 0; i < N; i++) {
        sum += c[i];
        if (i >= SMA_N) sum -= c[i - SMA_N];
        sma[i] = i >= SMA_N - 1 ? sum / SMA_N : c[i];
      }
    })();

    function drawBtc(endIdx) {
      var W = btcCanvas.width, H = btcCanvas.height;
      btcCtx.clearRect(0, 0, W, H);
      var start = Math.max(0, endIdx - WIN + 1);
      var n = endIdx - start + 1;
      var minP = Infinity, maxP = -Infinity;
      for (var i = start; i <= endIdx; i++) {
        if (l[i] < minP) minP = l[i];
        if (h[i] > maxP) maxP = h[i];
        if (sma[i] < minP) minP = sma[i];
        if (sma[i] > maxP) maxP = sma[i];
      }
      var act = activeTrade(endIdx);
      if (act) {
        minP = Math.min(minP, act[3] || minP, act[5] || minP, act[6] || minP);
        maxP = Math.max(maxP, act[3] || maxP, act[5] || maxP, act[6] || maxP);
      }
      var pad = (maxP - minP) * 0.08 || 1;
      minP -= pad; maxP += pad;
      var left = 8, right = 58, top = 22, bottom = 24;
      var plotW = W - left - right, plotH = H - top - bottom;
      function X(k) { return left + ((k + 0.5) / n) * plotW; }
      function Y(v) { return top + (1 - (v - minP) / (maxP - minP)) * plotH; }

      var ev = eventNear(endIdx);
      if (ev) {
        btcCtx.fillStyle = "rgba(255,213,79,0.12)";
        btcCtx.fillRect(left, top, plotW, plotH);
        btcCtx.fillStyle = "#ffd54f";
        btcCtx.font = "bold 12px monospace";
        btcCtx.fillText("EVENT  " + ev.label, left + 8, top + 14);
      }

      btcCtx.fillStyle = "#8a9aab";
      btcCtx.font = "10px monospace";
      btcCtx.fillText((d[start] || "").slice(2, 10), left, H - 6);
      btcCtx.fillText((d[endIdx] || "").slice(2, 10), W - right - 54, H - 6);

      var gap = plotW / n;
      var cw = Math.max(4, gap * 0.78);
      var wick = Math.max(1.5, cw * 0.18);
      for (var k = 0; k < n; k++) {
        var i = start + k;
        var up = c[i] >= o[i];
        var col = up ? "#26a69a" : "#ef5350";
        var x = X(k);
        btcCtx.strokeStyle = col;
        btcCtx.fillStyle = col;
        btcCtx.lineWidth = wick;
        btcCtx.beginPath();
        btcCtx.moveTo(x, Y(h[i]));
        btcCtx.lineTo(x, Y(l[i]));
        btcCtx.stroke();
        var y1 = Y(Math.max(o[i], c[i]));
        var y2 = Y(Math.min(o[i], c[i]));
        btcCtx.fillRect(x - cw / 2, y1, cw, Math.max(2.5, y2 - y1));
      }

      // SMA trend line through closes
      btcCtx.beginPath();
      btcCtx.lineWidth = 2.4;
      btcCtx.strokeStyle = "rgba(125,211,252,0.95)";
      var started = false;
      for (var k2 = 0; k2 < n; k2++) {
        var ii = start + k2;
        var yy = Y(sma[ii]);
        var xx = X(k2);
        if (!started) { btcCtx.moveTo(xx, yy); started = true; }
        else btcCtx.lineTo(xx, yy);
      }
      btcCtx.stroke();
      btcCtx.fillStyle = "rgba(125,211,252,0.95)";
      btcCtx.font = "10px monospace";
      btcCtx.fillText("SMA9", left + 6, top + 12);

      if (act) {
        function lvl(px, color, tag) {
          if (!px) return;
          var y = Y(px);
          btcCtx.setLineDash([5, 4]);
          btcCtx.beginPath();
          btcCtx.moveTo(left, y);
          btcCtx.lineTo(W - right, y);
          btcCtx.strokeStyle = color;
          btcCtx.lineWidth = 1.2;
          btcCtx.stroke();
          btcCtx.setLineDash([]);
          btcCtx.fillStyle = color;
          btcCtx.font = "10px monospace";
          btcCtx.fillText(tag, W - right + 4, y + 3);
        }
        lvl(act[3], "#5eead4", "ENT");
        lvl(act[5], "#66bb6a", "TP");
        lvl(act[6], "#ef5350", "SL");
      }
    }

    function drawEquity(endIdx) {
      var W = eqCanvas.width, H = eqCanvas.height;
      eqCtx.clearRect(0, 0, W, H);
      var step = Math.max(1, Math.floor((endIdx + 1) / 120));
      var pts = [], ids = [];
      for (var i = 0; i <= endIdx; i += step) { pts.push(eq[i]); ids.push(i); }
      if (ids[ids.length - 1] !== endIdx) { pts.push(eq[endIdx]); ids.push(endIdx); }
      if (pts.length < 2) return;
      var minL = Infinity, maxL = -Infinity;
      for (var j = 0; j < pts.length; j++) {
        var lv = Math.log10(Math.max(pts[j], 1));
        if (lv < minL) minL = lv;
        if (lv > maxL) maxL = lv;
      }
      if (maxL - minL < 0.05) { maxL += 0.05; minL -= 0.02; }
      function X(k) { return (ids[k] / Math.max(1, N - 1)) * (W - 16) + 8; }
      function Y(v) {
        var lv = Math.log10(Math.max(v, 1));
        return H - 12 - ((lv - minL) / (maxL - minL)) * (H - 20);
      }
      for (var k = 1; k < pts.length; k++) {
        eqCtx.beginPath();
        eqCtx.moveTo(X(k - 1), Y(pts[k - 1]));
        eqCtx.lineTo(X(k), Y(pts[k]));
        eqCtx.strokeStyle = pts[k] >= pts[k - 1] ? "#5eead4" : "#ef5350";
        eqCtx.lineWidth = 1.6;
        eqCtx.stroke();
      }
    }

    function render(i) {
      var e = eq[i] || startEq;
      var pct = ((e / startEq) - 1) * 100;
      var wins = cumW[i] || 0, losses = cumL[i] || 0;
      var wr = wins + losses ? (100 * wins / (wins + losses)) : 0;
      var lc = lastClose(i);
      var act = activeTrade(i);
      if ($("btEquity")) $("btEquity").textContent = fmtMoney(e);
      if ($("eqNow")) $("eqNow").textContent = fmtMoney(e);
      if ($("btPct")) $("btPct").textContent = fmtPct(pct);
      if ($("btQty")) $("btQty").textContent = lc ? fmtQty(lc[7]) : (act ? fmtQty(act[7]) : "-");
      if ($("btWR")) $("btWR").textContent = fmtPctAbs(wr, 1);
      if ($("btWins")) $("btWins").textContent = String(wins);
      if ($("btLosses")) $("btLosses").textContent = String(losses);
      if ($("btTrades")) $("btTrades").textContent = String(cumC[i] || 0);
      if ($("btPathDd")) $("btPathDd").textContent = "-";
      if ($("btDate")) $("btDate").textContent = (d[i] || "").slice(0, 10);
      if ($("btcNow")) $("btcNow").textContent = fmtPx(c[i]);
      if ($("btStatus")) $("btStatus").textContent = i >= N - 1 ? "Complete" : (playing ? paceLabel(i) : "Paused");
      var box = $("activeBox");
      if (box) {
        if (act) {
          box.innerHTML = "<b>" + (act[2] === 1 ? "LONG" : "SHORT") + "</b> qty <b>" + fmtQty(act[7]) +
            "</b> · ENT <b>" + fmtPx(act[3]) + "</b> · <span class=\"win\">TP " + fmtPx(act[5]) +
            "</span> · <span class=\"loss\">SL " + fmtPx(act[6]) + "</span>";
        } else if (lc) {
          var hit = lc[8] === 1 ? "HIT TP" : (lc[8] === 2 ? "HIT SL" : "EXIT");
          var cls = lc[8] === 1 ? "win" : "loss";
          box.innerHTML = "<span class=\"" + cls + "\"><b>" + hit + "</b></span> @ " + fmtPx(lc[4]);
        } else box.textContent = "Waiting for next fill...";
      }
      var banner = $("eventBanner");
      var ev = eventNear(i);
      if (banner) {
        if (ev) {
          banner.className = "event-banner on";
          if ($("eventTitle")) $("eventTitle").textContent = ev.label;
          if ($("eventSub")) $("eventSub").textContent = ev.d;
        } else banner.className = "event-banner";
      }
      drawBtc(i);
      drawEquity(i);
    }

    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    function schedule() {
      stop();
      if (!playing) return;
      timer = setTimeout(tick, paceMs(idx));
    }
    function tick() {
      if (!playing) return;
      if (idx >= N - 1) { playing = false; stop(); render(idx); return; }
      idx += 1;
      render(idx);
      if (playing) schedule();
    }
    function play() {
      if (playing) return;
      if (idx >= N - 1) idx = 0;
      playing = true;
      render(idx);
      schedule();
    }

    if ($("btPlay")) $("btPlay").onclick = play;
    if ($("btPause")) $("btPause").onclick = function () { playing = false; stop(); render(idx); };
    if ($("btReset")) $("btReset").onclick = function () { playing = false; stop(); idx = 0; render(0); };
    if ($("heroPlay")) $("heroPlay").onclick = function () {
      var path = $("path");
      if (path && path.scrollIntoView) path.scrollIntoView({ behavior: "smooth" });
      play();
    };

    render(0);
    setTimeout(play, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
