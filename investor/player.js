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
    var WIN_FAST = 96;
    var WIN_TRADE = 64;
    var WIN_EVENT = 72;
    var trades = P.trades || [];
    var events = P.events || [];
    var startEq = P.start || 30000;

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
    var fullCanvas = $("fullCanvas");
    if (!btcCanvas || !eqCanvas) {
      if (status) status.textContent = "Canvas missing";
      return;
    }
    var btcCtx = btcCanvas.getContext("2d");
    var eqCtx = eqCanvas.getContext("2d");
    var fullCtx = fullCanvas ? fullCanvas.getContext("2d") : null;
    var didScrollFull = false;

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
    var TICK_FAST = 42;
    var TICK_TRADE = 260;
    var TICK_TRADE_EDGE = 520;
    var TICK_EVENT = 520;
    var opensAt = new Array(N);
    for (var oi = 0; oi < N; oi++) opensAt[oi] = false;
    for (var ot = 0; ot < trades.length; ot++) {
      opensAt[Math.max(0, Math.min(N - 1, trades[ot][0]))] = true;
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
    function focusMode(i) {
      if (eventDist(i) <= 2) return "event";
      if (opensAt[i] || (closesAt[i] && closesAt[i].length) || activeTrade(i)) return "trade";
      for (var look = 1; look <= 2; look++) {
        var j = i + look;
        if (j < N && (opensAt[j] || (closesAt[j] && closesAt[j].length))) return "trade";
      }
      return "fast";
    }
    function windowFor(i) {
      var m = focusMode(i);
      if (m === "trade") return WIN_TRADE;
      if (m === "event") return WIN_EVENT;
      return WIN_FAST;
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
      for (var look = 1; look <= 3; look++) {
        var j = i + look;
        if (j < N && (opensAt[j] || (closesAt[j] && closesAt[j].length) || eventDist(j) <= 1)) {
          return Math.round(TICK_FAST + (TICK_TRADE - TICK_FAST) * (1 - (look - 1) / 3));
        }
      }
      return TICK_FAST;
    }
    function paceLabel(i) {
      var m = focusMode(i);
      if (m === "event") return "Event focus";
      if (m === "trade") return "Trade focus";
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
      var mode = focusMode(endIdx);
      var win = windowFor(endIdx);
      var act = activeTrade(endIdx);
      var justClosed = (closesAt[endIdx] && closesAt[endIdx].length) ? closesAt[endIdx][closesAt[endIdx].length - 1] : null;
      var focusTr = act || justClosed || null;

      // Wide sliding window so the full path stays readable
      var start = Math.max(0, endIdx - win + 1);
      var n = endIdx - start + 1;
      if (n < 1) return;

      var minP = Infinity, maxP = -Infinity;
      for (var i = start; i <= endIdx; i++) {
        if (l[i] < minP) minP = l[i];
        if (h[i] > maxP) maxP = h[i];
      }
      if (focusTr) {
        minP = Math.min(minP, focusTr[3], focusTr[5], focusTr[6]);
        maxP = Math.max(maxP, focusTr[3], focusTr[5], focusTr[6]);
      }
      for (var s = start; s <= endIdx; s++) {
        if (sma[s] < minP) minP = sma[s];
        if (sma[s] > maxP) maxP = sma[s];
      }
      var pad = (maxP - minP) * 0.12 || 1;
      minP -= pad; maxP += pad;

      var left = 10, right = 72, top = 28, bottom = 28;
      var plotW = W - left - right, plotH = H - top - bottom;
      function X(k) { return left + ((k + 0.5) / n) * plotW; }
      function Y(v) { return top + (1 - (v - minP) / (maxP - minP)) * plotH; }
      function idxK(absI) { return absI - start; }

      var ev = eventNear(endIdx);
      if (ev) {
        btcCtx.fillStyle = "rgba(255,213,79,0.1)";
        btcCtx.fillRect(left, top, plotW, plotH);
      }

      // Mode badge
      btcCtx.fillStyle = mode === "trade" ? "rgba(94,234,212,0.18)" : (mode === "event" ? "rgba(255,213,79,0.18)" : "rgba(138,154,171,0.12)");
      btcCtx.fillRect(left, top - 22, mode === "trade" ? 118 : 110, 18);
      btcCtx.fillStyle = mode === "trade" ? "#5eead4" : (mode === "event" ? "#ffd54f" : "#8a9aab");
      btcCtx.font = "bold 11px monospace";
      btcCtx.fillText(mode === "trade" ? "TRADE VIEW" : (mode === "event" ? "EVENT VIEW" : "OVERVIEW"), left + 6, top - 9);

      if (ev) {
        btcCtx.fillStyle = "#ffd54f";
        btcCtx.font = "bold 12px monospace";
        btcCtx.fillText(ev.label, left + 130, top - 9);
      }

      btcCtx.fillStyle = "#8a9aab";
      btcCtx.font = "11px monospace";
      btcCtx.fillText((d[start] || "").slice(2, 10), left, H - 8);
      btcCtx.fillText((d[endIdx] || "").slice(2, 10), W - right - 58, H - 8);

      // Risk band between TP and SL while trade is live
      if (focusTr) {
        var yTp = Y(focusTr[5]), ySl = Y(focusTr[6]);
        var yTop = Math.min(yTp, ySl), yBot = Math.max(yTp, ySl);
        btcCtx.fillStyle = "rgba(94,234,212,0.06)";
        btcCtx.fillRect(left, yTop, plotW, yBot - yTop);
      }

      var gap = plotW / n;
      var cw = Math.max(3.5, gap * 0.7);
      var wick = Math.max(1.2, Math.min(2.5, cw * 0.2));

      for (var k = 0; k < n; k++) {
        var ii = start + k;
        var up = c[ii] >= o[ii];
        var col = up ? "#26a69a" : "#ef5350";
        var x = X(k);
        var isEntry = focusTr && ii === focusTr[0];
        var isExit = focusTr && ii === focusTr[1] && endIdx >= focusTr[1];
        if (isEntry) {
          btcCtx.fillStyle = "rgba(94,234,212,0.18)";
          btcCtx.fillRect(x - gap * 0.48, top, gap * 0.96, plotH);
        }
        if (isExit) {
          var hitCol = focusTr[8] === 1 ? "rgba(102,187,106,0.2)" : "rgba(239,83,80,0.2)";
          btcCtx.fillStyle = hitCol;
          btcCtx.fillRect(x - gap * 0.48, top, gap * 0.96, plotH);
        }
        btcCtx.strokeStyle = col;
        btcCtx.fillStyle = col;
        btcCtx.lineWidth = wick;
        btcCtx.beginPath();
        btcCtx.moveTo(x, Y(h[ii]));
        btcCtx.lineTo(x, Y(l[ii]));
        btcCtx.stroke();
        var y1 = Y(Math.max(o[ii], c[ii]));
        var y2 = Y(Math.min(o[ii], c[ii]));
        btcCtx.fillRect(x - cw / 2, y1, cw, Math.max(3, y2 - y1));
      }

      // SMA (thinner in trade zoom)
      btcCtx.beginPath();
      btcCtx.lineWidth = mode === "trade" ? 1.6 : 2.2;
      btcCtx.strokeStyle = "rgba(125,211,252,0.85)";
      var started = false;
      for (var k2 = 0; k2 < n; k2++) {
        var xx = X(k2), yy = Y(sma[start + k2]);
        if (!started) { btcCtx.moveTo(xx, yy); started = true; }
        else btcCtx.lineTo(xx, yy);
      }
      btcCtx.stroke();

      if (focusTr) {
        function lvl(px, color, tag, solid) {
          if (!px) return;
          var y = Y(px);
          btcCtx.setLineDash(solid ? [] : [6, 4]);
          btcCtx.beginPath();
          btcCtx.moveTo(left, y);
          btcCtx.lineTo(W - right, y);
          btcCtx.strokeStyle = color;
          btcCtx.lineWidth = solid ? 2.2 : 1.6;
          btcCtx.stroke();
          btcCtx.setLineDash([]);
          btcCtx.fillStyle = "rgba(10,14,18,0.75)";
          btcCtx.fillRect(W - right + 2, y - 9, 66, 16);
          btcCtx.fillStyle = color;
          btcCtx.font = "bold 11px monospace";
          btcCtx.fillText(tag, W - right + 6, y + 3);
        }
        lvl(focusTr[3], "#5eead4", "ENT", true);
        lvl(focusTr[5], "#66bb6a", "TP", false);
        lvl(focusTr[6], "#ef5350", "SL", false);

        // Entry marker triangle on fill candle
        if (focusTr[0] >= start && focusTr[0] <= endIdx) {
          var ex = X(idxK(focusTr[0]));
          var ey = Y(focusTr[3]);
          btcCtx.fillStyle = "#5eead4";
          btcCtx.beginPath();
          if (focusTr[2] === 1) {
            btcCtx.moveTo(ex, ey - 14);
            btcCtx.lineTo(ex - 9, ey + 2);
            btcCtx.lineTo(ex + 9, ey + 2);
          } else {
            btcCtx.moveTo(ex, ey + 14);
            btcCtx.lineTo(ex - 9, ey - 2);
            btcCtx.lineTo(ex + 9, ey - 2);
          }
          btcCtx.closePath();
          btcCtx.fill();
          btcCtx.font = "bold 12px monospace";
          btcCtx.fillText(focusTr[2] === 1 ? "BUY LIMIT" : "SELL LIMIT", ex + 12, ey - 8);
          btcCtx.font = "11px monospace";
          btcCtx.fillStyle = "#eef3f7";
          btcCtx.fillText(fmtPx(focusTr[3]) + "  qty " + fmtQty(focusTr[7]), ex + 12, ey + 8);
        }

        // Path from entry to current close while open
        if (act && endIdx > act[0]) {
          var x0 = X(idxK(Math.max(start, act[0])));
          var x1 = X(idxK(endIdx));
          btcCtx.setLineDash([3, 3]);
          btcCtx.strokeStyle = "rgba(238,243,247,0.45)";
          btcCtx.lineWidth = 1.4;
          btcCtx.beginPath();
          btcCtx.moveTo(x0, Y(act[3]));
          btcCtx.lineTo(x1, Y(c[endIdx]));
          btcCtx.stroke();
          btcCtx.setLineDash([]);
        }

        // Exit callout
        if (justClosed || (focusTr[1] <= endIdx && focusTr[1] >= start)) {
          var hit = focusTr[8] === 1 ? "HIT TP" : (focusTr[8] === 2 ? "HIT SL" : "EXIT");
          var hc = focusTr[8] === 1 ? "#66bb6a" : "#ef5350";
          var zx = X(idxK(Math.min(endIdx, Math.max(start, focusTr[1]))));
          var zy = Y(focusTr[4] || focusTr[3]);
          btcCtx.fillStyle = "rgba(10,14,18,0.85)";
          btcCtx.fillRect(zx - 46, zy - 28, 92, 22);
          btcCtx.strokeStyle = hc;
          btcCtx.lineWidth = 1.5;
          btcCtx.strokeRect(zx - 46, zy - 28, 92, 22);
          btcCtx.fillStyle = hc;
          btcCtx.font = "bold 12px monospace";
          btcCtx.fillText(hit, zx - 28, zy - 12);
        }

        // Step legend
        var step = "1  LIMIT FILL";
        if (act && endIdx > act[0]) step = "2  HOLD TO TP / SL";
        if (justClosed || (focusTr[1] <= endIdx && !act)) step = "3  EXIT RESOLVED";
        btcCtx.fillStyle = "#eef3f7";
        btcCtx.font = "bold 12px monospace";
        btcCtx.fillText(step, left + 6, top + 16);
      } else {
        btcCtx.fillStyle = "rgba(125,211,252,0.9)";
        btcCtx.font = "10px monospace";
        btcCtx.fillText("SMA9", left + 6, top + 14);
      }
    }


    function drawFullMap() {
      if (!fullCtx || !fullCanvas) return;
      var W = fullCanvas.width, H = fullCanvas.height;
      fullCtx.clearRect(0, 0, W, H);
      var left = 14, right = 70, top = 18, bottom = 36;
      var plotW = W - left - right, plotH = H - top - bottom;
      var minP = Infinity, maxP = -Infinity;
      for (var i = 0; i < N; i++) {
        if (c[i] < minP) minP = c[i];
        if (c[i] > maxP) maxP = c[i];
      }
      var pad = (maxP - minP) * 0.08 || 1;
      minP -= pad; maxP += pad;
      function X(i) { return left + (i / Math.max(1, N - 1)) * plotW; }
      function Y(v) { return top + (1 - (v - minP) / (maxP - minP)) * plotH; }

      // soft grid
      fullCtx.strokeStyle = "rgba(140,170,190,0.12)";
      fullCtx.lineWidth = 1;
      for (var g = 0; g < 4; g++) {
        var gy = top + (plotH * g) / 3;
        fullCtx.beginPath();
        fullCtx.moveTo(left, gy);
        fullCtx.lineTo(W - right, gy);
        fullCtx.stroke();
      }

      // event lines
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        var ex = X(Math.max(0, Math.min(N - 1, ev.i)));
        fullCtx.setLineDash([4, 4]);
        fullCtx.strokeStyle = "rgba(255,213,79,0.55)";
        fullCtx.beginPath();
        fullCtx.moveTo(ex, top);
        fullCtx.lineTo(ex, top + plotH);
        fullCtx.stroke();
        fullCtx.setLineDash([]);
        fullCtx.fillStyle = "#ffd54f";
        fullCtx.font = "9px monospace";
        fullCtx.save();
        fullCtx.translate(ex + 3, top + 12 + (e % 3) * 12);
        fullCtx.fillText(ev.label, 0, 0);
        fullCtx.restore();
      }

      // price path (close line + light fill)
      fullCtx.beginPath();
      for (var i = 0; i < N; i++) {
        var xx = X(i), yy = Y(c[i]);
        if (i === 0) fullCtx.moveTo(xx, yy);
        else fullCtx.lineTo(xx, yy);
      }
      fullCtx.strokeStyle = "rgba(125,211,252,0.95)";
      fullCtx.lineWidth = 2;
      fullCtx.stroke();
      fullCtx.lineTo(X(N - 1), top + plotH);
      fullCtx.lineTo(X(0), top + plotH);
      fullCtx.closePath();
      fullCtx.fillStyle = "rgba(125,211,252,0.08)";
      fullCtx.fill();

      // trade entries
      for (var t = 0; t < trades.length; t++) {
        var tr = trades[t];
        var ti = Math.max(0, Math.min(N - 1, tr[0]));
        var winHit = tr[8] === 1;
        var lossHit = tr[8] === 2;
        fullCtx.beginPath();
        fullCtx.arc(X(ti), Y(tr[3] || c[ti]), winHit || lossHit ? 3.2 : 2.4, 0, Math.PI * 2);
        fullCtx.fillStyle = winHit ? "#66bb6a" : (lossHit ? "#ef5350" : "#5eead4");
        fullCtx.fill();
      }

      // axis labels
      fullCtx.fillStyle = "#8a9aab";
      fullCtx.font = "11px monospace";
      fullCtx.fillText((d[0] || "").slice(0, 10), left, H - 10);
      fullCtx.fillText((d[N - 1] || "").slice(0, 10), W - right - 78, H - 10);
      fullCtx.fillText(fmtPx(maxP), W - right + 4, top + 10);
      fullCtx.fillText(fmtPx(minP), W - right + 4, top + plotH);
      fullCtx.fillStyle = "#7dd3fc";
      fullCtx.font = "bold 12px monospace";
      fullCtx.fillText(fmtPx(c[N - 1]), W - right + 4, Y(c[N - 1]) + 4);

      // year ticks
      var lastY = "";
      for (var i = 0; i < N; i++) {
        var yy = (d[i] || "").slice(0, 4);
        if (yy && yy !== lastY) {
          lastY = yy;
          fullCtx.fillStyle = "rgba(238,243,247,0.55)";
          fullCtx.font = "10px monospace";
          fullCtx.fillText(yy, X(i) + 2, H - 22);
        }
      }

      if ($("fullEndPx")) $("fullEndPx").textContent = fmtPx(c[N - 1]);
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
      if (idx >= N - 1) {
        playing = false;
        stop();
        render(idx);
        drawFullMap();
        if (!didScrollFull) {
          didScrollFull = true;
          var fm = $("fullmap");
          if (fm && fm.scrollIntoView) setTimeout(function () { fm.scrollIntoView({ behavior: "smooth", block: "start" }); }, 400);
        }
        return;
      }
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

    drawFullMap();
    render(0);
    setTimeout(play, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
